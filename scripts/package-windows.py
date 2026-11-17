import argparse
import hashlib
import json
import shutil
import urllib.request
import zipfile
import sys
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "windows"))
from subject_pack import pack_path, read_subject

NAME = "sourcedesk-ai"
PYTHON_URL = "https://www.python.org/ftp/python/3.14.4/python-3.14.4-embeddable-amd64.zip"
PYTHON_SHA256 = "fa2e63e9f0607e34d8841cc8080641069b71d2bddb5a69fa30c24eb5599da9fe"
ASSET_LIMIT = 2 * 1024**3


def digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def python_runtime(cache):
    cache.mkdir(parents=True, exist_ok=True)
    destination = cache / "python-3.14.4-embeddable-amd64.zip"
    if destination.exists() and digest(destination) == PYTHON_SHA256:
        return destination
    temporary = destination.with_suffix(".download")
    with urllib.request.urlopen(PYTHON_URL, timeout=180) as response, temporary.open("wb") as stream:
        shutil.copyfileobj(response, stream)
    if digest(temporary) != PYTHON_SHA256:
        raise ValueError("Official Python runtime checksum mismatch.")
    temporary.replace(destination)
    return destination


def application_files(root, release):
    paths = {root / name for name in (
        "index.html", "OfflineVectorSearch-min.js", "NOTICE", "release.json"
    )}
    for directory in ("js", "css", "licenses", "vendor"):
        folder = root / directory
        if not folder.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Invalid application directory: {directory}")
        members = [path for path in folder.rglob("*") if path.is_file()]
        if not members:
            raise ValueError(f"Missing application assets: {directory}")
        paths.update(members)
    for path in paths:
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Missing or unsafe package input: {path}")
        if path.suffix.lower() in {".key", ".crt", ".csr", ".pem", ".pfx", ".p12", ".srl"} or path.name.endswith(".download"):
            raise ValueError(f"Temporary or credential file cannot be packaged: {path}")
    return sorted(paths)


def model_files(root, release):
    model = root / release["generationModelPath"]
    if not model.resolve().is_relative_to(root) or not model.is_file() or model.is_symlink():
        raise ValueError("Invalid model file.")
    if model.stat().st_size != release["generationModel"]["bytes"] or digest(model) != release["generationModel"]["sha256"]:
        raise ValueError("Gemma model is incomplete or has a checksum mismatch.")
    embedding = root / release["embeddingModelPath"]
    if not embedding.resolve().is_relative_to(root) or embedding.is_symlink():
        raise ValueError("Invalid embedding model directory.")
    paths = {model, model.parent / "README.md", *[path for path in embedding.rglob("*") if path.is_file()]}
    if not any(path.suffix == ".onnx" for path in paths):
        raise ValueError("Missing shared embedding model.")
    for path in paths:
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError(f"Missing or unsafe model input: {path}")
        if path.name.endswith(".download"):
            raise ValueError(f"Incomplete model input: {path}")
    return sorted(paths)


def package_subject(root, output):
    root, output = root.resolve(), output.resolve()
    subject, _ = read_subject(root)
    output.mkdir(parents=True, exist_ok=True)
    folder = f"{subject['id']}-{subject['version']}"
    destination = output / f"{NAME}-subject-{folder}.zip"
    temporary = destination.with_suffix(".zip.download")
    with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
        for name in sorted(["subject.json", *subject["files"]]):
            with pack_path(root, name).open("rb") as stream:
                add_stream(archive, f"{folder}/{name}", stream)
    finish_archive(temporary, destination)
    destination.with_suffix(".zip.sha256").write_text(f"{digest(destination)}  {destination.name}\n", encoding="ascii")
    print(f"{destination}: subject content only; no application code or model weights.")
    return destination


def add_stream(archive, name, stream):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Invalid archive member: {name}")
    info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.compress_level = 1
    info.external_attr = 0o644 << 16
    with archive.open(info, "w", force_zip64=True) as output:
        shutil.copyfileobj(stream, output)


