import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, rm, access } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { chunkSections, documentInput, buildKeywordIndex, DOCUMENT_PREFIX, QUERY_PREFIX } from './corpus.mjs';
import { EMBEDDING_MODEL, validateSubject } from '../src/Subject.js';
import { markdownSource } from './markdown-source.mjs';

const { values } = parseArgs({
  options: {
    subject: { type: 'string' },
    models: { type: 'string', default: 'offline/models' },
    html: { type: 'string' },
    sitemap: { type: 'string' },
    out: { type: 'string' },
    'max-tokens': { type: 'string', default: '512' },
    'overlap-tokens': { type: 'string', default: '64' },
    'batch-size': { type: 'string', default: '4' },
    limit: { type: 'string' },
    help: { type: 'boolean' }
  }
});

if (values.help) {
  console.log('Usage: npm run build:subject -- --subject examples/networking/subject.json [--out data/networking]');
  console.log('Options: --max-tokens 512, --overlap-tokens 64, --batch-size 4');
  console.log('--limit N builds only the first N chunks for a smoke test, not the full corpus.');
  process.exit(0);
}

if (!values.subject) throw new Error('Provide --subject path/to/subject.json.');
const configPath = resolve(values.subject);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const metadata = {
  format: 'sourcedesk-subject-v1',
  id: config.id, title: config.title, description: config.description || '',
  language: config.language || 'en', attribution: config.attribution || '',
  examples: config.examples || [], answerStyle: config.answerStyle || '',
  manifest: 'manifest.json', documents: 'docs/index.html'
};
validateSubject({
  ...metadata, version: '0'.repeat(16),
  files: { 'manifest.json': '0'.repeat(64), 'docs/index.html': '0'.repeat(64) }
});
if (!['markdown', 'kubernetes'].includes(config.source?.format)) throw new Error('Supported sources: markdown, kubernetes.');
values.out ||= join('data', config.id);
const modelUrl = EMBEDDING_MODEL.url;
const batchSize = Number(values['batch-size']);
const maxTokens = Number(values['max-tokens']);
const overlapTokens = Number(values['overlap-tokens']);
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (!Number.isInteger(batchSize) || batchSize < 1 ||
    (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) ||
    !Number.isInteger(maxTokens) || maxTokens < 32 || maxTokens > 2048 ||
    !Number.isInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= maxTokens / 2) {
  throw new Error('Use a positive batch size/limit, 32-2048 tokens, and overlap below half the chunk size.');
}

