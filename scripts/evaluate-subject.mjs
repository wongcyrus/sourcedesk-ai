import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { documentInput } from './corpus.mjs';
import { searchKeywords, rankHybridResults } from '../src/KeywordSearch.js';
import { fetchPrebuiltManifest, fetchPrebuiltData } from '../src/PrebuiltDataset.js';

const [pack, evaluation, models = 'offline/models'] = process.argv.slice(2);
if (!pack || !evaluation) throw new Error('Usage: npm run test:retrieval -- data/<id> examples/<id>/evaluation.json [shared-models-folder]');
// Reuse the runtime loader's validation while reading local build artifacts.
const readLocal = async url => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://pack.invalid') throw new Error('Invalid pack URL.');
  const path = resolve(pack, parsed.pathname.slice(1));
  if (!path.startsWith(resolve(pack) + sep)) throw new Error('Invalid pack file.');
  const bytes = await readFile(path);
  return {
    ok: true, url: parsed.href,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  };
};
const loaded = await fetchPrebuiltManifest('https://pack.invalid/manifest.json', readLocal);
assert.equal(loaded.manifest.partial, false, 'Evaluation requires a complete subject pack.');
const data = await fetchPrebuiltData(loaded.manifest, loaded.baseUrl, readLocal);
const { manifest, chunks, vectors, keywordIndex } = data;
const cases = JSON.parse(await readFile(evaluation, 'utf8'));
assert.ok(Array.isArray(cases) && cases.length, 'Provide at least one evaluation case.');
const localRoot = resolve(models, manifest.model.revision);
let local = {};
try {
  await access(join(localRoot, manifest.model.url, 'onnx/model_q4.onnx'));
  env.localModelPath = localRoot + sep;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  local = { local_files_only: true };
} catch {
  env.allowLocalModels = false;
}
env.cacheDir = resolve('.cache/models');
const tokenizer = await AutoTokenizer.from_pretrained(manifest.model.url, { revision: manifest.model.revision, ...local });
const model = await AutoModel.from_pretrained(manifest.model.url, {
  revision: manifest.model.revision, dtype: manifest.model.dtype, device: 'cpu', ...local,
  session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 }
});
async function embedding(text) {
  const output = await model(await tokenizer(text, {
    padding: true, truncation: true, max_length: manifest.model.sequenceLength
  }));
  const vector = Float32Array.from(output.sentence_embedding.data);
  for (const tensor of Object.values(output)) tensor.dispose?.();
  const norm = Math.hypot(...vector);
  return vector.map(value => value / norm);
}
try {
  for (const row of new Set([0, Math.floor(manifest.count / 2), manifest.count - 1])) {
    const vector = await embedding(documentInput(chunks[row]));
    const dot = vector.reduce((sum, value, column) => sum + value * vectors[row * manifest.dimensions + column], 0);
    assert.ok(dot > 0.99, `Stored embedding mismatch at row ${row}.`);
  }
  // Ranking requires a page identity, supplied by localPath for local-only materials.
  data.chunks = chunks.map(chunk => ({ ...chunk, sourceUrl: chunk.localPath || chunk.sourceUrl }));
  for (const { query, expectedTitle } of cases) {
    assert.ok(typeof query === 'string' && typeof expectedTitle === 'string' && expectedTitle);
    const vector = await embedding(manifest.queryPrefix + query);
    const semantic = chunks.map((_, row) => ({
      row, score: vector.reduce((sum, value, column) => sum + value * vectors[row * manifest.dimensions + column], 0)
    })).sort((a, b) => b.score - a.score);
    const matches = rankHybridResults(semantic.slice(0, 50), searchKeywords(keywordIndex, query), data, vector, 0.25, 5);
    const titles = matches.map(match => chunks[match.row].title);
    console.log(JSON.stringify({ query, titles }));
    assert.ok(titles.slice(0, 3).some(title => title.includes(expectedTitle)),
      `Expected "${expectedTitle}" in the top three sources for "${query}".`);
  }
} finally {
  await model.dispose();
}
console.log(`PASS: ${cases.length} relevance checks on ${manifest.count} prebuilt chunks.`);