def add_application(archive, root, files, runtime):
    for path in files:
        with path.open("rb") as stream:
            add_stream(archive, f"{NAME}/app/{path.relative_to(root).as_posix()}", stream)
    with zipfile.ZipFile(runtime) as python_zip:
        if "LICENSE.txt" not in python_zip.namelist():
            raise ValueError("Python runtime license is missing.")
        for entry in sorted(python_zip.namelist()):
            if not entry.endswith("/"):
                with python_zip.open(entry) as stream:
                    add_stream(archive, f"{NAME}/runtime/{entry}", stream)
    for name in ("serve.py", "Start-RAG.cmd", "subject_pack.py", "activate-subject.py", "Activate-Subject.cmd"):
        with (ROOT / "windows" / name).open("rb") as stream:
            add_stream(archive, f"{NAME}/{name}", stream)


def add_models(archive, root, models):
    for path in models:
        with path.open("rb") as stream:
            add_stream(archive, f"{NAME}/app/{path.relative_to(root).as_posix()}", stream)


def finish_archive(temporary, destination):
    if temporary.stat().st_size >= ASSET_LIMIT:
        raise ValueError(f"Release asset must be under 2 GiB: {destination.name}")
    temporary.replace(destination)


def setup_script(version, archives):
    base = f"https://github.com/wongcyrus/{NAME}/releases/download/v{version}"
    lines = ["@echo off", "setlocal", 'cd /d "%~dp0"',
             f"echo SourceDesk AI v{version} setup",
             'if not exist ".downloads" mkdir ".downloads"']
    for index, archive in enumerate(archives):
        filename = archive.name
        expected = digest(archive)
        verify = (
            '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
            f"\"$ErrorActionPreference='Stop'; $s=[IO.File]::OpenRead('.downloads\\{filename}'); "
            "try { $h=[Security.Cryptography.SHA256]::Create(); "
            "try { $v=[BitConverter]::ToString($h.ComputeHash($s)).Replace('-',''); "
            f"if ($v -ne '{expected}') {{ exit 1 }} "
            "} finally { $h.Dispose() } } finally { $s.Dispose() }\""
        )
        lines += [
            f'if not exist ".downloads\\{filename}" goto download_{index}',
            verify, f"if not errorlevel 1 goto ready_{index}",
            f":download_{index}",
        ]
        if filename.endswith("-model.zip"):
            lines += [
                '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
                "\"$ErrorActionPreference='Stop'; $h=[Security.Cryptography.SHA256]::Create(); "
                "try { foreach ($p in [IO.Directory]::GetFiles('.downloads','*-windows-x64-model.zip')) { "
                "$s=[IO.File]::OpenRead($p); "
                "try { $v=[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','') } finally { $s.Dispose() }; "
                f"if ($v -eq '{expected}') {{ "
                f"if ([IO.File]::Exists('.downloads\\{filename}')) {{ [IO.File]::Delete('.downloads\\{filename}') }}; "
                f"[IO.File]::Move($p,'.downloads\\{filename}'); exit 0 "
                "} }; exit 1 } finally { $h.Dispose() }\"",
                f"if not errorlevel 1 goto ready_{index}",
            ]
        lines += [
            f'"%SystemRoot%\\System32\\curl.exe" --fail --location --retry 3 --output ".downloads\\{filename}" "{base}/{filename}"',
            "if errorlevel 1 goto failed", verify, "if errorlevel 1 goto failed",
            f":ready_{index}",
        ]
    for archive in archives:
        lines += [f'"%SystemRoot%\\System32\\tar.exe" -xf ".downloads\\{archive.name}"', "if errorlevel 1 goto failed"]
    lines += [f'echo Shared application and models ready in "{NAME}".',
              "echo For a new installation, extract a subject pack and drag its folder onto Activate-Subject.cmd.",
              "echo Then run Start-RAG.cmd. Existing active subjects are preserved.",
              "pause", "exit /b 0", ":failed",
              "echo Setup failed. Check internet, disk space and the downloaded files. No server was started.",
              "pause", "exit /b 1"]
    return "\r\n".join(lines) + "\r\n"


