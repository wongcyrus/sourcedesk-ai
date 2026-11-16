import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EMBEDDING_MODEL, loadActiveSubject, localDocumentUrl } from '../src/Subject.js';
import { markdownSource } from '../scripts/markdown-source.mjs';
import { kubernetesSource } from '../examples/kubernetes/source.mjs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { execFileSync } from 'node:child_process';
import { documentSource } from '../scripts/document-source.mjs';

function activeFixture() {
  const subject = {
    format: 'sourcedesk-subject-v1', id: 'biology', version: 'a'.repeat(16),
    title: 'Biology', description: 'Study living things.', language: 'en', attribution: 'Example author',
    examples: ['What is a cell?'], answerStyle: '', manifest: 'manifest.json', documents: 'docs/index.html',
    files: { 'manifest.json': 'b'.repeat(64), 'docs/index.html': 'c'.repeat(64) }
  };
  const manifest = {
    model: { ...EMBEDDING_MODEL }, dimensions: 768, partial: false,
    documentPrefix: 'title: none | text: ', queryPrefix: 'task: search result | query: '
  };
  const responses = {
    '/active-subject.json': { path: 'subjects/biology-aaaaaaaaaaaaaaaa/subject.json' },
    '/subjects/biology-aaaaaaaaaaaaaaaa/subject.json': subject,
    '/subjects/biology-aaaaaaaaaaaaaaaa/manifest.json': manifest,
    '/release.json': { application: 'sourcedesk-ai', embeddingModel: { ...EMBEDDING_MODEL } }
  };
  const requested = [];
  return {
    subject, manifest, responses, requested,
    fetch: async (url, options) => {
      requested.push([url.href, options]);
      return { ok: url.pathname in responses, json: async () => responses[url.pathname] };
    }
  };
}

test('active subject loads only its pack and reuses the shared model contract', async () => {
  const fixture = activeFixture();
  const active = await loadActiveSubject('http://localhost:8080/', fixture.fetch);
  assert.equal(active.subject.title, 'Biology');
  assert.equal(active.documentsUrl.href, 'http://localhost:8080/subjects/biology-aaaaaaaaaaaaaaaa/docs/index.html');
  assert.ok(fixture.requested.every(([url, options]) => !url.includes('/models/') && options.cache === 'no-store'));
  fixture.manifest.model.revision = 'd'.repeat(40);
  await assert.rejects(loadActiveSubject('http://localhost:8080/', fixture.fetch), /different embedding model/);
});

test('active subject rejects missing, partial and escaping packs', async () => {
  const fixture = activeFixture();
  fixture.manifest.partial = true;
  await assert.rejects(loadActiveSubject('http://localhost:8080/', fixture.fetch), /partial/);
  fixture.responses['/active-subject.json'].path = '../subject.json';
  await assert.rejects(loadActiveSubject('http://localhost:8080/', fixture.fetch), /Invalid active subject/);
  delete fixture.responses['/active-subject.json'];
  await assert.rejects(loadActiveSubject('http://localhost:8080/', fixture.fetch), /No active subject/);
  for (const path of ['../docs/page.html', '/docs/page.html', 'docs/../../index.html', 'https://other.test/page', 'docs/a.html#x#y']) {
    assert.throws(() => localDocumentUrl(path, 'http://localhost:8080/subjects/biology/'), /Invalid bundled/);
  }
});

test('Markdown ingestion preserves headings, code and local links without executable HTML or network assets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sourcedesk-markdown-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = join(directory, 'content');
  const output = join(directory, 'pack');
  await mkdir(content);
  await writeFile(join(content, 'first.md'),
    '# Cells\n\nA cell is a basic unit of life.\n\n## Structure\n\nA membrane encloses a cell.\n\n' +
    '```text\n  preserve indentation\n```\n\n## Structure\n\nMore details.\n\n' +
    '[Next](second.md#energy) [Outside](https://example.test/) ![remote](https://example.test/image.png)\n\n<script>bad()</script>');
  await writeFile(join(content, 'second.md'), '# Metabolism\n\n## Energy\n\nCells use chemical energy.');
  const { sections } = await markdownSource(content, output, { title: 'Biology', attribution: 'Example author' });
  assert.ok(sections.some(section => section.localPath.endsWith('#structure-1')));
  const source = sections.find(section => section.title === 'Cells > Structure');
  assert.match(source.text, /  preserve indentation/);
  const html = await readFile(join(output, source.localPath.split('#')[0]), 'utf8');
  const secondPath = sections.find(section => section.title === 'Metabolism > Energy').localPath;
  assert.ok(html.includes(`href="${secondPath.slice(5)}"`));
  assert.doesNotMatch(html, /<script>|src="https:|href="https:/);
  assert.match(html, /script-src 'none'/);
});

