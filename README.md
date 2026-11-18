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

Read the [system design](#system-design), follow the
[new-subject authoring guide](docs/adding-subject.md), or read the
[design walkthrough and classroom story](blog/gde-medium-blog.md).

## Available subjects

| Subject | Materials | Online installer | Classroom installer (never downloads common) |
| --- | --- | --- | --- |
| Python Programming | [Official Python tutorial](examples/python/subject.json) | [Install Python](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Install-python-7e90ca1e37757550-RAG.cmd) | [Classroom Python](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Classroom-python-7e90ca1e37757550-RAG.cmd) |
| Kubernetes Documentation | [Kubernetes documentation snapshot](examples/kubernetes/subject.json), 16,483 chunks | [Install Kubernetes](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Install-kubernetes-bdea1cdb16cc0f64-RAG.cmd) | [Classroom Kubernetes](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Classroom-kubernetes-bdea1cdb16cc0f64-RAG.cmd) |
| Linux Command Line | [tldr-pages Linux & common commands](examples/linux-commands/subject.json) | [Install Linux Commands](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Install-linux-commands-b43fdf502b353eb1-RAG.cmd) | [Classroom Linux Commands](https://github.com/wongcyrus/sourcedesk-ai/releases/download/v0.2.2/Classroom-linux-commands-b43fdf502b353eb1-RAG.cmd) |

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
| A complete, compatible common installation | Reuses it without downloading or extracting common files |
| A matching local common ZIP from USB or a shared folder | Verifies and extracts it, keeping the ZIP for reuse |
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

# Prepare and build the official Python tutorial as a separate subject pack.
npm run prepare:python-source
npm run build:subject -- --subject examples/python/subject.json

# Validate, install and activate the completed content pack.
npm run activate:subject -- --pack data/python

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

Adding a subject means indexing new reference material, **not training a new
model or modifying the web app**. Follow the
[complete authoring and publishing guide](docs/adding-subject.md) for a working
configuration, document-format limits, retrieval checks and release steps.

```sh
npm run build:subject -- --subject my-course/subject.json
npm run test:retrieval -- data/my-course my-course/evaluation.json
npm run activate:subject -- --pack data/my-course
```

The guide's `my-course` is an authoring template, not a published student course.
Use `source.format: "documents"` for a local folder containing Markdown, HTML,
text-based PDF and DOCX files. Website material must be collected locally
first; the generic adapter is not a web crawler. Scanned PDFs require OCR.

After activation, reload the page to start a fresh conversation. Only the
selected pack is searched; other installed packs remain available for later
activation. The shared app and models do not change.

The published Python pack uses the official Python 3.15 tutorial under the PSF
License Version 2.0. Kubernetes has a separate print-page adapter. The
`networking`, `biology` and `mixed-documents` examples are small developer
fixtures, not complete courses or student downloads. See the guide for
[source adapters and builder options](docs/adding-subject.md#source-adapters-and-builder-options).

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
    assets/                        # Logo and favicon
    vendor/
    models/                        # Shared across every subject
    release.json                   # Shared model compatibility metadata
    active-subject.json            # One selected subject
    subjects/
      python-<pack-hash>/
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

For a subject-only release, reuse the **exact published common ZIP** when
generating installers: its checksum is pinned into each CMD. Do not rebuild
and overwrite an already published common asset. The
[publishing guide](docs/adding-subject.md#publish-without-rebuilding-the-common-package)
explains how to add a subject to the existing release without sending the
models to students again.

Before distribution, test relevant questions, questions unsupported by the
materials, follow-ups, citation navigation and model-cache reuse. Repeat with
internet disconnected on a target Windows GPU machine. Automated tests and CPU
retrieval checks do not replace native browser/GPU acceptance testing.

## System design

SourceDesk AI separates **preparation**, **distribution** and **student use**:

```text
Maintainer: source documents + subject configuration
              |
              v
           local HTML + heading/page sections
              |
              v
           CPU embeddings + vector matrix + BM25 index
              |
              v
           checksummed subject ZIP

Student:   shared app/runtime/models + one active subject
              |
           question -> query embedding -> hybrid retrieval
              |
           selected passages -> local generation -> cited answer
                                                      |
                                                 local document reader
```

### Prepare once, reuse everywhere

The maintainer's builder normalizes each source into sections with local
citation targets. It chunks the text, computes 768-dimensional EmbeddingGemma
vectors on the CPU, and writes normalized float32 vectors and a BM25 keyword
index. Students receive the completed index: they do not parse source files,
embed the corpus or install developer tools.

The common package contains the browser app, portable Windows Python, browser
runtimes and shared models. A subject pack contains reference text, vectors,
keyword postings, local HTML and checksums; PDF/DOCX sources also retain
originals. It contains no application code or model weights.

### One selected subject, one shared runtime

`active-subject.json` points to `subjects/<id>-<pack-hash>/subject.json`.
Activation validates a complete pack and its compatibility before atomically
updating that pointer; invalid packs leave the previous selection unchanged.
Reloading loads the new subject's title, example questions, answer style,
dataset and reader. It does not merge subjects.

At query time, the browser embeds the question and combines semantic and BM25
rankings using reciprocal rank fusion. Gemma 4 E2B generates from the retrieved
passages through LiteRT-LM. Recent conversation provides bounded context, not
new evidence. Each turn keeps its own citation mapping, and references open
the corresponding local heading or PDF text page.

### Independent versions, explicit compatibility

| What changes | What to prepare/distribute |
| --- | --- |
| Subject documents, metadata or answer style | A new content-hashed subject pack; regenerate that subject's installers |
| App UI or runtime, with unchanged models | A new app version; compatible existing installations can use the app-only update |
| Embedding model or preprocessing contract | Rebuild affected indexes and distribute compatible shared assets |

The app uses semantic versions, currently `0.2.2`. Each subject version is a
16-character content hash derived from metadata and checksummed files. A
subject version does not need to equal the app version. Model identity,
revision, dtype, dimensions and embedding prefixes must be compatible.
An installer additionally requires a sufficiently recent common app version.

### Offline does not mean no preparation or no limits

Initial preparation and downloads may require internet. After all assets are
installed, the Python server only serves local files at
`http://localhost:8080/`; retrieval and generation happen in the browser, not
on a cloud backend. The VTC programme link is an optional external website,
not part of inference or an offline reference.

OPFS can keep an additional on-disk copy of generation weights. It is shared
by subjects using the same model and browser origin, not duplicated per pack.
Changing origin or clearing browser storage can require reading the model
again from the local server. Cache reuse does not skip GPU initialization.

Chat history is kept only in the current tab. Model-output HTML, arbitrary
answer links and images are inert; documents use a script-disabled sandbox.
Same-origin browser assets and the application CSP restrict runtime requests.
These measures do not make answers infallible, certify source trust or provide
an exam lockdown system. Hardware performance varies; test the target machines
with internet disconnected. Keyword tokenization currently targets English.

See `NOTICE` and `LICENSE`. Subject materials and model/runtime components have
their own licenses and terms, retained in the corresponding distribution.

## Related programme

Explore the [Higher Diploma in Cloud and Data Centre Administration at VTC](https://www.vtc.edu.hk/admission/en/programme/it114115-higher-diploma-in-cloud-and-data-centre-administration/).