def package(root, output, cache):
    root, output = root.resolve(), output.resolve()
    release = json.loads((root / "release.json").read_text(encoding="utf-8"))
    project = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if release["application"] != NAME or release["version"] != project["version"]:
        raise ValueError("Run npm run prepare:offline to update the release metadata.")
    models = model_files(root, release)
    files = application_files(root, release)
    runtime = python_runtime(cache)
    output.mkdir(parents=True, exist_ok=True)
    prefix = f"{NAME}-{release['version']}-windows-x64"
    app_archive = output / f"{prefix}-app.zip"
    model_archive = output / (
        f"{NAME}-models-{release['embeddingModel']['revision'][:12]}-"
        f"{release['generationModel']['sha256'][:12]}-windows-x64-model.zip"
    )
    temporary = app_archive.with_suffix(".zip.download")
    with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
        add_application(archive, root, files, runtime)
    finish_archive(temporary, app_archive)
    temporary = model_archive.with_suffix(".zip.download")
    with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
        add_models(archive, root, models)
    finish_archive(temporary, model_archive)
    archives = [app_archive, model_archive]
    with (output / "Setup-RAG.cmd").open("w", encoding="ascii", newline="") as stream:
        stream.write(setup_script(release["version"], archives))
    (output / "SHA256SUMS.txt").write_text("".join(
        f"{digest(path)}  {path.name}\n" for path in [*archives, output / "Setup-RAG.cmd"]
    ), encoding="ascii")
    for path in [*archives, output / "Setup-RAG.cmd", output / "SHA256SUMS.txt"]:
        print(f"{path.name}: {path.stat().st_size:,} bytes")
    print("Prepared release assets only; nothing was committed or published.")


def package_common(root, output, cache):
    root, output = root.resolve(), output.resolve()
    release = json.loads((root / "release.json").read_text(encoding="utf-8"))
    project = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if release["application"] != NAME or release["version"] != project["version"]:
        raise ValueError("Run npm run prepare:offline to update the release metadata.")
    models = model_files(root, release)
    files = application_files(root, release)
    runtime = python_runtime(cache)
    output.mkdir(parents=True, exist_ok=True)
    destination = output / f"{NAME}-{release['version']}-common-windows-x64.zip"
    temporary = destination.with_suffix(".zip.download")
    with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
        add_application(archive, root, files, runtime)
        add_models(archive, root, models)
    finish_archive(temporary, destination)
    (output / f"{destination.name}.sha256").write_text(
        f"{digest(destination)}  {destination.name}\n", encoding="ascii"
    )
    print(f"{destination}: reusable Windows common package with app, runtime and shared models.")
    return destination


