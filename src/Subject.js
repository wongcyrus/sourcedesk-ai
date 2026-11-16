export const EMBEDDING_MODEL = {
  runtime: 'embeddinggemma',
  url: 'onnx-community/embeddinggemma-300m-ONNX',
  revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
  dtype: 'q4',
  sequenceLength: 512
};

export function isPackPath(path) {
  return typeof path === 'string' && path.length > 0 &&
    path.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..'].includes(part));
}

export function validateSubject(subject) {
  if (subject?.format !== 'sourcedesk-subject-v1' ||
      typeof subject.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subject.id) ||
      typeof subject.version !== 'string' || !/^[a-f0-9]{16}$/.test(subject.version) ||
      typeof subject.title !== 'string' || !subject.title.trim() || subject.title.length > 120 ||
      typeof subject.description !== 'string' || subject.description.length > 1000 ||
      typeof subject.attribution !== 'string' || subject.attribution.length > 2000 ||
      typeof subject.language !== 'string' || !subject.language ||
      !Array.isArray(subject.examples) || subject.examples.length > 10 ||
      !subject.examples.every(text => typeof text === 'string' && text.length <= 500) ||
      typeof subject.answerStyle !== 'string' || subject.answerStyle.length > 400 ||
      subject.manifest !== 'manifest.json' || subject.documents !== 'docs/index.html' ||
      !subject.files || typeof subject.files !== 'object' || Array.isArray(subject.files) ||
      !['manifest.json', 'docs/index.html'].every(path => path in subject.files) ||
      !Object.entries(subject.files).every(([path, hash]) => isPackPath(path) && /^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Invalid SourceDesk AI subject pack.');
  }
  return subject;
}

export function assertCompatibleModel(manifest, installed = EMBEDDING_MODEL) {
  if (manifest.dimensions !== 768 || manifest.documentPrefix !== 'title: none | text: ' ||
      manifest.queryPrefix !== 'task: search result | query: ' ||
      !['runtime', 'url', 'revision', 'dtype'].every(key => manifest.model?.[key] === installed[key])) {
    throw new Error('Subject requires a different embedding model or preprocessing. Install compatible shared models first.');
  }
}

export function localDocumentUrl(path, packBaseUrl) {
  const [file, fragment, ...extra] = typeof path === 'string' ? path.split('#') : [];
  if (!isPackPath(file) || !file.startsWith('docs/') || extra.length ||
      (fragment !== undefined && /[\s<>\\]/.test(fragment))) {
    throw new Error('Invalid bundled document path.');
  }
  return new URL(path, packBaseUrl);
}

export async function loadActiveSubject(assetBaseUrl, fetcher = fetch) {
  const base = new URL(assetBaseUrl);
  const read = async url => {
    const response = await fetcher(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('No active subject. Install and activate a subject pack, then reload.');
    return response.json();
  };
  const active = await read(new URL('active-subject.json', base));
  if (!isPackPath(active.path) || !/^subjects\/[a-z0-9-]+\/subject\.json$/.test(active.path)) {
    throw new Error('Invalid active subject path.');
  }
  const subjectUrl = new URL(active.path, base);
  const subject = validateSubject(await read(subjectUrl));
  const packBaseUrl = new URL('./', subjectUrl);
  const manifestUrl = new URL(subject.manifest, packBaseUrl);
  const [manifest, release] = await Promise.all([
    read(manifestUrl), read(new URL('release.json', base))
  ]);
  if (release.application !== 'sourcedesk-ai' || !release.embeddingModel) {
    throw new Error('Invalid SourceDesk AI shared application metadata.');
  }
  if (manifest.partial) throw new Error('A partial smoke-test pack cannot be activated.');
  assertCompatibleModel(manifest, release.embeddingModel);
  return {
    subject, manifestUrl, packBaseUrl,
    documentsUrl: localDocumentUrl(subject.documents, packBaseUrl)
  };
}
