import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildBrowser } from './build-browser.mjs';
import { EMBEDDING_MODEL } from '../src/Subject.js';
import { GEMMA4_MODEL } from '../src/OfflineAnswerGenerator.js';

const { values } = parseArgs({ options: {
  out: { type: 'string', default: 'offline' }
} });
const root = resolve(values.out);
await mkdir(root, { recursive: true });
await buildBrowser(root);
const project = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(join(root, 'release.json'), JSON.stringify({
  application: project.name, version: project.version,
  embeddingModel: EMBEDDING_MODEL,
  generationModel: GEMMA4_MODEL,
  generationModelPath: `models/${GEMMA4_MODEL.revision}/${GEMMA4_MODEL.id}/${GEMMA4_MODEL.file}`,
  embeddingModelPath: `models/${EMBEDDING_MODEL.revision}/${EMBEDDING_MODEL.url}`
}, null, 2) + '\n');
console.log(`SourceDesk AI application prepared in ${root}. Models and existing subject packs were left unchanged.`);
console.log('Prepare shared weights with npm run prepare:models, then install a pack with npm run activate:subject -- --pack data/<id>.');
