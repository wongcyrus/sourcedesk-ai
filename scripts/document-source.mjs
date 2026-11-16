import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath, readFile, copyFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { parseHTML } from 'linkedom';
import { documentPage, escapeHtml, markdownSource, writeDocumentIndex } from './markdown-source.mjs';

const SUPPORTED = new Set(['.md', '.html', '.htm', '.pdf', '.docx']);
const ASSETS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);

function stableName(content, path) {
  return createHash('sha256').update(relative(content, path).split(sep).join('/')).digest('hex').slice(0, 20);
}

async function copyOriginal(file, content, output) {
  const extension = extname(file).toLowerCase();
  const name = `${stableName(content, file)}${extension}`;
  await mkdir(resolve(output, 'originals'), { recursive: true });
  await copyFile(file, resolve(output, 'originals', name));
  return `originals/${name}`;
}

function originalLink(path, relativePath, label) {
  if (!path) return '';
  return `<p><a href="${relativePath}" rel="noopener">${escapeHtml(label)}</a></p>`;
}

function pdfText(items) {
  return items.map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfDocument(file, content, output, config) {
  const source = await readFile(file);
  const task = getDocument({
    data: new Uint8Array(source), useSystemFonts: true, isEvalSupported: false,
    disableFontFace: true, useWorkerFetch: false
  });
  const pdf = await task.promise;
  try {
    const title = fileTitle(file);
    const path = `docs/${stableName(content, file)}.html`;
    const originalPath = await copyOriginal(file, content, output);
    const originalHref = relative(dirname(path), originalPath);
    const sections = [];
    const pages = [];
    let extractedPages = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const text = pdfText((await page.getTextContent()).items);
      page.cleanup();
      if (text) {
        extractedPages++;
        sections.push({
          title: `${title} > Page ${number}`, localPath: `${path}#page-${number}`,
          originalPath: `${originalPath}#page=${number}`, text
        });
        pages.push(`<section><h2 id="page-${number}">Page ${number}</h2><pre>${escapeHtml(text)}</pre></section>`);
      } else {
        pages.push(`<section><h2 id="page-${number}">Page ${number}</h2><p>No extractable text on this page. Scanned pages require OCR.</p></section>`);
      }
    }
    if (!extractedPages) throw new Error(`No extractable text in ${file}. Run OCR before building this scanned PDF.`);
    await mkdir(dirname(resolve(output, path)), { recursive: true });
    await writeFile(resolve(output, path), documentPage(title,
      `${originalLink(originalPath, originalHref + '#page=1', 'Open original PDF')}${pages.join('\n')}`,
      config.attribution, 'index.html'));
    return { sections, documents: [{ title, path }] };
  } finally {
    await task.destroy();
  }
}

function fileTitle(file) {
  return file.slice(0, -extname(file).length).split(/[\\/]/).at(-1) || 'Document';
}

function safeDocxHtml(html, title) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const element of document.querySelectorAll('script,style,iframe,object,embed,form,link,meta,svg,math')) {
    element.remove();
  }
  if (!document.querySelector('h1')) {
    const heading = document.createElement('h1');
    heading.textContent = title;
    document.body.prepend(heading);
  }
  for (const element of document.querySelectorAll('*')) {
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src');
      if (!src || !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src) || src.length > 7_000_000) {
        element.remove();
      } else {
        for (const attribute of [...element.attributes]) {
          if (attribute.name !== 'src' && attribute.name !== 'alt') element.removeAttribute(attribute.name);
        }
      }
    } else {
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    }
  }
  const headings = new Map();
  for (const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const base = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim().replace(/\s+/g, '-') || 'section';
    const count = headings.get(base) || 0;
    headings.set(base, count + 1);
    heading.setAttribute('id', count ? `${base}-${count}` : base);
  }
  for (const link of document.querySelectorAll('a')) {
    const text = document.createTextNode(link.textContent);
    link.replaceWith(text);
  }
  return document.body;
}

async function docxDocument(file, content, output, config) {
  const title = fileTitle(file);
  const path = `docs/${stableName(content, file)}.html`;
  const originalPath = await copyOriginal(file, content, output);
  const converted = await mammoth.convertToHtml({ path: file }, { externalFileAccess: false });
  for (const message of converted.messages) console.warn(`DOCX ${file}: ${message.message}`);
  const body = safeDocxHtml(converted.value, title);
  const sections = [];
  let heading = title;
  let locator = `${path}#${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`;
  let contentBlocks = [];
  const flush = () => {
    const text = contentBlocks.join('\n\n').trim();
    if (text) sections.push({ title: heading, localPath: locator, originalPath, text });
    contentBlocks = [];
  };
  for (const node of body.children) {
    if (/^H[1-6]$/.test(node.tagName)) {
      flush();
      heading = node.tagName === 'H1' ? node.textContent : `${title} > ${node.textContent}`;
      locator = `${path}#${node.id}`;
    } else {
      contentBlocks.push(node.textContent);
    }
  }
  flush();
  const originalHref = relative(dirname(path), originalPath);
  await mkdir(dirname(resolve(output, path)), { recursive: true });
  await writeFile(resolve(output, path), documentPage(title,
    `${originalLink(originalPath, originalHref, 'Download original Word document')}${body.innerHTML}`,
    config.attribution, 'index.html'));
  return { sections, documents: [{ title, path }] };
}

