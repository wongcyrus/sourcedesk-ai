# Adding a subject to SourceDesk AI

A new subject is a **prebuilt reference pack**, not a new app or a fine-tuned
model. The shared browser app, portable Python and model weights stay the same.
Only one subject is active at a time.

This guide is for maintainers. Students use the
[published installers](../README.md#available-subjects); they do not run these
build commands. `my-course` below is an authoring template, not an advertised
student course.

## Prepare the shared tools once

Use Node.js 24+ and Python 3.14. Run commands from the repository root.
On Windows, use `python` instead of `python3` for direct Python commands.

```sh
npm ci
npm run prepare:offline
npm run prepare:models
```

`prepare:offline` builds the app and writes its model/version metadata.
`prepare:models` obtains the shared weights, browser runtimes and licenses.
These steps may need internet and substantial disk space; budget about 8 GiB
for archives, installed assets and browser caching. Repeat them when shared
assets change, not for each new subject.

## Collect and organize the references

Choose a bounded syllabus and material you have permission to redistribute.
Keep original authorship, attribution and license terms. Remove obsolete or
conflicting versions rather than expecting the model to resolve them.
Put required license text in a supported source document, such as `license.md`,
as well as recording attribution: a standalone `LICENSE.txt` is not imported
by the generic document adapter.

Create this directory outside `data/`, which is generated output:

```text
my-course/
  subject.json
  evaluation.json
  content/
    introduction.md
    reference.pdf
    lesson.docx
    images/
      diagram.png
```

Only include files that actually belong to the course; the PDF, Word and image
entries are optional. A Markdown-only folder works too. For a small first
build, `content/introduction.md` can contain:

```markdown
# Version Control

## Commits

A Git commit records a snapshot of tracked content along with metadata
and references to its parent commits. A commit message explains the change.

## Branches

A Git branch is a named reference to a commit. As new commits are made
on a branch, the branch reference moves to the newest commit.
```

This short example demonstrates the workflow; replace or expand it with real
course material before distributing a subject.

| Input | Indexed text and local citations | Important limits |
| --- | --- | --- |
| Markdown (`.md`) | Sections with heading anchors; local images and Markdown links | Raw HTML is inert; remote images and external links are not included as live references |
| HTML (`.html`, `.htm`) | Sanitized local pages and heading anchors; links between imported HTML pages | Supply local files first; this is not a general website crawler or a faithful site mirror |
| PDF (`.pdf`) | Extracted text, cited by page, plus the original PDF | Scanned pages require OCR first; diagrams are not interpreted and reading order may need inspection |
| Word (`.docx`) | Converted text, common headings/tables and local anchors, plus the original file | Complex layout can change; only supported small embedded data images are retained |

All formats can share one folder. The browser reader uses generated HTML,
including extracted-text views of PDFs; originals are available separately.
Review the converted pages, especially tables, equations and code. Packaging
original PDFs/DOCX files does not remove any sensitive data they contain.

## Write the subject configuration

Save this as `my-course/subject.json`:

```json
{
  "id": "my-course",
  "title": "My Course",
  "description": "Course references with offline cited answers.",
  "language": "en",
  "attribution": "Your author and redistribution license information.",
  "examples": [
    "What does a Git commit record?",
    "What is a Git branch?"
  ],
  "answerStyle": "Explain step by step and use examples supported by the references.",
  "source": {
    "format": "documents",
    "path": "content"
  }
}
```

`source.path` is relative to this configuration file, not to the terminal's
working directory. Use a lowercase, hyphen-separated `id`; keep it stable
across course revisions. `title` controls the displayed subject name.
`examples` supplies up to ten suggested questions. `answerStyle` is an optional
preference of at most 400 characters; it cannot override grounding and citation
rules. `language` is metadata, not a translation or multilingual-quality
guarantee. Keyword tokenization currently targets English.

Do **not** add a manual `version`, checksum list or vector filenames. This
authored configuration is different from the generated
`data/my-course/subject.json`, which the builder creates with those fields.

## Build and inspect the pack

```sh
npm run build:subject -- --subject my-course/subject.json
```

The builder creates local documentation pages, heading/page sections, token
chunks, 768-dimensional CPU embeddings and a BM25 keyword index. It reuses the
embedding weights under `offline/models/` by default. If they are absent, it
may download the pinned embedding model into `.cache/models/`.

The generated layout is:

```text
data/my-course/
  subject.json                # Pack identity, metadata and file SHA-256 values
  manifest.json               # Dataset/model contract and data filenames
  chunks-<dataset-hash>.json   # Text and local citation targets
  vectors-<dataset-hash>.f32   # Normalized float32 vectors
  keywords-<dataset-hash>.json # BM25 postings
  docs/
    index.html
    ...
  originals/                  # Present for PDF/DOCX inputs
```

The pack's 16-character version covers its metadata and checksummed files.
The dataset hash in vector filenames has a different purpose; do not assume
it equals the pack version. Neither is the app's semantic version.
Do not edit generated files by hand: change the source and build again.

Embedding checkpoints allow an interrupted build to resume using the same
command and inputs. If source material or build parameters change, use a fresh
`--out` directory. Do not keep originals inside an output directory: the
builder regenerates its document views.

### Source adapters and builder options

| Option/source | Use |
| --- | --- |
| `source.format: "documents"` | Mixed local Markdown, HTML, PDF and DOCX; recommended for a new subject |
| `source.format: "markdown"` | Markdown-only source folder, using the same relative `source.path` |
| `source.format: "kubernetes"` | Specialized Kubernetes print-page/sitemap adapter, not needed by other subjects |
| `--out data/my-course-revision` | Choose a fresh output folder instead of `data/<id>` |
| `--models offline/models` | Reuse a shared models directory without copying weights into the pack |
| `--batch-size 4` | Tune CPU embedding batch size; changing it affects resume compatibility |
| `--max-tokens 512 --overlap-tokens 64` | Default token chunk size and overlap; evaluate changes before distribution |
| `--limit 4 --out data/my-course-smoke` | Partial preparation smoke test only; never activate or publish this output |

Remove `--limit` and build into a separate complete output directory before
evaluation or packaging. A limited build is marked partial even if its limit
is greater than the number of available chunks.

For official Python HTML, run `npm run prepare:python-source` before building
`examples/python/subject.json`. Kubernetes accepts local snapshots through
`--html <snapshot>` and `--sitemap <file>`; its adapter lives in
[`examples/kubernetes/source.mjs`](../examples/kubernetes/source.mjs).
The `networking`, `biology` and `mixed-documents` examples are developer
fixtures, not additional published courses.

## Test retrieval, then test answers and citations

Create `my-course/evaluation.json` with questions and distinctive expected
source-heading text. For the small reference above:

```json
[
  { "query": "What does a Git commit record?", "expectedTitle": "Commits" },
  { "query": "What is a Git branch?", "expectedTitle": "Branches" }
]
```

```sh
npm run test:retrieval -- data/my-course my-course/evaluation.json
npm run activate:subject -- --pack data/my-course
npm start
```

The CPU evaluator checks that sampled stored vectors match fresh embeddings,
then requires the expected title substring among the top three retrieved
sources for each question. It does **not** evaluate generated-answer quality.
Two cases are enough to illustrate the schema, not to qualify a real syllabus.

Open `http://localhost:8080/` in a Chromium browser with hardware WebGPU.
Reload after activation. Check representative questions, synonyms, exact
terms, follow-ups and questions not answered by the references. Inspect
citations and original-file links; confirm code/table rendering and behaviour
with internet disconnected. A small local model can still produce unsupported
claims despite grounding instructions.

Activation validates file checksums, dataset completeness, local citation
paths and embedding compatibility before replacing the active-subject pointer.
It preserves shared app/model files. Activate another installed pack and reload
to switch back; there is no cross-subject search or in-app subject picker.

## Publish without rebuilding the common package

Building a pack does not publish it. For the current app version, a maintainer
can add a new subject to the existing release without changing the app or
uploading model weights again.

1. Put the **exact common ZIP already published for the app version** in
   `dist/`, or choose its existing output folder with `--out`. For v0.2.2 its
   name is `sourcedesk-ai-0.2.2-common-windows-x64.zip`. Obtain it from your
   existing release workspace, a local share, or the release download; verify
   its published SHA-256 sidecar.
2. Generate the subject ZIP and both installers:

   ```sh
   npm run package:installer -- data/my-course
   npm run package:classroom -- data/my-course
   ```

3. Upload the generated subject ZIP, online CMD, classroom CMD and each
   `.sha256` sidecar to the matching GitHub release. Update the release notes
   and README subject table with the actual downloadable links only after
   publication. Do not mark an unbuilt example as a student download.
4. Download the published files and verify their hashes. Test Windows setup,
   activation and citation navigation, including a second subject installed
   from the same parent folder.

Both installer commands create the subject ZIP. If your common ZIP lives in
`dist/v0.2.2/`, pass `--out dist/v0.2.2` to **both** commands. To create only a
subject ZIP, use `npm run package:subject -- data/my-course`.

The current generator pins download URLs to
`wongcyrus/sourcedesk-ai/releases/download/v<app-version>/` and embeds the local
archive hashes. Publish to that exact location; a fork needs its release URL
updated in [`scripts/package-windows.py`](../scripts/package-windows.py).
Neither packaging command uploads automatically. If you rebuild the common
package, release it under a new app version instead of replacing a pinned asset.

### What students download

Keep all installers in one parent folder beside `sourcedesk-ai/`.
The online CMD reuses a complete, sufficiently recent common installation;
otherwise it downloads the common ZIP. The classroom CMD **never downloads
common files**: provide an installed compatible common package or its matching
ZIP by USB/local share. Provide the subject ZIP beside it as well for a fully
offline installation; otherwise it may download that subject.

Installing a subject on a compatible common installation does not download the
models again. To switch back to an already installed subject without any
transfer, drag its `app/subjects/<id>-<pack-hash>/` folder onto
`Activate-Subject.cmd` and reload. Rerunning a subject installer can download
its subject ZIP again unless you supply that ZIP locally.

Compatible app-only updates, such as v0.2.1 to v0.2.2, use the
[app update ZIP](../README.md#update-v021-without-downloading-models-again)
to preserve installed weights and subjects. Apply an app update before using
an installer that requires the newer app version.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No text extracted from a PDF | Run OCR first; inspect text extraction and reading order |
| Saved progress does not match | Keep original inputs to resume, or use a fresh `--out` directory for changed inputs |
| Partial pack rejected | Build without `--limit` into a complete output directory |
| Embedding-model incompatibility | Use the shared app's pinned model/preprocessing; do not mix independently embedded vectors |
| Missing application assets or common ZIP during packaging | Prepare browser runtimes with `prepare:models`; supply the exact published common ZIP in the chosen output directory |
| Classroom setup stops on an older app | Apply its compatible app-only update or provide the required common ZIP locally |
| Browser loads the old course | Reload after activation; keep the same `http://localhost:8080/` origin |
| First generation is slow or fails | Check WebGPU, disk/memory capacity and the target device; a cached file does not skip GPU initialization |

For the separation of packs, runtime and model caches, see the
[system design](../README.md#system-design) and
[design blog](../blog/gde-medium-blog.md).