def student_installer_script(release, common, common_hash, subject, subject_archive, subject_hash, *, classroom=False):
    version = release["version"]
    base = f"https://github.com/wongcyrus/{NAME}/releases/download/v{version}"
    common_name = common.name
    subject_name = subject_archive.name
    folder = f"{subject['id']}-{subject['version']}"
    lines = [
        "@echo off",
        "setlocal",
        'cd /d "%~dp0"',
        f"echo Installing SourceDesk AI subject {subject['id']}",
        'if not exist ".downloads" mkdir ".downloads"',
        f'"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
        f"\"$ErrorActionPreference='Stop'; try {{ "
        f"$root='sourcedesk-ai\\app'; $r=Get-Content -Raw (Join-Path $root 'release.json') | ConvertFrom-Json; "
        "$m=Join-Path $root $r.generationModelPath; $e=Join-Path $root $r.embeddingModelPath; "
        "$onnx=Get-ChildItem -LiteralPath $e -Filter '*.onnx' -File -Recurse | Select-Object -First 1; "
        "$ort=Get-ChildItem -LiteralPath 'sourcedesk-ai\\app\\vendor\\onnx' -Filter '*.wasm' -File | Select-Object -First 1; "
        "$lm=Get-ChildItem -LiteralPath 'sourcedesk-ai\\app\\vendor\\litert-lm' -Filter '*.wasm' -File | Select-Object -First 1; "
        f"if ($r.application -ne '{NAME}' -or [version]$r.version -lt [version]'{version}' -or "
        "!(Test-Path -LiteralPath 'sourcedesk-ai\\runtime\\python.exe') -or "
        "!(Test-Path -LiteralPath $m) -or (Get-Item -LiteralPath $m).Length -ne $r.generationModel.bytes "
        "-or !$onnx -or !$ort -or !$lm) { exit 1 }; "
        "exit 0 } catch { exit 1 }\"",
        "if not errorlevel 1 goto common_ready",
    ]
    if classroom:
        lines += [
            f'set "common_archive={common_name}"',
            f'if exist "{common_name}" goto verify_local_common',
            f'set "common_archive=.downloads\\{common_name}"',
            f'if exist ".downloads\\{common_name}" goto verify_local_common',
            "echo Common files are missing or incomplete. Classroom setup never downloads them.",
            f"echo Copy {common_name} from your instructor beside this installer and run it again.",
            "goto failed",
            ":verify_local_common",
            '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
            f"\"$ErrorActionPreference='Stop'; $h=(Get-FileHash -LiteralPath $env:common_archive -Algorithm SHA256).Hash; "
            f"if ($h -ne '{common_hash}') {{ exit 1 }}\"",
            "if errorlevel 1 goto failed",
            '"%SystemRoot%\\System32\\tar.exe" -xf "%common_archive%"',
            "if errorlevel 1 goto failed",
        ]
    else:
        lines += [
            f'if not exist ".downloads\\{common_name}" goto download_common',
            '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
            f"\"$ErrorActionPreference='Stop'; $h=(Get-FileHash -LiteralPath '.downloads\\{common_name}' -Algorithm SHA256).Hash; "
            f"if ($h -ne '{common_hash}') {{ exit 1 }}\"",
            "if not errorlevel 1 goto extract_common",
            f'del /q ".downloads\\{common_name}"',
            ":download_common",
            f'echo Downloading the common app and models ({version})...',
            f'"%SystemRoot%\\System32\\curl.exe" --fail --location --retry 3 --output ".downloads\\{common_name}" "{base}/{common_name}"',
            "if errorlevel 1 goto failed",
            '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
            f"\"$ErrorActionPreference='Stop'; $h=(Get-FileHash -LiteralPath '.downloads\\{common_name}' -Algorithm SHA256).Hash; "
            f"if ($h -ne '{common_hash}') {{ exit 1 }}\"",
            "if errorlevel 1 goto failed",
            ":extract_common",
            f'"%SystemRoot%\\System32\\tar.exe" -xf ".downloads\\{common_name}"',
            "if errorlevel 1 goto failed",
            f'del /q ".downloads\\{common_name}"',
        ]
    lines += [
        ":common_ready",
        f'"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
        f"\"$ErrorActionPreference='Stop'; try {{ "
        f"$a=Get-Content -Raw 'sourcedesk-ai\\app\\active-subject.json' | ConvertFrom-Json; "
        f"if ($a.path -ne 'subjects/{folder}/subject.json' -or "
        f"!(Test-Path -LiteralPath 'sourcedesk-ai\\app\\subjects\\{folder}\\subject.json')) {{ exit 1 }}; "
        "exit 0 } catch { exit 1 }\"",
        "if not errorlevel 1 goto launch",
        f'set "subject_archive={subject_name}"',
        f'if exist "{subject_name}" goto verify_subject',
        f'set "subject_archive=.downloads\\{subject_name}"',
        f'if exist ".downloads\\{subject_name}" goto verify_subject',
        f'echo Downloading the {subject["id"]} subject pack...',
        f'"%SystemRoot%\\System32\\curl.exe" --fail --location --retry 3 --output ".downloads\\{subject_name}" "{base}/{subject_name}"',
        "if errorlevel 1 goto failed",
        ":verify_subject",
        '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
        f"\"$ErrorActionPreference='Stop'; $h=(Get-FileHash -LiteralPath $env:subject_archive -Algorithm SHA256).Hash; "
        f"if ($h -ne '{subject_hash}') {{ exit 1 }}\"",
        "if errorlevel 1 goto failed",
        f'if exist ".downloads\\subject-{folder}" rmdir /s /q ".downloads\\subject-{folder}"',
        f'mkdir ".downloads\\subject-{folder}"',
        f'"%SystemRoot%\\System32\\tar.exe" -xf "%subject_archive%" -C ".downloads\\subject-{folder}"',
        "if errorlevel 1 goto failed",
        f'"sourcedesk-ai\\runtime\\python.exe" "sourcedesk-ai\\activate-subject.py" '
        f'--directory "sourcedesk-ai\\app" --pack ".downloads\\subject-{folder}\\{folder}"',
        "if errorlevel 1 goto failed",
        f'del /q ".downloads\\{subject_name}"',
        f'rmdir /s /q ".downloads\\subject-{folder}"',
        ":launch",
        'call "sourcedesk-ai\\Start-RAG.cmd"',
        "exit /b %errorlevel%",
        ":failed",
        "echo Setup failed. Check your internet connection, disk space and Windows security notifications.",
        "pause",
        "exit /b 1",
    ]
    return "\r\n".join(lines) + "\r\n"


