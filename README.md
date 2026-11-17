# SourceDesk AI

<img src="assets/logo-mark.svg" alt="SourceDesk AI logo" width="96" height="96">

**Your documents. AI answers. Fully offline.**

SourceDesk AI answers questions using a prebuilt local knowledge pack and opens
supporting passages in a document reader. Retrieval and generation run in the
browser with EmbeddingGemma, Gemma 4 E2B, LiteRT-LM and WebGPU. A localhost server
only serves files; there is no cloud inference backend.

The application, models and subject content are independent. Changing a subject
does not rebuild application code, copy model weights or create a new browser
model-cache entry. One subject is active at a time; there is no cross-subject
search or in-app subject selector.

This project is derived from
[kubernetes-webai-rag](https://github.com/wongcyrus/kubernetes-webai-rag) and
[Jason Mayes' VectorSearch.js](https://github.com/jasonmayes/VectorSearch.js).
Original authorship and Apache-2.0 notices are retained.

## Available subjects

| Subject | Materials | Online installer | Classroom installer (never downloads common) |
| --- | --- | --- | --- |
| Python Programming | [Official Python tutorial](examples/python/subject.json) | [Install Python](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Install-python-7e90ca1e37757550-RAG.cmd) | [Classroom Python](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Classroom-python-7e90ca1e37757550-RAG.cmd) |
| Kubernetes Documentation | [Kubernetes documentation snapshot](examples/kubernetes/subject.json), 16,483 chunks | [Install Kubernetes](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Install-kubernetes-bdea1cdb16cc0f64-RAG.cmd) | [Classroom Kubernetes](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Classroom-kubernetes-bdea1cdb16cc0f64-RAG.cmd) |

## For students: install a course on Windows

Download
[Install-python-7e90ca1e37757550-RAG.cmd](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Install-python-7e90ca1e37757550-RAG.cmd)
from the [v0.2.2 release](https://github.com/wongcyrus/sourcedesk-ai/releases/tag/v0.2.2).
Save it in the folder where you want the app installed, then double-click it.
On Windows 11 it downloads and verifies the common app/models and Python
subject pack, extracts them, activates the course and starts the app. No
administrator access, developer tools or manual unzip steps are needed. The
common and subject ZIPs are also listed on the release page.

| Item | Contains | Download behavior |
| --- | --- | --- |
| Installer CMD | Windows setup for one subject-pack version | Run to install or update that subject |
| Classroom CMD | Classroom setup for one subject-pack version | Never downloads common files; uses an installed common package or a local common ZIP |
| Common ZIP | App, portable Python and shared models | Downloaded when missing, incomplete or older than the installer requires; reused by every subject |
| App-only update ZIP | App and portable Python, without model weights or subject content | Updates an existing compatible installation without downloading models again |
| Subject ZIP | One course's indexed content and citations | Downloaded for that subject; small compared with the common ZIP |

To install a newer Python subject pack later, run its release installer again.
It reuses the common files and downloads only the subject pack. Maintainers
prepare and publish the installer and archives. The first install downloads
about 2 GB; allow about 8 GiB for extraction and browser caching.

### Update v0.2.1 without downloading models again

Download the [v0.2.2 app-only update ZIP](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/sourcedesk-ai-0.2.2-windows-x64-app.zip).
Close the app's browser tab and server terminal. Extract the ZIP into the
**parent folder containing your existing `sourcedesk-ai/` directory**, choosing
to replace existing files. Do not delete the installed directory first.
Run `sourcedesk-ai/Start-RAG.cmd` again.

This update includes the logo and VTC programme link. It preserves model files,
installed subjects and the active-subject selection. Model versions are
unchanged from v0.2.1. New installations still need the common package.
Apply this update **before** running a v0.2.2 subject installer to avoid a new
common-package download. Instructors can share the same update ZIP offline.

### Classroom setup: no common-package download

Use the classroom installer links in the subject table above. Instructors
prepare the shared files; students never build anything.

| What the student already has | What classroom setup does |
| --- | --- |
| A complete common installation | Reuses it without downloading or extracting common files |
| A local common ZIP from USB or a shared folder | Verifies and extracts it, keeping the ZIP for reuse |
| Neither | Stops with instructions; never falls back to a common-package download |

1. The instructor downloads the common ZIP once and shares it by USB or a local
   network folder, along with `Classroom-<subject>-<pack-hash>-RAG.cmd`.
2. Students copy the classroom CMD into their install folder, alongside the
   existing `sourcedesk-ai/` directory or the common ZIP. For Python, the common
   ZIP is `sourcedesk-ai-0.2.2-common-windows-x64.zip`.
3. Students double-click the classroom CMD. It installs and starts the subject.

Put the matching subject ZIP beside the classroom CMD too for a fully offline
installation. Otherwise only that small subject ZIP is downloaded. Keep all
course installers in the same install folder to reuse the common files.

To test reuse, run Classroom Python, then Classroom Kubernetes from that same
folder. The Kubernetes subject pack is about 61 MB; no common files are
downloaded or replaced. Reload the browser after switching subjects. Run
Classroom Python again to switch back.

## For maintainers: test a Git clone on Windows

Install Node.js 24+ and Python 3.14 with the Windows `py` launcher, clone this
repository, then double-click `Test-Python.cmd` from the repository root. The
batch installs dependencies, downloads shared models and tutorial sources,
builds the Python pack, and starts the app. It is a developer test path, not a
student setup. The prebuilt bundle is created separately as described below.

## Prepare from source (maintainers)

These are maintainer commands, not student setup steps. Use Node.js 24+ and
Python 3.14. On Windows, use `python` instead of `python3` if necessary.
Internet is needed to obtain npm dependencies and the initial model/runtime
downloads. Generated datasets, models and archives are excluded from Git.

```sh
npm ci

# Shared application: no model downloads, preserves existing packs and weights.
npm run prepare:offline

# Download shared models, browser runtimes and component licenses once.
npm run prepare:models

# Build content on the maintainer's CPU, reusing installed embedding weights.
npm run build:subject -- --subject examples/networking/subject.json

# Prepare and build the official Python tutorial as a separate subject pack.
npm run prepare:python-source
npm run build:subject -- --subject examples/python/subject.json

# Validate, install and activate the completed content pack.
npm run activate:subject -- --pack data/networking

npm start
```

Open **http://localhost:8080/** in an up-to-date Chromium browser with hardware
WebGPU. Localhost is a secure context; HTTPS certificates and insecure-origin
flags are unnecessary. Leave the address and port unchanged so the browser can
reuse its model cache.

The generation model is about 2 GB. Allow approximately 8 GiB for downloaded
archives, extracted files and browser caching. GPU initialization still repeats
after a page reload, even when weights are cached.

## Create your own subject

Copy an example configuration and create a folder of source documents:

```text
my-course/
  subject.json
  content/
    introduction.md
    chapter-one.pdf
    notes.docx
    images/
      diagram.png
```

```json
{
  "id": "my-course",
  "title": "My Course",
  "description": "A local reference for this course.",
  "language": "en",
  "attribution": "Your author and redistribution license information.",
  "examples": ["What are the main concepts?"],
  "answerStyle": "Explain concepts plainly with supported examples.",
  "source": { "format": "documents", "path": "content" }
}
```

Paths in the source configuration are relative to that configuration file.
Use lowercase letters, digits and hyphens for the subject ID. Include only
material you have permission to distribute; retain its attribution and license.
The optional style preference cannot remove the application's grounding and
citation rules.

```sh
npm run build:subject -- --subject my-course/subject.json
npm run activate:subject -- --pack data/my-course
```

Reload the page to start a new conversation using the new subject. Old packs
can remain installed or be removed after another pack is active. The shared
application, weights and checksum-keyed browser cache are unchanged.

The `documents` source accepts `.md`, `.html`, `.htm`, `.pdf` and `.docx` files,
including mixed folders. Markdown, HTML and Word headings become citation
anchors; PDF citations target extracted-text pages. HTML is sanitized and
internal links are rewritten to local pack pages. Safe local HTML views are
generated for every source, so the app's reader stays the same. Packs retain
original PDFs and Word files and offer a separate open/download link. PDF
extraction requires selectable text; scanned pages need OCR first. Word
conversion preserves common text, headings and tables; complex layout may
differ from Word. DOCX embedded images are included only when safely
representable as small supported data images. Markdown keeps the existing
support for local images and relative Markdown links. Remote links are
disabled, remote images are omitted, and raw HTML in Markdown is displayed as
text rather than executed.

The subject examples include `networking`, `biology`, `mixed-documents` and
`python`; `kubernetes` uses the Kubernetes print-page adapter:

`networking`, `biology` and `mixed-documents` are small developer samples for
testing the builder, not complete courses or student downloads. Only published
subjects are listed in the student-facing table above.

```sh
npm run build:subject -- --subject examples/networking/subject.json
npm run build:subject -- --subject examples/biology/subject.json
npm run build:subject -- --subject examples/mixed-documents/subject.json
npm run build:subject -- --subject examples/python/subject.json
npm run build:subject -- --subject examples/kubernetes/subject.json
```

The Python example uses the official Python 3.15 tutorial, downloaded by
`npm run prepare:python-source` into an ignored local source directory. Its
documentation is under the PSF License Version 2.0. Build it as an
independently switchable pack after preparing the source. Activate it with
`npm run activate:subject -- --pack data/python`. Only one subject is active
at a time; activation leaves the shared application and models unchanged.

Keyword tokenization currently targets English. Evaluate retrieval and answer
quality for other languages rather than assuming equivalent results.

The Kubernetes adapter also accepts `--html <snapshot>` and `--sitemap <file>`.
It creates local pages and preserves canonical source URLs and heading anchors.
Its importer and legacy relevance evaluator live in `examples/kubernetes/`,
not in the shared application. Run `node examples/kubernetes/evaluate.mjs` to
evaluate its completed dataset. It is not a requirement for other subjects.

### Builder options

- `--out <folder>` changes the generated pack destination (default `data/<id>`).
- `--models <folder>` reuses an existing shared `models/` folder without copying
  weights. If weights are absent, the pinned embedding model is downloaded into
  `.cache/models`, reused across all builds.
- `--batch-size 4`, `--max-tokens 512`, `--overlap-tokens 64` tune preparation.
- `--limit N` produces a partial smoke-test corpus. Partial packs cannot be
  activated or distributed.

Embedding checkpoints are saved during a build. Repeat the same command after
an interruption to resume. If source content or build parameters change, use a
fresh output directory. Output directories are generated build artifacts: do
not place original source documents in them.

## Install and activate a subject on Windows

This workflow installs the common package and a separately downloadable
subject pack, as described at the top.

Use these steps only with published release archives. A Git clone does not
contain the portable runtime or `Setup-RAG.cmd`; use `Test-Python.cmd` for the
clone-based test path.

The common package and subject pack are separate downloads. This source
repository is not a ready-made Windows release.

1. Extract the common package.
2. Extract a subject archive. Drag its extracted `<id>-<version>` folder onto
   `sourcedesk-ai/Activate-Subject.cmd`.
3. Run `sourcedesk-ai/Start-RAG.cmd` and keep its server window open.

To switch subjects, repeat only step 2 and reload the page. Activation verifies
checksums, citation targets, complete dataset dimensions and embedding
compatibility before atomically replacing the active-subject pointer.
Invalid packs leave the previous selection unchanged. Install only packs from
trusted authors; checksums establish consistency, not publisher identity.

The installed folder looks like:

```text
sourcedesk-ai/
  Start-RAG.cmd
  Activate-Subject.cmd
  activate-subject.py
  subject_pack.py
  serve.py
  runtime/                         # Portable Windows Python
  app/
    index.html
    js/
    css/
    vendor/
    models/                        # Shared across every subject
    release.json                   # Shared model compatibility metadata
    active-subject.json            # One selected subject
    subjects/
      networking-<version>/
        subject.json
        manifest.json
        chunks-<version>.json
        vectors-<version>.f32
        keywords-<version>.json
        docs/
```

The portable launcher is for Windows 11 x64. Windows ARM64 is not the packaged
target. A software GPU adapter may be too slow; check `chrome://gpu`.

## Package and validate

After preparing shared assets and building content:

```sh
# One reusable common archive containing app, runtime and shared models.
npm run package:common

# App/runtime-only update ZIP; no model weights or subject files.
npm run package:app

# Subject archive plus a Windows installer that downloads, verifies, extracts
# and activates it, reusing an existing common installation.
npm run package:installer -- data/python

# Classroom variant: reuse installed common files or a local common ZIP.
# Never downloads the common package. Also reuses a local subject ZIP.
npm run package:classroom -- data/python

# Subject content archive; does not include app or model weights.
npm run package:subject -- data/python

# Existing split app/model archives for other release workflows.
npm run package:windows

npm test
npm run test:windows
npm run build

# Real CPU embedding/retrieval evaluation for example packs.
npm run test:retrieval -- data/networking examples/networking/evaluation.json
npm run test:retrieval -- data/python examples/python/evaluation.json
npm run test:retrieval -- data/kubernetes examples/kubernetes/evaluation.json
```

Archives are written to `dist/`. `package:common` creates one reusable common
ZIP. `package:installer` creates a subject ZIP and a Windows CMD installer
containing pinned download URLs and SHA-256 checksums. The installer skips the
common download when a complete compatible installation exists, then extracts,
activates and launches the subject. A subject-content update therefore does not
require re-downloading or publishing the common package.
Packaging creates files only; a maintainer must publish the archives before
students can download them.

Before distribution, test relevant questions, questions unsupported by the
materials, follow-ups, citation navigation and model-cache reuse. Repeat with
internet disconnected on a target Windows GPU machine. Automated tests and CPU
retrieval checks do not replace native browser/GPU acceptance testing.

## Architecture and guarantees

Source adapters produce a common section format. The shared builder performs
heading-aware chunking, pinned CPU embeddings, normalization and BM25 indexing.
Each pack contains checksummed content and local HTML, not models or scripts.
The browser loads only the active pack's vectors, combines semantic and keyword
rankings, then generates cited answers using the shared local model.

Model identity, revision, dtype, dimensions and embedding prefixes must agree
with the installed application. Changing embedding models requires re-embedding
the corpus; changing subject content does not require different models.

Each answer keeps its own citation mapping. Chat history exists only in the
current tab, with bounded context; reloading after activation clears it.
Generated HTML, arbitrary answer links and images are inert. Documents open in
a script-disabled sandbox. Browser runtime assets are same-origin, remote model
loading is disabled, and the application CSP blocks external connections.

Weights also occupy browser cache storage; that cache copy is shared by
subjects using the same model and origin. It is not a second copy per pack.
Clearing browser data or changing origin may require caching the model again.

See `NOTICE` and `LICENSE`. Subject materials and model/runtime components have
their own licenses and terms, retained in the corresponding distribution.

## Related programme

Explore the [Higher Diploma in Cloud and Data Centre Administration at VTC](https://www.vtc.edu.hk/admission/en/programme/it114115-higher-diploma-in-cloud-and-data-centre-administration/).
