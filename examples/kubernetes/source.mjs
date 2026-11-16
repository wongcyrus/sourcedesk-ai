import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix } from 'node:path';
import { parseHTML } from 'linkedom';
import { extractSections, pageUrls } from './sections.mjs';
import { documentPage, escapeHtml } from '../../scripts/markdown-source.mjs';
import { isPackPath } from '../../src/Subject.js';

export const SOURCE_URL = 'https://kubernetes.io/docs/_print/';

export async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response.text();
}

export async function kubernetesSource(html, sitemap, output, config) {
  const extracted = extractSections(html, sitemap, SOURCE_URL);
  for (const section of extracted.sections) {
    const url = new URL(section.sourceUrl);
    section.localPath = `${url.pathname.slice(1).replace(/\/$/, '')}/index.html${url.hash}`;
  }
  const { document } = parseHTML(html);
  const urls = pageUrls(sitemap, SOURCE_URL);
  const pages = [...document.querySelectorAll('main .td-content')]
    .filter(page => page.querySelector('h1[id^="pg-"]'));
  const targets = new Map(pages.map(page => {
    const id = page.querySelector('h1').id;
    const url = urls.get(id);
    return [id, url ? new URL(url).pathname.slice(1).replace(/\/$/, '') + '/index.html' : 'docs/_print/index.html'];
  }));
  const known = new Set(targets.values());
  const assets = new Map();
  const index = [];
  const print = [];
  const relativePath = (from, to) => posix.relative(posix.dirname(from), to) || posix.basename(to);
  async function localAsset(url) {
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid source asset protocol.');
    if (!assets.has(url.href)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`Asset download failed: ${url}`);
      const extension = extname(url.pathname).replace(/[^.a-z0-9]/gi, '').slice(0, 12);
      const path = `docs/assets/${createHash('sha256').update(url.href).digest('hex').slice(0, 20)}${extension}`;
      await mkdir(join(output, 'docs/assets'), { recursive: true });
      await writeFile(join(output, path), Buffer.from(await response.arrayBuffer()));
      assets.set(url.href, path);
    }
    return assets.get(url.href);
  }
  for (const page of pages) {
    const heading = page.querySelector('h1');
    const original = urls.get(heading.id) || SOURCE_URL;
    const path = targets.get(heading.id);
    if (!isPackPath(path)) throw new Error('Invalid Kubernetes document path.');
    for (const element of page.querySelectorAll('script,style,link,iframe,object,embed,form,button,source,.pageinfo,.feedback')) {
      element.remove();
    }
    for (const element of page.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || ['style', 'srcset', 'srcdoc'].includes(attribute.name)) element.removeAttribute(attribute.name);
      }
    }
    for (const image of page.querySelectorAll('img[src]')) {
      const url = new URL(image.getAttribute('src'), original);
      image.setAttribute('src', relativePath(path, await localAsset(url)));
    }
    for (const link of page.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      const target = new URL(href, original);
      const destination = href.startsWith('#') && targets.has(href.slice(1)) ? targets.get(href.slice(1)) :
        target.origin === new URL(SOURCE_URL).origin ? target.pathname.slice(1).replace(/\/$/, '') + '/index.html' : null;
      if (destination && known.has(destination)) {
        link.setAttribute('href', relativePath(path, destination) + target.hash);
      } else if (href.startsWith('#')) {
        link.setAttribute('href', href);
      } else if (target.hostname === 'raw.githubusercontent.com' &&
          target.pathname.startsWith('/kubernetes/website/') && link.hasAttribute('download')) {
        link.setAttribute('href', relativePath(path, await localAsset(target)));
      } else {
        link.removeAttribute('href');
      }
    }
    const title = heading.textContent.replace(/^[\d.]+\s*-\s*/, '').trim();
    if (urls.has(heading.id)) {
      await mkdir(dirname(join(output, path)), { recursive: true });
      await writeFile(join(output, path), documentPage(title, page.outerHTML, config.attribution, relativePath(path, 'docs/index.html')));
      index.push({ title, path });
    }
    // Rebase page-relative links for the combined print view.
    for (const node of page.querySelectorAll('[href], [src]')) {
      for (const attribute of ['href', 'src']) {
        const value = node.getAttribute(attribute);
        if (!value || value.startsWith('#')) continue;
        const url = new URL(value, `https://pack.invalid/${path}`);
        node.setAttribute(attribute, relativePath('docs/_print/index.html', url.pathname.slice(1)) + url.hash);
      }
    }
    print.push(page.outerHTML);
  }
  await mkdir(join(output, 'docs/_print'), { recursive: true });
  await writeFile(join(output, 'docs/_print/index.html'),
    documentPage(config.title, print.join('\n'), config.attribution, '../index.html'));
  await writeFile(join(output, 'docs/index.html'), documentPage(config.title,
    `<h1>${escapeHtml(config.title)}</h1><ul>${index.map(page =>
      `<li><a href="${page.path.slice(5)}">${escapeHtml(page.title)}</a></li>`).join('')}</ul>`,
    config.attribution, 'index.html'));
  return extracted;
}