def package_student_installer(root, subject_root, output, *, classroom=False):
    root, subject_root, output = root.resolve(), subject_root.resolve(), output.resolve()
    release = json.loads((root / "release.json").read_text(encoding="utf-8"))
    project = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if release["application"] != NAME or release["version"] != project["version"]:
        raise ValueError("Run npm run prepare:offline to update the release metadata.")
    common = output / f"{NAME}-{release['version']}-common-windows-x64.zip"
    if not common.is_file():
        raise ValueError("Build the common archive first with npm run package:common.")
    subject, _ = read_subject(subject_root, release)
    subject_archive = package_subject(subject_root, output)
    prefix = "Classroom" if classroom else "Install"
    destination = output / f"{prefix}-{subject['id']}-{subject['version']}-RAG.cmd"
    script = student_installer_script(
        release, common, digest(common), subject, subject_archive, digest(subject_archive), classroom=classroom
    )
    with destination.open("w", encoding="ascii", newline="") as stream:
        stream.write(script)
    (output / f"{destination.name}.sha256").write_text(
        f"{digest(destination)}  {destination.name}\n", encoding="ascii"
    )
    print(f"{destination}: verifies, extracts and activates the {subject['title']} pack.")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Package a complete offline site for Windows 11 x64.")
    parser.add_argument("--site", type=Path, default=ROOT / "offline")
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache")
    subjects = parser.add_mutually_exclusive_group()
    subjects.add_argument("--common", action="store_true", help="Package the app, portable runtime and shared models.")
    subjects.add_argument("--installer", type=Path, help="Create a Windows bootstrapper for an installed subject pack.")
    subjects.add_argument("--classroom", type=Path, help="Create an installer that never downloads the common package.")
    subjects.add_argument("--subject", type=Path, help="Package only this built subject folder; no models required.")
    args = parser.parse_args()
    if args.common:
        package_common(args.site, args.out, args.cache)
    elif args.installer:
        package_student_installer(args.site, args.installer, args.out)
    elif args.classroom:
        package_student_installer(args.site, args.classroom, args.out, classroom=True)
    elif args.subject:
        package_subject(args.subject, args.out)
    else:
        package(args.site, args.out, args.cache)
