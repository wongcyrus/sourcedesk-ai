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
                  sourceUrl: new URL('docs/reference.html#section', packBaseUrl).href }] };
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
    assert.match(document.getElementById('chat-history').textContent, new RegExp(config.title));
  }
});
