import hashlib
import json
import re
import math
import sys
from array import array
from pathlib import Path, PurePosixPath


def pack_path(root, name):
    if not isinstance(name, str) or not name or not all(
        re.fullmatch(r"[a-zA-Z0-9_.-]+", part) and part not in (".", "..")
        for part in name.split("/")
    ):
        raise ValueError(f"Invalid subject file path: {name}")
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()) or any(
        parent.is_symlink() for parent in (path, *path.parents) if parent != root.parent
    ):
        raise ValueError(f"Unsafe subject file path: {name}")
    if not path.is_file():
        raise ValueError(f"Missing subject file: {name}")
    return path


def read_subject(root, release=None):
    root = Path(root).resolve()
    subject = json.loads(pack_path(root, "subject.json").read_text(encoding="utf-8"))
    if not isinstance(subject, dict) or subject.get("format") != "sourcedesk-subject-v1" or not all(
        isinstance(subject.get(key), str) for key in ("id", "version")
    ) or not re.fullmatch(
        r"[a-z0-9]+(?:-[a-z0-9]+)*", subject.get("id", "")
    ) or not re.fullmatch(r"[a-f0-9]{16}", subject.get("version", "")):
        raise ValueError("Invalid SourceDesk AI subject identity.")
    for key, maximum in (("title", 120), ("description", 1000), ("attribution", 2000), ("answerStyle", 400)):
        if not isinstance(subject.get(key), str) or len(subject[key]) > maximum:
            raise ValueError(f"Invalid subject {key}.")
    if not subject["title"].strip() or not isinstance(subject.get("language"), str) or not subject["language"]:
        raise ValueError("Subject title and language are required.")
    if not isinstance(subject.get("examples"), list) or len(subject["examples"]) > 10 or not all(
        isinstance(example, str) and len(example) <= 500 for example in subject["examples"]
    ):
        raise ValueError("Invalid subject examples.")
    if subject.get("manifest") != "manifest.json" or subject.get("documents") != "docs/index.html":
        raise ValueError("Invalid subject manifest or documents entry point.")
    files = subject.get("files")
    if not isinstance(files, dict) or not {"manifest.json", "docs/index.html"}.issubset(files):
        raise ValueError("Subject checksums are missing.")
    for name, expected in files.items():
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise ValueError("Invalid subject checksum.")
        with pack_path(root, name).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError(f"Subject checksum mismatch: {name}")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("Invalid subject manifest.")
    if manifest.get("partial") is not False:
        raise ValueError("A complete corpus is required; partial packs cannot be activated.")
    if manifest.get("format") != "vectorsearch-prebuilt-v1" or manifest.get("encoding") != "float32-le" or manifest.get("normalized") is not True:
        raise ValueError("Unsupported subject dataset format.")
    if not isinstance(manifest.get("version"), str) or not re.fullmatch(r"[a-f0-9]{16}", manifest["version"]):
        raise ValueError("Invalid dataset version.")
    model = manifest.get("model", {})
    if not isinstance(model, dict) or model.get("runtime") != "embeddinggemma" or model.get("url") != "onnx-community/embeddinggemma-300m-ONNX" or (
        not isinstance(model.get("revision"), str) or not re.fullmatch(r"[a-f0-9]{40}", model["revision"])
    ) or model.get("dtype") not in ("q4", "q8", "fp32") or (
        type(model.get("sequenceLength")) is not int or not 32 <= model["sequenceLength"] <= 2048
    ) or manifest.get("dimensions") != 768 or (
        manifest.get("documentPrefix") != "title: none | text: " or
        manifest.get("queryPrefix") != "task: search result | query: "
    ):
        raise ValueError("Unsupported subject embedding model or preprocessing.")
    if release is not None and not all(
        model.get(key) == release["embeddingModel"].get(key)
        for key in ("runtime", "url", "revision", "dtype")
    ):
        raise ValueError("Subject requires a different embedding model. Install compatible shared models first.")
    data_names = set()
    for field in ("chunks", "vectors", "keywords"):
        name = manifest.get(field)
        if not isinstance(name, str) or PurePosixPath(name).name != name or name not in files:
            raise ValueError("Dataset files must be checksummed files in the subject root.")
        data_names.add(name)
    for name in files:
        extension = Path(name).suffix.lower()
        if name not in {"manifest.json", *data_names} and not (
            (name.startswith("docs/") and extension not in
             {".js", ".mjs", ".wasm", ".onnx", ".litertlm", ".exe", ".dll", ".key", ".pem", ".download"}) or
            (name.startswith("originals/") and extension in {".pdf", ".docx"})
        ):
            raise ValueError(f"Subject packs cannot include application code or models: {name}")
    count = manifest.get("count")
    if type(count) is not int or count < 1 or (root / manifest["vectors"]).stat().st_size != count * 768 * 4:
        raise ValueError("Subject vectors do not match the manifest count/dimensions.")
    with (root / manifest["vectors"]).open("rb") as stream:
        while block := stream.read(1024 * 1024):
            values = array("f")
            values.frombytes(block)
            if sys.byteorder != "little":
                values.byteswap()
            if not all(math.isfinite(value) for value in values):
                raise ValueError("Subject contains non-finite vectors.")
    chunks = json.loads((root / manifest["chunks"]).read_text(encoding="utf-8"))
    if not isinstance(chunks, list) or len(chunks) != count:
        raise ValueError("Subject chunks do not match the manifest count.")
    ids = set()
    for chunk in chunks:
        if not isinstance(chunk, dict) or type(chunk.get("id")) is not int or chunk["id"] in ids or not all(
            isinstance(chunk.get(key), str) for key in ("title", "text", "localPath")
        ) or (chunk.get("originalPath") is not None and not isinstance(chunk["originalPath"], str)):
            raise ValueError("Invalid subject chunk.")
        ids.add(chunk["id"])
        document, *fragment = chunk["localPath"].split("#")
        if len(fragment) > 1 or (fragment and re.search(r"[\s<>\\]", fragment[0])) or not document.startswith("docs/") or document not in files:
            raise ValueError("Chunk references an unbundled local document.")
        pack_path(root, document)
        if chunk.get("sourceUrl") is not None and (
            not isinstance(chunk["sourceUrl"], str) or not re.match(r"^https?://", chunk["sourceUrl"])
        ):
            raise ValueError("Invalid original source URL.")
        if chunk.get("originalPath") is not None:
            original, *original_fragment = chunk["originalPath"].split("#")
            if len(original_fragment) > 1 or (
                original_fragment and not re.fullmatch(r"page=[1-9]\d*", original_fragment[0])
            ) or not original.startswith("originals/") or Path(original).suffix.lower() not in {".pdf", ".docx"} or original not in files:
                raise ValueError("Chunk references an unbundled original document.")
            pack_path(root, original)
    keywords = json.loads((root / manifest["keywords"]).read_text(encoding="utf-8"))
    if not isinstance(keywords, dict) or keywords.get("format") != "vectorsearch-keywords-v1" or keywords.get("count") != count or (
        not isinstance(keywords.get("lengths"), list) or len(keywords["lengths"]) != count
    ) or not isinstance(keywords.get("terms"), dict):
        raise ValueError("Invalid subject keyword index.")
    for value in [keywords.get("averageLength"), *keywords["lengths"]]:
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise ValueError("Invalid subject keyword lengths.")
    for postings in keywords["terms"].values():
        if not isinstance(postings, list) or len(postings) % 2:
            raise ValueError("Invalid subject keyword postings.")
        previous = -1
        for offset in range(0, len(postings), 2):
            row, frequency = postings[offset:offset + 2]
            if type(row) is not int or not previous < row < count or (
                type(frequency) not in (int, float) or not math.isfinite(frequency) or frequency <= 0
            ):
                raise ValueError("Invalid subject keyword postings.")
            previous = row
    return subject, manifest


def active_subject(root, release, verify=True):
    root = Path(root).resolve()
    active = json.loads((root / "active-subject.json").read_text(encoding="utf-8"))
    name = active.get("path", "") if isinstance(active, dict) else ""
    if not isinstance(name, str) or not re.fullmatch(r"subjects/[a-z0-9-]+/subject\.json", name):
        raise ValueError("Invalid active subject path.")
    path = pack_path(root, name)
    if verify:
        subject, manifest = read_subject(path.parent, release)
        return subject, manifest, path.parent
    return json.loads(path.read_text(encoding="utf-8")), None, path.parent
