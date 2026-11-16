import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile, copyFile, readdir, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';
import { GEMMA4_MODEL } from '../src/OfflineAnswerGenerator.js';
import { EMBEDDING_MODEL } from '../src/Subject.js';

const { values } = parseArgs({ options: {
  out: { type: 'string', default: 'offline' }
} });
const root = resolve(values.out);
const modelId = EMBEDDING_MODEL.url;
const revision = EMBEDDING_MODEL.revision;
await mkdir(root, { recursive: true });

async function fetchChecked(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Offline preparation download failed (${response.status}): ${url}`);
  return response;
}

async function download(url, destination, expected = {}) {
  try {
    const size = (await stat(destination)).size;
    if (size > 0 && (!expected.bytes || size === expected.bytes)) return;
  } catch {}
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetchChecked(url);
  const temporary = destination + '.download';
  const checksum = expected.sha256 ? createHash('sha256') : undefined;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, encoding, callback) {
      checksum?.update(chunk);
      callback(null, chunk);
    }
  }), createWriteStream(temporary));
  if (expected.bytes && (await stat(temporary)).size !== expected.bytes) throw new Error(`Incomplete download: ${url}`);
  if (checksum && checksum.digest('hex') !== expected.sha256) throw new Error(`Model checksum mismatch: ${url}`);
  await rename(temporary, destination);
}

await Promise.all(['js', 'css', 'vendor/onnx', 'licenses'].map(path => mkdir(join(root, path), { recursive: true })));
const require = createRequire(import.meta.resolve('@huggingface/transformers'));
const ortDirectory = dirname(require.resolve('onnxruntime-web'));
for (const file of await readdir(ortDirectory)) {
  if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(file)) {
    await copyFile(join(ortDirectory, file), join(root, 'vendor/onnx', file));
  }
}
await Promise.all([
  copyFile('LICENSE', join(root, 'licenses/vectorsearch.txt')),
  copyFile('node_modules/@huggingface/transformers/LICENSE', join(root, 'licenses/transformers.txt'))
]);
await Promise.all([
  download('https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE', join(root, 'licenses/tensorflow.txt')),
  download('https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE', join(root, 'licenses/onnxruntime.txt'))
]);

console.log('Preparing local EmbeddingGemma weights and tokenizer...');
const modelFiles = [
  'README.md', 'config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'special_tokens_map.json', 'added_tokens.json', 'tokenizer.model',
  'onnx/model_q4.onnx', 'onnx/model_q4.onnx_data'
];
for (const file of modelFiles) {
  await download(`https://huggingface.co/${modelId}/resolve/${revision}/${file}`,
    join(root, 'models', revision, modelId, file));
}
const termsPage = await fetchChecked('https://ai.google.dev/gemma/terms').then(response => response.text());
const termsDocument = parseHTML(termsPage).document;
const terms = termsDocument.querySelector('article') || termsDocument.querySelector('main');
if (!terms) throw new Error('Could not extract the official Gemma terms.');
await writeFile(join(root, 'licenses/gemma.txt'),
  `Source: https://ai.google.dev/gemma/terms\n\n${terms.textContent.trim()}\n`);

console.log('Preparing the local Gemma 4 E2B answer model (2.01 GB)...');
const generationDirectory = join(root, 'models', GEMMA4_MODEL.revision, GEMMA4_MODEL.id);
await download(`https://huggingface.co/${GEMMA4_MODEL.id}/resolve/${GEMMA4_MODEL.revision}/${GEMMA4_MODEL.file}`,
  join(generationDirectory, GEMMA4_MODEL.file), GEMMA4_MODEL);
await download(`https://huggingface.co/${GEMMA4_MODEL.id}/resolve/${GEMMA4_MODEL.revision}/README.md`,
  join(generationDirectory, 'README.md'));
const lmDirectory = dirname(createRequire(import.meta.url).resolve('@litert-lm/core/package.json'));
const wasmDirectory = join(root, 'vendor/litert-lm');
await mkdir(wasmDirectory, { recursive: true });
for (const file of await readdir(join(lmDirectory, 'wasm'))) {
  if (/\.(js|wasm)$/.test(file)) await copyFile(join(lmDirectory, 'wasm', file), join(wasmDirectory, file));
}
await download('https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/main/LICENSE',
  join(root, 'licenses/litert-lm.txt'));
await copyFile(join(root, 'licenses/litert-lm.txt'), join(root, 'licenses/gemma4.txt'));

console.log(`Shared models and runtimes prepared in ${root}. Subject packs reuse these files.`);