function makePdfPage(text) {
  const content = `BT /F1 16 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function makeDocx(path) {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const script = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
 z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
 z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>')
 z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Word heading</w:t></w:r></w:p><w:p><w:r><w:t>Word body text.</w:t></w:r></w:p></w:body></w:document>')
`;
  execFileSync(python, ['-c', script, path]);
}

test('mixed document ingestion creates page/heading HTML citations and retains PDF/DOCX originals', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sourcedesk-mixed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = join(directory, 'content');
  const output = join(directory, 'pack');
  await mkdir(content);
  await writeFile(join(content, 'guide.md'), '# Markdown guide\n\nMarkdown body.');
  await writeFile(join(content, 'manual.pdf'), makePdfPage('PDF page body.'));
  await makeDocx(join(content, 'notes.docx'));
  const result = await documentSource(content, output, {
    title: 'Mixed sources', attribution: 'Example materials'
  });
  const pdf = result.sections.find(section => section.title === 'manual > Page 1');
  const word = result.sections.find(section => section.title === 'Word heading');
  const md = result.sections.find(section => section.title === 'Markdown guide');
  assert.match(pdf.text, /PDF page body/);
  assert.match(pdf.localPath, /#page-1$/);
  assert.match(pdf.originalPath, /originals\/[a-f0-9]+\.pdf#page=1$/);
  assert.match(word.text, /Word body text/);
  assert.match(word.localPath, /#word-heading$/);
  assert.match(word.originalPath, /originals\/[a-f0-9]+\.docx$/);
  assert.ok(md.localPath.startsWith('docs/'));
  const pdfView = await readFile(join(output, pdf.localPath.split('#')[0]), 'utf8');
  assert.match(pdfView, /id="page-1"/);
  assert.match(pdfView, /Open original PDF/);
  const wordView = await readFile(join(output, word.localPath.split('#')[0]), 'utf8');
  assert.match(wordView, /id="word-heading"/);
  assert.doesNotMatch(wordView, /href="(?:https?:|javascript:)/);
  assert.match(await readFile(join(output, 'docs/index.html'), 'utf8'), /manual/);
  assert.match(await readFile(join(output, 'docs/index.html'), 'utf8'), /Markdown guide/);
});

test('HTML document ingestion creates safe local views and heading citations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sourcedesk-html-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = join(directory, 'content');
  const output = join(directory, 'pack');
  await mkdir(join(content, 'tutorial'), { recursive: true });
  await writeFile(join(content, 'tutorial', 'index.html'),
    '<html><head><title>Course index</title><script>bad()</script></head><body><nav>Navigation</nav>' +
    '<main><h1>Python tutorial</h1><p>Start with the <a href="functions.html#defining">functions lesson</a>.</p>' +
    '<a href="https://outside.test/">Remote link</a></main></body></html>');
  await writeFile(join(content, 'tutorial', 'functions.html'),
    '<html><body><main><h1>Functions</h1><section id="defining"><h2>Defining functions</h2>' +
    '<p>Use def to define a function.</p><pre><code>def greet():\\n    print("Hello")</code></pre>' +
    '<script>bad()</script><img src="https://outside.test/image.png" onerror="bad()"></section></main></body></html>');
  const result = await documentSource(content, output, {
    title: 'Python', attribution: 'Python Software Foundation'
  });
  const functionSection = result.sections.find(section => section.title === 'Functions > Defining functions');
  assert.ok(functionSection);
  assert.match(functionSection.localPath, /#defining$/);
  assert.match(functionSection.text, /def greet\(\)/);
  const functionView = await readFile(join(output, functionSection.localPath.split('#')[0]), 'utf8');
  assert.match(functionView, /id="defining"/);
  assert.doesNotMatch(functionView, /<script>|onerror=|src="https:/);
  assert.match(functionView, /script-src 'none'/);
  const indexSection = result.sections.find(section => section.title === 'Python tutorial');
  const indexView = await readFile(join(output, indexSection.localPath.split('#')[0]), 'utf8');
  assert.match(indexView, new RegExp(functionSection.localPath.slice(5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(indexView, /href="https:/);
  assert.match(await readFile(join(output, 'docs/index.html'), 'utf8'), /Python tutorial/);
});

test('scanned PDFs fail clearly instead of producing empty citations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sourcedesk-scanned-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = join(directory, 'content');
  await mkdir(content);
  await writeFile(join(content, 'scanned.pdf'), makePdfPage(''));
  await assert.rejects(documentSource(content, join(directory, 'pack'), {
    title: 'Scanned', attribution: ''
  }), /OCR before building/);
});

test('Kubernetes adapter mirrors canonical and unresolved anchors inside a movable pack', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sourcedesk-kubernetes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = 'pg-' + createHash('md5').update('docs/concepts/example.md').digest('hex');
  const html = `<main><div class="td-content"><h1 id="${id}">Example</h1><h2 id="detail">Detail</h2>` +
    '<p>Reference text.</p><a href="https://outside.test/">Outside</a></div>' +
    '<div class="td-content"><h1 id="pg-unknown">Unresolved</h1><p>Unresolved text.</p></div></main>';
  const sitemap = '<urlset><url><loc>https://kubernetes.io/docs/concepts/example/</loc></url></urlset>';
  const { sections } = await kubernetesSource(html, sitemap, directory, {
    title: 'Kubernetes', attribution: 'Kubernetes Authors, CC BY 4.0'
  });
  assert.equal(sections[0].localPath, 'docs/concepts/example/index.html#detail');
  assert.equal(sections[1].localPath, 'docs/_print/index.html#pg-unknown');
  const canonical = await readFile(join(directory, 'docs/concepts/example/index.html'), 'utf8');
  assert.match(canonical, /id="detail"/);
  assert.doesNotMatch(canonical, /href="https:\/\/outside/);
  assert.match(await readFile(join(directory, 'docs/_print/index.html'), 'utf8'), /id="pg-unknown"/);
});

test('reloading the shared application loads the new subject, prompt style and pack-scoped reader', async () => {
  for (const id of ['networking', 'biology']) {
    const config = JSON.parse(await readFile(new URL(`../examples/${id}/subject.json`, import.meta.url), 'utf8'));
    const window = parseHTML(await readFile(new URL('../web/index.html', import.meta.url), 'utf8'));
    const packBaseUrl = new URL(`http://localhost:8080/subjects/${id}-aaaaaaaaaaaaaaaa/`);
    const documentsUrl = new URL('docs/index.html', packBaseUrl);
    const manifestUrl = new URL('manifest.json', packBaseUrl);
    const document = window.document;
    Object.defineProperty(document.getElementById('status'), 'innerText', {
      get() { return this.textContent; },
      set(value) { this.textContent = value; }
    });
    const calls = [];
    class Generator {
      constructor(base, options) {
        assert.equal(base, 'http://localhost:8080/');
        assert.equal(options.answerStyle, config.answerStyle);
        this.modelCached = true;
      }
      async generate(question, sources, onText) {
        const answer = `${config.title} answer [1].`;
        onText(answer);
        return answer;
      }
    }
    const dependencies = {
      '../OfflineVectorSearch-min.js': {
        OfflineAnswerGenerator: Generator,
        buildRetrievalQuery: question => question,
        loadActiveSubject: async () => ({ subject: config, packBaseUrl, documentsUrl, manifestUrl }),
        OfflineVectorSearch: {
          async fromPrebuiltDataset(url, status, options) {
            assert.equal(url.href, manifestUrl.href);
            assert.equal(options.packBaseUrl, packBaseUrl.href);
            return {
              prebuiltData: { manifest: { count: 3 } }, searchBackend: 'test',
              async searchText(question) {
                calls.push(question);
                return { results: [{ title: 'Source', text: 'Reference', score: 0.9,
                  sourceUrl: new URL('docs/reference.html#section', packBaseUrl).href,
                  originalUrl: new URL('originals/reference.pdf#page=4', packBaseUrl).href }] };
              }
            };
          }
        }
      },
      './answer-citations.js': {
        renderAnswer(container, text) {
          container.textContent = text;
          return new Set([1]);
        }
      }
    };
    const context = vm.createContext({ URL, document, location: new URL('http://localhost:8080/') });
    const module = new vm.SourceTextModule(await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8'), {
      context, initializeImportMeta(meta) { meta.url = 'http://localhost:8080/js/app.js'; }
    });
    await module.link(specifier => {
      const exports = dependencies[specifier];
      return new vm.SyntheticModule(Object.keys(exports), function() {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context });
    });
    await module.evaluate();
    assert.equal(document.getElementById('subject-title').textContent, config.title);
    assert.equal(document.getElementById('subject-attribution').textContent, config.attribution);
    assert.equal(document.getElementById('chat-history').querySelectorAll('.chat-turn').length, 0);
    document.getElementById('query').value = config.examples[0];
    document.getElementById('search-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [config.examples[0]]);
    assert.equal(document.getElementById('document-reader').src,
      new URL('docs/reference.html#section', packBaseUrl).href);
    assert.equal(document.getElementById('open-original').href,
      new URL('originals/reference.pdf#page=4', packBaseUrl).href);
    assert.equal(document.getElementById('open-original').textContent, 'Open original PDF');
    assert.equal(document.getElementById('open-original').hidden, false);
    assert.match(document.getElementById('chat-history').textContent, new RegExp(config.title));
  }
});
