# Making Offline Web AI RAG Universal: Introducing SourceDesk AI & Replaceable Subject Packs

### How to turn a single-course offline RAG exam assistant into a universal, subject-agnostic platform—supporting Markdown, PDF, DOCX, and HTML with 1-command subject updates.

![Making Offline Web AI RAG Universal — Cover Image](./images/universal-cover.png)

In the [first article](https://dev.to/gde/leveling-the-playing-field-building-a-100-offline-kubernetes-docs-rag-exam-assistant-with-web-ai-53bi), we built **[Kubernetes WebAI RAG](https://github.com/wongcyrus/kubernetes-webai-rag)**—a 100% offline, browser-based exam assistant powered by **Gemma 4 E2B**, **EmbeddingGemma**, **LiteRT-LM**, **TensorFlow.js**, and **WebGPU**.

That post covered *why* offline Web AI solves classroom equity and academic integrity, and *how* the browser runtime works under the hood (OPFS caching, hybrid BM25 + WebGPU vector search, and Windows 11 zero-config packaging).

Now comes the next practical question from educators:

> **"I don't teach Kubernetes. How do I adapt this for Python, Linux administration, cybersecurity, or my own course notes—and update it easily every semester without rebuilding the entire 2 GB model bundle?"**

That is exactly why we evolved the architecture into **[SourceDesk AI](https://github.com/wongcyrus/sourcedesk-ai)** (`sourcedesk-ai`): a universal offline RAG platform built around **replaceable subject packs** and **shared local models**.

---

## 1. The Core Insight: Fixed Runtime vs. Swappable Subject Cartridge

When you strip away the Kubernetes branding, the system splits cleanly into two independent layers:

![Fixed Runtime vs. Swappable Subject Cartridge](./images/subject-swap-architecture.png)

### 1. The Fixed Universal Runtime (Built Once, Shared Across All Courses)
- **`src/CosineSimilarity.js`**: Loads any normalized `vectors-<hash>.f32` matrix into WebGPU and runs `tf.matMul` + `tf.topk` in milliseconds.
- **`src/KeywordSearch.js`**: Runs BM25 + Reciprocal Rank Fusion (RRF) over any `keywords-<hash>.json`.
- **`src/OfflineAnswerGenerator.js`**: Streams grounded answers from **Gemma 4 E2B** (`~2.01 GB`) with atomic **OPFS** caching.
- **Shared Model & Windows Runtime (`package:common` / `package:app`)**: Bundles Python 3.14.4 embeddable, `EmbeddingGemma 300M`, and `Gemma 4 E2B` once.

### 2. The Swappable Subject Pack (Lightweight, Course-Specific)
Everything that changes between courses lives in a self-contained subject pack:
- **Source Documentation**: HTML, Markdown (`.md`), PDF (`.pdf`), or Word (`.docx`) course materials.
- **Prebuilt Index**: `vectors-<hash>.f32` + `keywords-<hash>.json` + chunk metadata.
- **Sanitized Local Mirror**: Offline HTML pages + local assets with `script-src 'none'` CSP.
- **Subject Manifest**: Course title, domain prompt instructions, and sample questions.

Because the **2+ GB AI models never change between subjects**, students who already have the shared runtime cached in their browser's OPFS on `localhost:8080` only need to swap in the lightweight subject pack!

---

## 2. Multi-Format Ingestion: Beyond HTML Sitemaps

In the original Kubernetes prototype, `build-kubernetes.mjs` was hardcoded to scrape a single `/_print/` HTML page and XML sitemap. Real-world courses rarely look like that—educators have **Markdown lecture notes, PDF textbooks, DOCX lab manuals, and static doc sites**.

In **SourceDesk AI**, [`scripts/build-subject.mjs`](https://github.com/wongcyrus/sourcedesk-ai/blob/main/scripts/build-subject.mjs) unifies ingestion across formats:
- **HTML & Static Sites** (`linkedom`): Crawls local HTML snapshots or sitemaps, preserving heading structure.
- **Markdown** (`markdown-it` via `scripts/markdown-source.mjs`): Converts `.md` files into clean semantic HTML with heading anchors (`<h2 id="...">`).
- **PDF & DOCX** (`pdfjs-dist` & `mammoth` via `scripts/document-source.mjs`): Extracts structured sections from textbooks, syllabi, and lab sheets into HTML pages.

> **Why convert everything to semantic HTML with heading anchors?**  
> Because it powers the side-by-side verification reader! When a student clicks `[1]` in an answer, the browser opens the exact local HTML page and scrolls straight to the `#heading-anchor` inside the sandboxed `<iframe>`.

---

## 3. The 4-Step Workflow to Add or Update a Subject

Once your course materials are ready, building, verifying, and shipping a new subject pack takes four commands:

![4-Step Subject Update Pipeline](./images/easy-update-workflow.png)

### Step 1: Configure & Prepare Your Subject Source
Place your course docs (Markdown, PDF, DOCX, or HTML) in your subject folder and define the subject metadata (title, domain name for the system prompt, and sample questions).

### Step 2: Build the Subject Index (`build:subject`)
Run the unified subject builder to chunk by headings, compute 768-dimensional `EmbeddingGemma` vectors, and generate the BM25 keyword index:

```bash
npm run build:subject
```

This outputs the content-hashed `vectors-<hash>.f32` matrix and `keywords-<hash>.json` postings.

### Step 3: Evaluate Retrieval Quality (`test:retrieval`)
Before handing a new subject pack to students, you can run automated retrieval checks to verify that your chunking and hybrid search actually surface the right passages for key exam topics:

```bash
npm run test:retrieval
```

### Step 4: Sanitize, Package, and Activate (`prepare:offline` & `package:subject`)
Sanitize the local HTML mirror (stripping `<script>`, `<form>`, `<iframe>`, and enforcing `script-src 'none'` CSP) and package **only the subject pack** for Windows 11:

```bash
npm run prepare:offline
npm run package:subject
```

On a classroom machine or student laptop, switching between subjects (e.g., from *Kubernetes* to *Python* or *Linux*) is a single command:

```bash
npm run activate:subject
```

---

## 4. Why This Matters for Classroom Operations

Separating the **shared model runtime** from **subject packs** solves three real-world headaches for IT teams and instructors:

1. **Fast Semester Updates**: Updating a typo in a lab manual or adding a new lecture only requires regenerating the small subject pack—not re-downloading 2 GB of LLM weights.
2. **Multi-Course Lab Machines**: A single university lab PC can host multiple subjects (e.g., *Intro to Python*, *Linux Admin*, *Cloud Security*) sharing one `Gemma 4 E2B` OPFS cache on `localhost:8080`.
3. **Consistent Grounding & Safety**: Every subject automatically inherits the same prompt-injection defenses, inert `markdown-it` rendering, and strict CSP sandboxing.

---

## Conclusion

By decoupling the **universal WebGPU + Gemma 4 runtime** from **replaceable subject packs**, **[SourceDesk AI](https://github.com/wongcyrus/sourcedesk-ai)** turns an offline Kubernetes exam assistant into a reusable platform for any technical curriculum.

- **One runtime**, unlimited subjects.
- **Supports HTML, Markdown, PDF, and DOCX** out of the box.
- **1-command subject switching** with zero changes to the browser engine or cached models.

### Explore the Project
- **SourceDesk AI (Universal Platform)**: [github.com/wongcyrus/sourcedesk-ai](https://github.com/wongcyrus/sourcedesk-ai)
- **Part 1 (Architecture & Classroom Equity)**: [Leveling the Playing Field: Building a 100% Offline Kubernetes Docs RAG Exam Assistant](https://dev.to/gde/leveling-the-playing-field-building-a-100-offline-kubernetes-docs-rag-exam-assistant-with-web-ai-53bi)

**Suggested Tags:** `WebAI`, `RAG`, `Gemma`, `WebGPU`, `EdTech`
