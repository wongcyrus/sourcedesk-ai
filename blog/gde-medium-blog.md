# One Offline AI App, Many Independent Courses: Designing SourceDesk AI

### How a Kubernetes documentation assistant became a reusable browser RAG system, and how educators can add a subject without shipping the models again.

<img src="../assets/logo-mark.svg" alt="SourceDesk AI logo" width="96" height="96">

A classroom AI assistant should not require every student to buy an API
subscription, install a development environment, or download the same model
again for each course.

That was the motivation for **[SourceDesk AI](https://github.com/wongcyrus/sourcedesk-ai)**.
It runs retrieval and answer generation locally in the browser, using a
prepared set of references and citations that open the corresponding local
documents. A small localhost server serves the files; it is not an inference
backend.

The project started as
[Kubernetes WebAI RAG](https://github.com/wongcyrus/kubernetes-webai-rag), itself
derived from [Jason Mayes' VectorSearch.js](https://github.com/jasonmayes/VectorSearch.js).
Kubernetes is still a supported subject. The important change is that
Kubernetes is no longer the application.

Python Programming and Kubernetes Documentation now have published Windows
installers. Other subjects can use the same app and models, with their own
prebuilt reference packs.

## The design decision: separate the course from the machine that runs it

The reusable unit is not "an application per subject." It is **one common
installation plus independently versioned subject packs**:

| Shared across courses | Different for each subject |
| --- | --- |
| Browser interface and local document reader | Subject title, description and suggested questions |
| Portable Windows Python and launch scripts | Reference material and generated local pages |
| EmbeddingGemma and Gemma 4 model weights | Precomputed document vectors and BM25 index |
| ONNX/LiteRT-LM browser runtimes | Attribution, answer-style preference and checksums |

This is not a multi-subject agent that searches every installed course.
**Exactly one subject is active.** Switching to Python means loading the Python
pack, not adding Python to an ever-growing Kubernetes prompt.

That boundary makes teaching material easier to inspect and update. It also
keeps classroom distribution practical: a new course should not require a new
copy of roughly 2 GB of shared files.

## Prepare the expensive work once, before class

There are two distinct phases. Preparation may need internet and a maintainer's
development tools. Student use does not need those tools or a cloud service.

```text
Maintainer preparation

Source documents + subject.json
             |
       source adapter
             |
Local HTML + heading/page sections
             |
Chunking + CPU document embeddings
             |
Vectors + BM25 postings + metadata/checksums
             |
        Subject ZIP
```

The adapter normalizes different input formats into sections with text,
headings and local citation targets. The shared builder then chunks the
sections, computes 768-dimensional EmbeddingGemma vectors on the CPU,
normalizes them, and writes a float32 matrix and keyword postings.

Students receive those completed artifacts. Their browser does not spend the
first lesson scraping a website, parsing Word documents or embedding thousands
of passages. The published Kubernetes pack, for example, contains 16,483
prebuilt chunks. That number belongs to that snapshot, not to the app's design.

The main code paths are
[`scripts/build-subject.mjs`](../scripts/build-subject.mjs),
[`scripts/document-source.mjs`](../scripts/document-source.mjs), and
[`scripts/markdown-source.mjs`](../scripts/markdown-source.mjs).
The Kubernetes-specific importer lives under `examples/kubernetes/`.
Adding ordinary course documents does not require touching that importer.

## What actually happens when a student asks a question?

```text
Question + bounded follow-up context
                  |
         local query embedding
                  |
Active pack: semantic search + BM25
                  |
       reciprocal rank fusion
                  |
      selected reference passages
                  |
 Gemma 4 E2B through local LiteRT-LM
                  |
    streamed answer with citations
                  |
       local document reader
```

Semantic retrieval helps when a student's wording differs from the reference.
BM25 helps with exact terms, commands and identifiers. Reciprocal rank fusion
combines their rankings while the retrieval logic groups related heading
results and limits page crowding.

Only the selected passages become evidence for the answer. Recent questions
help resolve follow-ups, but generated text from a previous turn is not treated
as reference material. Each answer retains its own source list, so an older
`[1]` still opens that answer's first source after another question is asked.

Generation uses **Gemma 4 E2B** through **LiteRT-LM**; query embedding uses
**EmbeddingGemma** with the pinned ONNX runtime setup. The browser search layer
uses **TensorFlow.js** and WebGPU where available. Hardware still matters,
especially for generation: a browser application is not a promise that every
integrated GPU will run it well.

The generator keeps context bounded and creates a fresh native conversation
for each answer. An author's optional `answerStyle` can request beginner
explanations or supported examples, but it does not replace the application's
grounding rules. Those rules ask the model to acknowledge insufficient local
evidence; they cannot guarantee that it always will.

## Add a subject without changing the application

Here is the maintainer workflow. Students should use installers, not these
commands. The complete, copyable procedure is in the
[subject-authoring guide](../docs/adding-subject.md).

### Start with references, not a new prompt

Choose the syllabus boundary, collect distributable references and retain their
licenses. Good headings, accurate text and a coherent source snapshot matter
more than an elaborate prompt.

The generic `documents` adapter accepts mixed local Markdown, HTML, text-based
PDF and DOCX files:

```text
my-course/
  subject.json
  evaluation.json
  content/
    introduction.md
    reference.pdf
    lesson.docx
```

This is an authoring template, not a third published student course. Only the
actual documents are required; a Markdown-only course works.

The adapter makes local HTML views for the reader. Markdown, HTML and Word
headings become citation anchors. PDF citations target extracted-text pages,
with a separate link to the original PDF. Original Word files are retained too.

There are limits: scanned PDFs need OCR first, diagrams are not interpreted,
and complex Word/PDF layouts need inspection. Generic HTML input is a set of
local pages, not an automatic website crawler. A source URL alone is not a
course pack.

### Describe the subject in a small configuration

```json
{
  "id": "my-course",
  "title": "My Course",
  "description": "Course references with offline cited answers.",
  "language": "en",
  "attribution": "Your author and redistribution license information.",
  "examples": ["What are the main concepts in these references?"],
  "answerStyle": "Explain step by step and cite supporting passages.",
  "source": { "format": "documents", "path": "content" }
}
```

`content` is resolved relative to this configuration file. The stable `id`
identifies the course; the builder generates its content version and file
checksums. Changing a title, reference or style preference produces a new pack
version. No UI fork or model fine-tuning is needed.

### Build once, inspect the result

After preparing the shared development assets:

```sh
npm ci
npm run prepare:offline
npm run prepare:models

npm run build:subject -- --subject my-course/subject.json
```

The output goes to `data/my-course/`. It contains a generated `subject.json`,
dataset manifest, chunk text, vectors, keyword postings and local documents,
but no model weights.

The first three commands prepare shared tools/assets; they are not repeated
for every subject. The builder reuses installed embedding weights. Interrupted
embedding work can resume with unchanged inputs. A changed corpus or build
configuration should use a fresh output directory.

For a quick pipeline check, `--limit` can produce a partial smoke-test pack.
That is deliberately not a distributable course: activation and evaluation
require a complete build.

### Test retrieval separately from generated answers

Use real questions and distinctive expected headings in `evaluation.json`.
For example, material with a heading called "Defining Functions" could use:

```json
[
  {
    "query": "How do I define a function?",
    "expectedTitle": "Defining Functions"
  }
]
```

The expected heading must actually exist in your material. Then run:

```sh
npm run test:retrieval -- data/my-course my-course/evaluation.json
npm run activate:subject -- --pack data/my-course
npm start
```

The evaluator recomputes sampled document embeddings and checks whether each
expected heading appears among the top three retrieved sources. It does not
grade the generated answer.

Open `http://localhost:8080/`, then test explanations, follow-ups, citations and
questions outside the syllabus. Disconnect internet and repeat on the actual
student machines. Check converted tables, original-file links and unsupported
claims, not just whether the chat box returns text.

## Activation is a pointer change, not a reinstall

The installed app selects its subject through `active-subject.json`, which
points to a versioned folder under `app/subjects/`.

Before changing that pointer, activation verifies checksums, dataset structure,
citation file paths and embedding-model compatibility. An incomplete or
incompatible pack leaves the previous selection unchanged. Reloading the
browser starts a fresh chat using the newly selected pack.

The **app uses semantic versions**, such as `0.2.2`. **Subjects use content
hashes**, not matching app-version numbers. Compatibility depends on the
embedding model and preprocessing contract, not on pretending a Python
tutorial and a browser UI share one release cycle.

This distinction also tells us what needs rebuilding:

- New course documents: rebuild and distribute that subject pack.
- A UI change with compatible models: release an app update.
- A changed embedding model: rebuild affected indexes and distribute compatible
  shared assets.

## The classroom bandwidth problem is a distribution problem

The most useful optimization was not a faster tensor operation. It was stopping
the same large download from happening for every subject.

The [v0.2.2 release](https://github.com/wongcyrus/sourcedesk-ai/releases/tag/v0.2.2)
provides a reusable common ZIP, independent Python and Kubernetes subject ZIPs,
and two installer styles:

| Installer | Behaviour |
| --- | --- |
| `Install-<subject>-<hash>-RAG.cmd` | Reuses a complete, sufficiently recent common installation; otherwise downloads it |
| `Classroom-<subject>-<hash>-RAG.cmd` | Uses compatible installed common files or a locally supplied common ZIP; never downloads common files |

Put all installers in the same parent folder beside `sourcedesk-ai/`. Supply
the matching subject ZIP locally too if the entire installation must be
offline. Otherwise classroom setup may download the subject, but not the common
package.

For a new subject, maintainers reuse the **exact already-published common
archive** and generate:

```sh
npm run package:installer -- data/my-course
npm run package:classroom -- data/my-course
```

The generator expects that common ZIP in its output folder and pins archive
hashes and release URLs into the CMD. Building does not upload anything:
publish the new subject, installers and checksum sidecars at those URLs before
sharing links. Do not rebuild and overwrite a common asset whose checksum is
already embedded in student installers.

For compatible app changes, the v0.2.1-to-v0.2.2
[app-only update ZIP](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/sourcedesk-ai-0.2.2-windows-x64-app.zip)
is about **77 MB**, rather than a new roughly 2 GB common download. It preserves
installed models, subjects and the active selection. Close the app/server,
merge the ZIP into the existing installation's parent folder, replace files
and restart. Apply it before running an installer that requires v0.2.2.

## Two copies of weights, but not one copy per course

There is a useful distinction between the model files installed with the app
and browser storage.

The local server serves installed weights. When available, the browser's
**Origin Private File System (OPFS)** caches an additional generation-model
copy for later loads. That cache is keyed to the model identity and browser
origin, not the subject.

Keep `http://localhost:8080/` stable. Changing hostname or port can create a
different storage origin. Clearing browser data can also require the browser
to read the model again from the local server, although internet is still
unnecessary if the installed files remain present. Cache reuse does not avoid
GPU initialization.

This is why the disk budget is about 8 GiB, rather than only the size of one
download.

## What offline does and does not promise

During use, retrieval and generation run on the device. Application assets
are same-origin, documentation pages are rendered without scripts, and model
output cannot insert arbitrary active HTML or answer links. Chat history is
kept in the current tab, not sent to a cloud conversation service.

These are useful boundaries, not a guarantee of correct answers or exam
integrity. Source quality, hardware performance, browser storage and classroom
policy still matter. Checksums show that a pack is consistent with its
manifest, not that its author is trustworthy. The UI's VTC programme link is
an optional external website; it is not required for offline inference.

There are no cloud inference API calls during local use, but devices, storage,
preparation and support are not free. "Offline" also does not mean "never
download anything": somebody must first prepare and distribute the assets.

## The reusable part is the workflow

SourceDesk AI is not limited to Kubernetes because the subject is data, not a
branch of the application. An educator can prepare references, build and test
a pack, publish a small set of subject-specific files, and reuse the same
student installation.

That makes the teaching workflow concrete: **prepare once, distribute shared
assets once, change the subject without changing the engine, and keep the
evidence visible beside every answer.**

### Project and further reading

- [SourceDesk AI repository](https://github.com/wongcyrus/sourcedesk-ai)
- [Windows downloads: v0.2.2](https://github.com/wongcyrus/sourcedesk-ai/releases/tag/v0.2.2)
- [Add and publish a new subject](../docs/adding-subject.md)
- [System design and installation guide](../README.md)
- [Original Kubernetes WebAI RAG](https://github.com/wongcyrus/kubernetes-webai-rag)
- [Upstream VectorSearch.js](https://github.com/jasonmayes/VectorSearch.js)
- [VTC Higher Diploma in Cloud and Data Centre Administration](https://www.vtc.edu.hk/admission/en/programme/it114115-higher-diploma-in-cloud-and-data-centre-administration/)

**Suggested Medium tags:** `WebAI`, `RAG`, `Education`, `Gemma`, `WebGPU`
