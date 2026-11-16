import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';

export function pageUrls(sitemap, sourceUrl) {
  const urls = new Map();
  for (const match of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'));
    if (url.origin !== new URL(sourceUrl).origin || !url.pathname.startsWith('/docs/')) continue;
    const path = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\/$/, '');
    // Docsy print anchors use Hugo File.UniqueID.
    for (const file of [`${path}.md`, `${path}/_index.md`, `${path}/index.md`]) {
      urls.set(`pg-${createHash('md5').update(file).digest('hex')}`, url.href);
    }
  }
  return urls;
}

function plainText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.tagName === 'PRE') return `\n${node.textContent}\n`;
  if (node.tagName === 'BR') return '\n';
  const text = Array.from(node.childNodes, plainText).join('');
  return /^(P|DIV|LI|UL|OL|TABLE|TR|DL|DT|DD)$/.test(node.tagName) ? `${text}\n` : text;
}

export function extractSections(html, sitemap, sourceUrl = 'https://kubernetes.io/docs/_print/') {
  const { document } = parseHTML(html);
  const urls = pageUrls(sitemap, sourceUrl);
  const sections = [];
  const unresolvedPages = [];
  const pages = [...document.querySelectorAll('main .td-content')]
    .filter(page => page.querySelector('h1[id^="pg-"]'));
  if (!pages.length) throw new Error('No Kubernetes print-page documentation blocks found.');
  for (const page of pages) {
    const heading = page.querySelector('h1[id^="pg-"]');
    const pageTitle = heading.textContent.replace(/^[\d.]+\s*-\s*/, '').trim();
    const pageUrl = urls.get(heading.id);
    if (!pageUrl) unresolvedPages.push({ title: pageTitle, sourceUrl: `${sourceUrl}#${heading.id}` });
    for (const element of page.querySelectorAll(
      'script, style, nav, button, .pageinfo, .feedback, .td-heading-self-link, .copy-code-icon'
    )) element.remove();
    let title = pageTitle;
    let citation = pageUrl || `${sourceUrl}#${heading.id}`;
    let paragraphs = [];
    const flush = () => {
      const text = paragraphs.join('\n\n').trim();
      if (text) sections.push({ title, sourceUrl: citation, text });
      paragraphs = [];
    };
    const visit = node => {
      if (node.nodeType === 3) {
        if (node.textContent.trim()) paragraphs.push(node.textContent.trim());
        return;
      }
      if (node.nodeType !== 1) return;
      if (/^H[1-6]$/.test(node.tagName)) {
        if (node === heading) return;
        flush();
        title = `${pageTitle} > ${node.textContent.trim()}`;
        if (pageUrl && node.id) {
          const url = new URL(pageUrl);
          url.hash = node.id;
          citation = url.href;
        }
        return;
      }
      if (/^(P|PRE|UL|OL|TABLE|DL)$/.test(node.tagName)) {
        const text = plainText(node).trim();
        if (text) paragraphs.push(text);
        return;
      }
      for (const child of node.childNodes) visit(child);
    };
    for (const node of page.childNodes) visit(node);
    flush();
  }
  return { sections, unresolvedPages };
}