function htmlSlug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim().replace(/\s+/g, '-') || 'section';
}

async function htmlDocument(file, content, output, config, pages) {
  const { document } = parseHTML(await readFile(file, 'utf8'));
  for (const element of document.querySelectorAll(
    'script,style,iframe,object,embed,form,link,meta,nav,header,footer,aside,button,input,select,textarea,video,audio,canvas,svg,math,.related,.sphinxsidebar,a.headerlink'
  )) element.remove();
  const root = document.querySelector('main,article,.document') || document.body;
  const page = pages.get(file);
  const title = root.querySelector('h1')?.textContent.trim() || document.querySelector('title')?.textContent.trim() || fileTitle(file);
  const validId = value => /^[a-zA-Z0-9_.:-]+$/.test(value);
  for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    let id = heading.getAttribute('id');
    let ancestor = heading.parentElement;
    while (!id && ancestor && ancestor !== root) {
      id = ancestor.getAttribute('id');
      ancestor = ancestor.parentElement;
    }
    heading.setAttribute('id', validId(id || '') ? id : htmlSlug(heading.textContent));
  }
  const baseUrl = new URL(
    `https://sourcedesk.invalid/${relative(content, file).split(sep).map(encodeURIComponent).join('/')}`
  );
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id' && validId(attribute.value)) continue;
      if (element.tagName === 'A' && attribute.name === 'href') {
        let target;
        try {
          target = new URL(attribute.value, baseUrl);
        } catch {
          // Malformed links are stripped below.
        }
        let targetPath;
        if (target?.origin === baseUrl.origin) {
          try {
            targetPath = resolve(content, decodeURIComponent(target.pathname.slice(1)));
          } catch {
            // Malformed paths are stripped below.
          }
        }
        const localPath = targetPath && pages.get(targetPath);
        if (localPath) {
          element.setAttribute('href', localPath.slice(5) + target.hash);
          continue;
        }
      }
      element.removeAttribute(attribute.name);
    }
  }
  const path = page;
  const sections = [];
  let heading = title;
  let locator = path;
  let text = [];
  const flush = () => {
    const body = text.join('\n\n').trim();
    if (body) sections.push({ title: heading, localPath: locator, text: body });
    text = [];
  };
  const hasHeading = element => [...element.children].some(child =>
    /^H[1-6]$/.test(child.tagName) || hasHeading(child));
  const visit = element => {
    for (const child of element.children) {
      if (/^H[1-6]$/.test(child.tagName)) {
        flush();
        heading = child.tagName === 'H1' ? child.textContent : `${title} > ${child.textContent}`;
        locator = `${path}#${encodeURIComponent(child.id)}`;
      } else if (hasHeading(child)) {
        visit(child);
      } else if (child.textContent.trim()) {
        text.push(child.textContent);
      }
    }
  };
  visit(root);
  flush();
  await mkdir(dirname(resolve(output, path)), { recursive: true });
  await writeFile(resolve(output, path), documentPage(title, root.innerHTML, config.attribution, 'index.html'));
  return { sections, documents: [{ title, path }] };
}

export async function documentSource(contentDirectory, output, config) {
  const content = await realpath(contentDirectory);
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Content must not contain symbolic links.');
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (SUPPORTED.has(extname(path).toLowerCase())) files.push(path);
      else if (ASSETS.has(extname(path).toLowerCase()) || entry.name.startsWith('.')) continue;
      else throw new Error(`Unsupported document type: ${path}. Supported types are .md, .html, .htm, .pdf and .docx.`);
    }
  }
  await walk(content);
  if (!files.length) throw new Error('No supported documents found in the content folder.');
  const markdownFiles = files.filter(path => extname(path).toLowerCase() === '.md');
  const result = markdownFiles.length ?
    await markdownSource(content, output, config, { files: markdownFiles, writeIndex: false }) :
    { sections: [], documents: [] };
  const htmlFiles = files.filter(path => ['.html', '.htm'].includes(extname(path).toLowerCase()));
  const htmlPages = new Map(htmlFiles.map(file => [
    file, `docs/${stableName(content, file)}.html`
  ]));
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (['.html', '.htm'].includes(extension)) {
      const extracted = await htmlDocument(file, content, output, config, htmlPages);
      result.sections.push(...extracted.sections);
      result.documents.push(...extracted.documents);
    } else if (extension === '.pdf') {
      const extracted = await pdfDocument(file, content, output, config);
      result.sections.push(...extracted.sections);
      result.documents.push(...extracted.documents);
    } else if (extension === '.docx') {
      const extracted = await docxDocument(file, content, output, config);
      result.sections.push(...extracted.sections);
      result.documents.push(...extracted.documents);
    }
  }
  await writeDocumentIndex(output, config, result.documents);
  return result;
}
