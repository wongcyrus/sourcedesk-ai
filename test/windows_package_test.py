import functools
import importlib.util
import json
import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from http.client import IncompleteRead
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


server = load_module("rag_server", "windows/serve.py")
packager = load_module("rag_packager", "scripts/package-windows.py")
activator = load_module("subject_activator", "windows/activate-subject.py")


class WindowsPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "app"
        self.root.mkdir()
        version = json.loads((ROOT / "package.json").read_text())["version"]
        self.release = {
            "application": "sourcedesk-ai", "version": version,
            "generationModelPath": "models/gemma/model.litertlm",
            "generationModel": {"bytes": 2, "sha256": ""},
            "embeddingModelPath": "models/embedding",
            "embeddingModel": {
                "runtime": "embeddinggemma", "url": "onnx-community/embeddinggemma-300m-ONNX",
                "revision": "a" * 40, "dtype": "q4", "sequenceLength": 512,
            },
        }
        for name in ("index.html", "OfflineVectorSearch-min.js", "NOTICE",
                     "models/gemma/README.md", "models/gemma/model.litertlm",
                     "models/embedding/model.onnx", "vendor/runtime.wasm",
                     "js/app.js", "css/style.css", "licenses/project.txt",
                     "assets/logo.svg", "assets/logo-mark.svg"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"ok")
        self.release["generationModel"]["sha256"] = packager.digest(self.root / self.release["generationModelPath"])
        self.pack = Path(self.temporary.name) / "pack"
        data = self.pack
        data.mkdir(parents=True)
        self.manifest = {
            "format": "vectorsearch-prebuilt-v1", "encoding": "float32-le", "normalized": True,
            "version": "b" * 16, "partial": False, "model": self.release["embeddingModel"].copy(),
            "documentPrefix": "title: none | text: ", "queryPrefix": "task: search result | query: ",
            "count": 1, "dimensions": 768,
            "chunks": "chunks.json", "vectors": "vectors.f32", "keywords": "keywords.json",
        }
        (data / "docs").mkdir()
        (data / "docs/index.html").write_text("<h1>Reference</h1>")
        (data / "originals").mkdir()
        (data / "originals/reference.pdf").write_bytes(b"PDF source")
        (data / "chunks.json").write_text(json.dumps([
            {"id": 1, "title": "Reference", "text": "A local reference.", "localPath": "docs/index.html",
             "originalPath": "originals/reference.pdf#page=1"}
        ]))
        (data / "vectors.f32").write_bytes(b"\0" * (768 * 4))
        (data / "keywords.json").write_text(json.dumps({
            "format": "vectorsearch-keywords-v1", "count": 1, "averageLength": 1,
            "lengths": [1], "terms": {"reference": [0, 1]},
        }))
        self.subject = {
            "format": "sourcedesk-subject-v1", "id": "test-subject", "version": "c" * 16,
            "title": "Test subject", "description": "", "language": "en", "attribution": "Test materials",
            "examples": [], "answerStyle": "", "manifest": "manifest.json", "documents": "docs/index.html",
        }
        self.write_subject()
        self.write_release()
        self.installed = activator.activate(self.pack, self.root)

    def write_release(self):
        (self.root / "release.json").write_text(json.dumps(self.release))

    def write_subject(self):
        (self.pack / "manifest.json").write_text(json.dumps(self.manifest))
        self.subject["files"] = {
            name: hashlib.sha256((self.pack / name).read_bytes()).hexdigest()
            for name in ("manifest.json", "chunks.json", "vectors.f32", "keywords.json", "docs/index.html",
                         "originals/reference.pdf")
        }
        (self.pack / "subject.json").write_text(json.dumps(self.subject))

    def test_server_rejects_missing_partial_or_outside_model(self):
        server.check_package(self.root)
        (self.root / self.release["generationModelPath"]).write_bytes(b"x")
        with self.assertRaisesRegex(ValueError, "incomplete Gemma"):
            server.check_package(self.root)
        self.release["generationModelPath"] = "../outside.litertlm"
        self.write_release()
        with self.assertRaisesRegex(ValueError, "Invalid model path"):
            server.check_package(self.root)

    def test_server_serves_runtime_mime_types_health_and_revalidates_ui(self):
        handler = functools.partial(server.Handler, directory=str(self.root), release=self.release)
        instance = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=instance.serve_forever)
        thread.start()
        try:
            base = f"http://127.0.0.1:{instance.server_port}"
            with urllib.request.urlopen(base + "/healthz") as response:
                self.assertEqual(json.load(response)["application"], "sourcedesk-ai")
            for name, mime, body in (("OfflineVectorSearch-min.js", "text/javascript", b"ok"),
                                     ("assets/logo-mark.svg", "image/svg+xml", b"ok"),
                                     ("vendor/runtime.wasm", "application/wasm", b"ok"),
                                     (f"subjects/{self.installed.name}/docs/index.html", "text/html",
                                      b"<h1>Reference</h1>"),
                                     (f"subjects/{self.installed.name}/originals/reference.pdf",
                                      "application/pdf", b"PDF source")):
                with urllib.request.urlopen(base + "/" + name) as response:
                    self.assertEqual(response.headers["Content-Type"], mime)
                    self.assertEqual(response.headers["Cache-Control"], "no-cache")
                    if "/docs/" in name:
                        self.assertIn("script-src 'none'", response.headers["Content-Security-Policy"])
                    self.assertEqual(response.read(), body)
        finally:
            instance.shutdown()
            instance.server_close()
            thread.join()

    def test_server_reloads_updated_ui_with_identical_archive_timestamps(self):
        page = self.root / "index.html"
        timestamp = 1767225600
        os.utime(page, (timestamp, timestamp))
        handler = functools.partial(server.Handler, directory=str(self.root), release=self.release)
        instance = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=instance.serve_forever)
        thread.start()
        try:
            url = f"http://127.0.0.1:{instance.server_port}/index.html"
            with urllib.request.urlopen(url, timeout=5) as response:
                modified = response.headers["Last-Modified"]
                self.assertEqual(response.read(), b"ok")
            page.write_bytes(b"updated chat UI")
            os.utime(page, (timestamp, timestamp))
            request = urllib.request.Request(url, headers={"If-Modified-Since": modified})
            with urllib.request.urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b"updated chat UI")
            model_url = f"http://127.0.0.1:{instance.server_port}/models/gemma/model.litertlm"
            with urllib.request.urlopen(model_url, timeout=5) as response:
                model_modified = response.headers["Last-Modified"]
                self.assertIn("immutable", response.headers["Cache-Control"])
                response.read()
            model_request = urllib.request.Request(model_url, headers={"If-Modified-Since": model_modified})
            with self.assertRaises(urllib.error.HTTPError) as unchanged:
                urllib.request.urlopen(model_request, timeout=5)
            self.assertEqual(unchanged.exception.code, 304)
            unchanged.exception.close()
        finally:
            instance.shutdown()
            instance.server_close()
            thread.join()

    def test_release_separates_model_and_excludes_development_files(self):
        (self.root / "local-test-ca.crt").write_text("public test certificate")
        (self.root / "private.key").write_text("not a real key")
        (self.installed / "old-vectors.f32").write_bytes(b"old")
        runtime = Path(self.temporary.name) / "python.zip"
        with zipfile.ZipFile(runtime, "w") as archive:
            archive.writestr("LICENSE.txt", "test license")
            archive.writestr("python.exe", b"test runtime")
        output = Path(self.temporary.name) / "dist"
        with patch.object(packager, "python_runtime", return_value=runtime):
            packager.package(self.root, output, Path(self.temporary.name) / "cache")
        app = next(output.glob("*-app.zip"))
        model = next(output.glob("*-model.zip"))
        with zipfile.ZipFile(app) as archive:
            names = archive.namelist()
            self.assertIn("sourcedesk-ai/runtime/LICENSE.txt", names)
            self.assertIn("sourcedesk-ai/app/vendor/runtime.wasm", names)
            self.assertIn("sourcedesk-ai/app/assets/logo.svg", names)
            self.assertIn("sourcedesk-ai/app/assets/logo-mark.svg", names)
            self.assertIn("sourcedesk-ai/Start-RAG.cmd", names)
            self.assertIn("sourcedesk-ai/Activate-Subject.cmd", names)
            self.assertNotIn("sourcedesk-ai/app/active-subject.json", names)
            self.assertFalse(any("/subjects/" in name or "/models/" in name for name in names))
            self.assertFalse(any(name.endswith((".crt", ".key", ".litertlm", "old-vectors.f32")) for name in names))
        with zipfile.ZipFile(model) as archive:
            self.assertEqual(set(archive.namelist()), {
                "sourcedesk-ai/app/models/gemma/model.litertlm",
                "sourcedesk-ai/app/models/gemma/README.md",
                "sourcedesk-ai/app/models/embedding/model.onnx",
            })
            self.assertEqual(archive.read("sourcedesk-ai/app/models/gemma/model.litertlm"), b"ok")
        script = (output / "Setup-RAG.cmd").read_text()
        self.assertIn(packager.digest(app), script)
        self.assertIn(packager.digest(model), script)
        self.assertIn("[Security.Cryptography.SHA256]::Create()", script)
        self.assertIn("ComputeHash($s)", script)
        self.assertIn(f"SourceDesk AI v{self.release['version']} setup", script)
        self.assertIn("[IO.Directory]::GetFiles", script)
        self.assertIn("[IO.File]::Move", script)
        self.assertNotIn("ExecutionPolicy", script)
        self.assertIn("if errorlevel 1 goto failed", script)
        if os.name == "nt":
            downloads = output / ".downloads"
            downloads.mkdir()
            shutil.copyfile(app, downloads / app.name)
            cached_model = downloads / "sourcedesk-ai-previous-windows-x64-model.zip"
            shutil.copyfile(model, cached_model)
            (downloads / model.name).write_bytes(b"incomplete archive")
            subprocess.run(["cmd.exe", "/d", "/c", "Setup-RAG.cmd"],
                           cwd=output, input="\r\n", text=True, timeout=30, check=True)
            activator.activate(self.pack, output / "sourcedesk-ai/app")
            server.check_package(output / "sourcedesk-ai/app")
            self.assertFalse(cached_model.exists())
            self.assertEqual(packager.digest(downloads / model.name), packager.digest(model))

    def test_app_update_preserves_existing_models_subjects_and_selection(self):
        destination = Path(self.temporary.name) / "installation"
        installed_app = destination / "sourcedesk-ai/app"
        shutil.copytree(self.root, installed_app)
        previous = dict(self.release, version="0.2.1")
        (installed_app / "release.json").write_text(json.dumps(previous))
        (installed_app / "index.html").write_bytes(b"old application")
        preserved = {
            path.relative_to(installed_app): packager.digest(path)
            for path in installed_app.rglob("*")
            if path.is_file() and (
                path.relative_to(installed_app).parts[0] in ("models", "subjects")
                or path.name == "active-subject.json"
            )
        }
        shutil.rmtree(self.root / "models")
        runtime = Path(self.temporary.name) / "python.zip"
        with zipfile.ZipFile(runtime, "w") as archive:
            archive.writestr("LICENSE.txt", "test license")
            archive.writestr("python.exe", b"test runtime")
        with patch.object(packager, "python_runtime", return_value=runtime):
            update = packager.package_app(
                self.root, Path(self.temporary.name) / "dist", Path(self.temporary.name) / "cache"
            )
        with zipfile.ZipFile(update) as archive:
            self.assertFalse(any(
                "/models/" in name or "/subjects/" in name or name.endswith("/active-subject.json")
                for name in archive.namelist()
            ))
            archive.extractall(destination)
        self.assertEqual((installed_app / "index.html").read_bytes(), b"ok")
        self.assertEqual(json.loads((installed_app / "release.json").read_text()), self.release)
        self.assertEqual((installed_app / "assets/logo-mark.svg").read_bytes(), b"ok")
        self.assertEqual(
            {name: packager.digest(installed_app / name) for name in preserved}, preserved
        )
        self.assertIn(packager.digest(update), update.with_suffix(".zip.sha256").read_text())
        server.check_package(installed_app)

    def test_common_archive_is_reusable_with_separate_subject_pack(self):
        runtime = Path(self.temporary.name) / "python.zip"
        with zipfile.ZipFile(runtime, "w") as archive:
            archive.writestr("LICENSE.txt", "test license")
            archive.writestr("python.exe", b"test runtime")
        output = Path(self.temporary.name) / "dist"
        with patch.object(packager, "python_runtime", return_value=runtime):
            common = packager.package_common(
                self.root, output, Path(self.temporary.name) / "cache"
            )
        subject_archive = packager.package_subject(self.pack, output)
        with zipfile.ZipFile(common) as archive:
            names = archive.namelist()
            app_prefix = "sourcedesk-ai/app/"
            self.assertIn("sourcedesk-ai/Start-RAG.cmd", names)
            self.assertIn("sourcedesk-ai/runtime/python.exe", names)
            self.assertIn(f"{app_prefix}assets/logo-mark.svg", names)
            self.assertIn(f"{app_prefix}models/gemma/model.litertlm", names)
            self.assertIn(f"{app_prefix}models/embedding/model.onnx", names)
            self.assertNotIn(f"{app_prefix}active-subject.json", names)
            self.assertFalse(any("/subjects/" in name for name in names))
            self.assertNotIn("sourcedesk-ai/Setup-RAG.cmd", names)
            extracted = Path(self.temporary.name) / "extracted"
            archive.extractall(extracted)
        subject_directory = Path(self.temporary.name) / "subject"
        with zipfile.ZipFile(subject_archive) as archive:
            archive.extractall(subject_directory)
        installed_app = extracted / "sourcedesk-ai" / "app"
        activator.activate(subject_directory / self.installed.name, installed_app)
        server.check_package(installed_app)

    def test_student_installer_downloads_only_missing_common_and_installs_subject(self):
        runtime = Path(self.temporary.name) / "python.zip"
        with zipfile.ZipFile(runtime, "w") as archive:
            archive.writestr("LICENSE.txt", "test license")
            archive.writestr("python.exe", b"test runtime")
        output = Path(self.temporary.name) / "dist"
        with patch.object(packager, "python_runtime", return_value=runtime):
            common = packager.package_common(
                self.root, output, Path(self.temporary.name) / "cache"
            )
        installer = packager.package_student_installer(self.root, self.pack, output)
        script = installer.read_text()
        subject_archive = output / f"sourcedesk-ai-subject-{self.installed.name}.zip"
        self.assertIn(f"https://github.com/wongcyrus/sourcedesk-ai/releases/download/v{self.release['version']}/{common.name}", script)
        self.assertIn(subject_archive.name, script)
        self.assertIn(packager.digest(common), script)
        self.assertIn(packager.digest(subject_archive), script)
        self.assertIn('if not errorlevel 1 goto common_ready', script)
        self.assertIn('tar.exe" -xf ".downloads\\', script)
        self.assertIn('"sourcedesk-ai\\activate-subject.py"', script)
        self.assertIn('call "sourcedesk-ai\\Start-RAG.cmd"', script)
        self.assertTrue(Path(str(installer) + ".sha256").is_file())

    def test_classroom_installer_never_downloads_common_and_preserves_local_archives(self):
        output = Path(self.temporary.name) / "dist"
        output.mkdir()
        common = output / f"sourcedesk-ai-{self.release['version']}-common-windows-x64.zip"
        with zipfile.ZipFile(common, "w") as archive:
            archive.writestr("sourcedesk-ai/runtime/python.exe", b"test runtime")
        installer = packager.package_student_installer(self.root, self.pack, output, classroom=True)
        script = installer.read_text()
        self.assertTrue(installer.name.startswith("Classroom-"))
        network_commands = [line for line in script.splitlines() if "curl.exe" in line]
        self.assertEqual(len(network_commands), 1)
        self.assertIn(f"sourcedesk-ai-subject-{self.installed.name}.zip", network_commands[0])
        self.assertNotIn(common.name, network_commands[0])
        self.assertNotIn(":download_common", script)
        self.assertIn("Classroom setup never downloads them.", script)
        self.assertLess(script.index("goto common_ready"), script.index(":verify_local_common"))
        self.assertIn(f'if exist "{common.name}" goto verify_local_common', script)
        self.assertIn(f'if exist ".downloads\\{common.name}" goto verify_local_common', script)
        self.assertIn(packager.digest(common), script)
        self.assertIn(
            '"%SystemRoot%\\System32\\tar.exe" -xf "%common_archive%"\nif errorlevel 1 goto failed',
            script,
        )
        self.assertNotIn(f'del /q "{common.name}"', script)
        self.assertNotIn(f'del /q ".downloads\\{common.name}"', script)
        subject_name = f"sourcedesk-ai-subject-{self.installed.name}.zip"
        self.assertLess(script.index(f'if exist "{subject_name}" goto verify_subject'), script.index("curl.exe"))
        self.assertIn("Get-FileHash -LiteralPath $env:subject_archive", script)
        self.assertNotIn(f'del /q "{subject_name}"', script)
        self.assertIn('"sourcedesk-ai\\activate-subject.py"', script)
        self.assertIn('call "sourcedesk-ai\\Start-RAG.cmd"', script)

    def test_server_suppresses_disconnected_downloads_and_keeps_serving(self):
        handler = functools.partial(server.Handler, directory=str(self.root), release=self.release)
        instance = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=instance.serve_forever)
        with patch.object(instance, "handle_error") as handle_error, patch.object(
            server.Handler, "copyfile", side_effect=[ConnectionResetError(), BrokenPipeError()]
        ):
            thread.start()
            try:
                base = f"http://127.0.0.1:{instance.server_port}"
                for _ in range(2):
                    with urllib.request.urlopen(base + "/vendor/runtime.wasm", timeout=5) as response:
                        with self.assertRaises(IncompleteRead):
                            response.read()
                with urllib.request.urlopen(base + "/healthz", timeout=5) as response:
                    self.assertEqual(json.load(response)["application"], "sourcedesk-ai")
                handle_error.assert_not_called()
            finally:
                instance.shutdown()
                instance.server_close()
                thread.join()

    def test_server_does_not_hide_unexpected_errors(self):
        handler = object.__new__(server.Handler)
        with patch.object(server.SimpleHTTPRequestHandler, "handle", side_effect=OSError("unexpected failure")):
            with self.assertRaisesRegex(OSError, "unexpected failure"):
                handler.handle()

    def test_packager_refuses_changed_model_partial_data_and_oversized_assets(self):
        self.manifest["partial"] = True
        self.write_subject()
        with self.assertRaisesRegex(ValueError, "complete corpus"):
            packager.package_subject(self.pack, Path(self.temporary.name) / "dist")
        (self.root / self.release["generationModelPath"]).write_bytes(b"xx")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            packager.package(self.root, Path(self.temporary.name) / "dist", Path(self.temporary.name) / "cache")
        temporary = Path(self.temporary.name) / "oversized.download"
        temporary.write_bytes(b"1234")
        destination = temporary.with_suffix(".zip")
        with patch.object(packager, "ASSET_LIMIT", 4):
            with self.assertRaisesRegex(ValueError, "under 2 GiB"):
                packager.finish_archive(temporary, destination)
        self.assertFalse(destination.exists())

    def test_activation_switches_only_content_and_rejects_bad_packs_without_changing_pointer(self):
        model = self.root / self.release["generationModelPath"]
        before = model.stat().st_mtime_ns
        self.subject.update(id="biology", version="d" * 16, title="Biology")
        self.write_subject()
        destination = activator.activate(self.pack, self.root)
        self.assertTrue(self.installed.is_dir())
        self.assertTrue(destination.is_dir())
        self.assertEqual(model.stat().st_mtime_ns, before)
        pointer = (self.root / "active-subject.json").read_bytes()
        self.assertIn("biology", pointer.decode())
        (self.pack / "vectors.f32").write_bytes(b"broken")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            activator.activate(self.pack, self.root)
        self.assertEqual((self.root / "active-subject.json").read_bytes(), pointer)
        (self.pack / "vectors.f32").write_bytes(b"\0" * (768 * 4))
        self.manifest["model"]["revision"] = "e" * 40
        self.write_subject()
        with self.assertRaisesRegex(ValueError, "different embedding model"):
            activator.activate(self.pack, self.root)
        self.assertEqual((self.root / "active-subject.json").read_bytes(), pointer)

    def test_subject_archive_excludes_unlisted_models_and_source_backups(self):
        (self.pack / "model.litertlm").write_bytes(b"unlisted model")
        (self.pack / "source.html").write_text("unlisted source")
        archive_path = packager.package_subject(self.pack, Path(self.temporary.name) / "dist")
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
        self.assertEqual(len(names), len(self.subject["files"]) + 1)
        self.assertFalse(any(name.endswith(("source.html", ".litertlm")) for name in names))

    def test_activation_rejects_path_escape_and_missing_citation_documents(self):
        pointer = (self.root / "active-subject.json").read_bytes()
        self.subject["files"]["../outside"] = "a" * 64
        (self.pack / "subject.json").write_text(json.dumps(self.subject))
        with self.assertRaisesRegex(ValueError, "Invalid subject file path"):
            activator.activate(self.pack, self.root)
        self.write_subject()
        (self.pack / "chunks.json").write_text(json.dumps([
            {"id": 1, "title": "Bad", "text": "Missing", "localPath": "docs/missing.html"}
        ]))
        self.write_subject()
        with self.assertRaisesRegex(ValueError, "unbundled local document"):
            activator.activate(self.pack, self.root)
        self.assertEqual((self.root / "active-subject.json").read_bytes(), pointer)

    def test_activation_rejects_checksumming_valid_but_unusable_index(self):
        pointer = (self.root / "active-subject.json").read_bytes()
        import struct
        (self.pack / "vectors.f32").write_bytes(struct.pack("<f", float("nan")) + b"\0" * (767 * 4))
        self.write_subject()
        with self.assertRaisesRegex(ValueError, "non-finite vectors"):
            activator.activate(self.pack, self.root)
        (self.pack / "vectors.f32").write_bytes(b"\0" * (768 * 4))
        (self.pack / "keywords.json").write_text("{}")
        self.write_subject()
        with self.assertRaisesRegex(ValueError, "keyword index"):
            activator.activate(self.pack, self.root)
        self.assertEqual((self.root / "active-subject.json").read_bytes(), pointer)


if __name__ == "__main__":
    unittest.main()
