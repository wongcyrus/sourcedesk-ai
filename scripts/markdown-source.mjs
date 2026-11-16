import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, copyFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseHTML } from 'linkedom';

export const escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function documentPage(title, content, attribution, home = '../index.html') {
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escapeHtml(title)}</title><style>body{max-width:1000px;margin:2em auto;padding:0 1em;font:17px/1.6 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:1em}img{max-width:100%}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ccc;padding:.5em}h1,h2,h3,h4{scroll-margin-top:1em}</style></head><body><nav><a href="${home}">Documents</a></nav>${content}<footer><hr>${escapeHtml(attribution)}</footer></body></html>`;
}

export async function markdownSource(contentDirectory, output, config) {
  const content = await realpath(contentDirectory);
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Content must not contain symbolic links.');
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.md$/i.test(entry.name)) files.push(path);
    }
  }
  await walk(content);
  if (!files.length) throw new Error('No Markdown documents found in the content folder.');
  const pages = new Map(files.map(file => [
    file, `docs/${createHash('sha256').update(relative(content, file).split(sep).join('/')).digest('hex').slice(0, 20)}.html`
  ]));
  const markdown = new MarkdownIt({ html: false, linkify: false });
  const sections = [];
  const index = [];
  await mkdir(resolve(output, 'docs/assets'), { recursive: true });

  for (const file of files) {
    const tokens = markdown.parse(await readFile(file, 'utf8'), {});
    const slugs = new Map();
    let title = relative(content, file).replace(/\.md$/i, '');
    const firstHeading = tokens.findIndex(token => token.type === 'heading_open' && token.tag === 'h1');
    if (firstHeading >= 0) title = tokens[firstHeading + 1].content;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const text = tokens[i + 1].content;
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const count = slugs.get(base) || 0;
      slugs.set(base, count + 1);
      tokens[i].attrSet('id', count ? `${base}-${count}` : base);
    }
    const { document } = parseHTML(`<html><body>${markdown.renderer.render(tokens, markdown.options)}</body></html>`);
    const path = pages.get(file);
    for (const image of document.querySelectorAll('img')) {
      const src = image.getAttribute('src');
      if (!src || /^[a-z][a-z0-9+.-]*:|^[/\\]/i.test(src)) {
        image.remove();
        continue;
      }
      const asset = await realpath(resolve(dirname(file), decodeURIComponent(src)));
      const extension = extname(asset).toLowerCase();
      if (!asset.startsWith(content + sep) || !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(extension)) {
        throw new Error(`Unsupported or outside content image: ${src}`);
      }
      const name = createHash('sha256').update(await readFile(asset)).digest('hex') + extension;
      await copyFile(asset, resolve(output, 'docs/assets', name));
      image.setAttribute('src', `assets/${name}`);
    }
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (href.startsWith('#')) continue;
      const [target, fragment] = href.split('#');
      const page = !/^[a-z][a-z0-9+.-]*:|^[/\\]/i.test(target) &&
        pages.get(resolve(dirname(file), decodeURIComponent(target)));
      if (page) link.setAttribute('href', page.slice(5) + (fragment ? `#${fragment}` : ''));
      else link.removeAttribute('href');
    }
    let heading = title;
    let localPath = path;
    let text = [];
    const flush = () => {
      if (text.join('\n\n').trim()) sections.push({ title: heading, localPath, text: text.join('\n\n').trim() });
      text = [];
    };
    for (const node of document.body.children) {
      if (/^H[1-6]$/.test(node.tagName)) {
        flush();
        heading = node.tagName === 'H1' ? node.textContent : `${title} > ${node.textContent}`;
        localPath = `${path}#${encodeURIComponent(node.id)}`;
      } else {
        text.push(node.textContent);
      }
    }
    flush();
    await writeFile(resolve(output, path), documentPage(title, document.body.innerHTML, config.attribution, 'index.html'));
    index.push({ title, path });
  }
  await writeFile(resolve(output, 'docs/index.html'), documentPage(config.title,
    `<h1>${escapeHtml(config.title)}</h1><ul>${index.map(page =>
      `<li><a href="${page.path.slice(5)}">${escapeHtml(page.title)}</a></li>`).join('')}</ul>`, config.attribution, 'index.html'));
  return { sections };
}