await mkdir(values.out, { recursive: true });
const progressPath = join(values.out, '.build-progress.json');
const progressVectorsPath = join(values.out, '.build-vectors.f32');
let progress;
try {
  progress = JSON.parse(await readFile(progressPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log(`Reading ${config.title}...`);
const ownershipPath = join(values.out, '.sourcedesk-build.json');
try {
  await access(join(values.out, 'docs'));
  let owner;
  try {
    owner = JSON.parse(await readFile(ownershipPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    owner = validateSubject(JSON.parse(await readFile(join(values.out, 'subject.json'), 'utf8')));
  }
  if (owner.id !== config.id) throw new Error('Use an output directory belonging to this subject.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // An existing docs folder without build metadata must never be overwritten.
  try {
    await access(join(values.out, 'docs'));
    throw new Error('Output docs already exist without SourceDesk build metadata. Use a fresh --out directory.');
  } catch (missing) {
    if (missing.code !== 'ENOENT') throw missing;
  }
}
await writeFile(ownershipPath, JSON.stringify({ id: config.id }));
await rm(resolve(values.out, 'docs'), { recursive: true, force: true });
let extracted;
let sourceMetadata = {};
if (config.source.format === 'kubernetes') {
  const { fetchText, kubernetesSource, SOURCE_URL } = await import('../examples/kubernetes/source.mjs');
  const [html, sitemap] = await Promise.all([
    values.html ? readFile(values.html, 'utf8') : progress ?
      readFile(join(values.out, 'source.html'), 'utf8') : fetchText(SOURCE_URL),
    values.sitemap ? readFile(values.sitemap, 'utf8') : progress ?
      readFile(join(values.out, 'sitemap.xml'), 'utf8') : fetchText('https://kubernetes.io/en/sitemap.xml')
  ]);
  extracted = await kubernetesSource(html, sitemap, values.out, config);
  await Promise.all([
    writeFile(join(values.out, 'source.html'), html),
    writeFile(join(values.out, 'sitemap.xml'), sitemap)
  ]);
  sourceMetadata = { sourceUrl: SOURCE_URL, sourceSha256: createHash('sha256').update(html).digest('hex') };
} else {
  if (typeof config.source.path !== 'string') throw new Error('Markdown source requires a content path.');
  extracted = await markdownSource(resolve(dirname(configPath), config.source.path), values.out, config);
}
const { sections, unresolvedPages = [] } = extracted;
console.log(`Extracted ${sections.length} sections; loading the offline embedding model...`);
env.cacheDir = resolve('.cache/models');
const localModelRoot = resolve(values.models, EMBEDDING_MODEL.revision);
let local = {};
try {
  await access(join(localModelRoot, modelUrl, 'onnx/model_q4.onnx'));
  env.localModelPath = localModelRoot + sep;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  local = { local_files_only: true };
  console.log('Reusing the installed shared embedding model.');
} catch {
  env.allowLocalModels = false;
}
const tokenizer = await AutoTokenizer.from_pretrained(modelUrl, { revision: EMBEDDING_MODEL.revision, ...local });
const extractor = await AutoModel.from_pretrained(modelUrl, {
  revision: EMBEDDING_MODEL.revision, dtype: EMBEDDING_MODEL.dtype, device: 'cpu', ...local,
  session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 }
});
const allChunks = chunkSections(sections, tokenizer, maxTokens, overlapTokens);
const chunks = limit === undefined ? allChunks : allChunks.slice(0, limit);
if (!chunks.length) throw new Error('No documentation chunks were extracted.');
if (limit !== undefined) console.warn(`SMOKE TEST: building ${chunks.length} of ${allChunks.length} chunks.`);
if (unresolvedPages.length) {
  console.warn(`${unresolvedPages.length} pages use their print-page anchor because their canonical URL could not be resolved.`);
}

const model = {
  ...EMBEDDING_MODEL,
  sequenceLength: maxTokens
};
let vectors;
let dimensions;
const chunksJson = JSON.stringify(chunks);
const fingerprint = createHash('sha256')
  .update(JSON.stringify({ model, batchSize })).update(chunksJson).digest('hex');
const ordered = chunks.map((chunk, row) => ({
  chunk, row, tokens: tokenizer(documentInput(chunk)).input_ids.data.length
})).sort((left, right) => left.tokens - right.tokens || left.row - right.row);
let completed = 0;
if (progress) {
  if (progress.fingerprint !== fingerprint || progress.dimensions !== 768 ||
      !Number.isInteger(progress.completed) || progress.completed < 0 ||
      progress.completed > chunks.length ||
      (progress.completed !== chunks.length && progress.completed % batchSize !== 0)) {
    throw new Error('Saved build progress does not match these chunks/model/batch size. Use a different --out directory.');
  }
  const saved = await readFile(progressVectorsPath);
  if (saved.length !== chunks.length * progress.dimensions * 4) throw new Error('Truncated saved build vectors.');
  dimensions = progress.dimensions;
  vectors = new Float32Array(saved.buffer, saved.byteOffset, saved.length / 4).slice();
  completed = progress.completed;
  console.log(`Resuming ${completed} / ${chunks.length} saved embeddings.`);
}
for (let offset = completed; offset < ordered.length; offset += batchSize) {
  const entries = ordered.slice(offset, offset + batchSize);
  const batch = entries.map(entry => entry.chunk);
  const inputs = await tokenizer(batch.map(documentInput), {
    padding: true, truncation: true, max_length: maxTokens
  });
  const tensors = await extractor(inputs);
  const output = tensors.sentence_embedding;
  if (!vectors) {
    dimensions = output.dims[1];
    vectors = new Float32Array(chunks.length * dimensions);
  }
  if (output.data.length !== batch.length * dimensions) throw new Error('Unexpected embedding dimensions.');
  for (let index = 0; index < entries.length; index++) {
    vectors.set(output.data.subarray(index * dimensions, (index + 1) * dimensions), entries[index].row * dimensions);
  }
  for (const tensor of Object.values(tensors)) tensor.dispose?.();
  completed = Math.min(offset + batch.length, chunks.length);
  console.log(`Embedded ${completed} / ${chunks.length} chunks`);
  if (completed % (batchSize * 16) === 0 || completed === chunks.length) {
    await writeFile(progressVectorsPath + '.download', Buffer.from(vectors.buffer));
    await rename(progressVectorsPath + '.download', progressVectorsPath);
    await writeFile(progressPath + '.download', JSON.stringify({ fingerprint, model, dimensions, completed }));
    await rename(progressPath + '.download', progressPath);
    console.log(`Saved progress: ${completed} / ${chunks.length} embeddings.`);
  }
}
await extractor.dispose();

for (let row = 0; row < chunks.length; row++) {
  let norm = 0;
  for (let column = 0; column < dimensions; column++) {
    const value = vectors[row * dimensions + column];
    norm += value * value;
  }
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Model produced an invalid embedding norm.');
  const length = Math.sqrt(norm);
  for (let column = 0; column < dimensions; column++) vectors[row * dimensions + column] /= length;
}
const vectorBuffer = Buffer.alloc(vectors.byteLength);
for (let index = 0; index < vectors.length; index++) {
  if (!Number.isFinite(vectors[index])) throw new Error('Model produced a non-finite embedding.');
  vectorBuffer.writeFloatLE(vectors[index], index * 4);
}
const keywordJson = JSON.stringify(buildKeywordIndex(chunks));
const version = createHash('sha256')
  .update(JSON.stringify({ model, maxTokens, overlapTokens }))
  .update(chunksJson).update(keywordJson).update(vectorBuffer).digest('hex').slice(0, 16);
const manifest = {
  format: 'vectorsearch-prebuilt-v1',
  version,
  ...sourceMetadata,
  model,
  documentPrefix: DOCUMENT_PREFIX,
  queryPrefix: QUERY_PREFIX,
  normalized: true,
  count: chunks.length,
  dimensions,
  maxTokens,
  overlapTokens,
  partial: limit !== undefined,
  unresolvedPages,
  chunks: `chunks-${version}.json`,
  vectors: `vectors-${version}.f32`,
  keywords: `keywords-${version}.json`,
  encoding: 'float32-le',
  attribution: config.attribution || ''
};
await mkdir(values.out, { recursive: true });
await Promise.all([
  writeFile(join(values.out, manifest.chunks), chunksJson),
  writeFile(join(values.out, manifest.keywords), keywordJson),
  writeFile(join(values.out, manifest.vectors), vectorBuffer)
]);
await writeFile(join(values.out, 'manifest.json.download'), JSON.stringify(manifest, null, 2) + '\n');
await rename(join(values.out, 'manifest.json.download'), join(values.out, 'manifest.json'));
const files = {};
async function addFile(path) {
  files[relative(values.out, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex');
}
async function addDirectory(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await addDirectory(path);
    else await addFile(path);
  }
}
await Promise.all(['manifest.json', manifest.chunks, manifest.vectors, manifest.keywords].map(file => addFile(join(values.out, file))));
await addDirectory(join(values.out, 'docs'));
const packVersion = createHash('sha256').update(JSON.stringify(metadata))
  .update(JSON.stringify(Object.entries(files).sort())).digest('hex').slice(0, 16);
const subject = validateSubject({ ...metadata, version: packVersion, files });
await writeFile(join(values.out, 'subject.json.download'), JSON.stringify(subject, null, 2) + '\n');
await rename(join(values.out, 'subject.json.download'), join(values.out, 'subject.json'));
await Promise.all([unlink(progressPath), unlink(progressVectorsPath)]);
console.log(`Built ${config.title}: ${chunks.length} vectors (${dimensions} dimensions) in ${values.out}.`);
