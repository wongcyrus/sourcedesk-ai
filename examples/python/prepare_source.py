import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath
from urllib.request import urlopen
from zipfile import ZipFile, BadZipFile


SOURCE_URL = "https://docs.python.org/3/archives/python-3.15-docs-html.zip"
OUTPUT = Path(__file__).resolve().parent / "content" / "tutorial"
MAX_ARCHIVE_SIZE = 100 * 1024 * 1024
MAX_TUTORIAL_SIZE = 100 * 1024 * 1024


def main():
    total = 0
    with tempfile.TemporaryFile() as archive_file:
        with urlopen(SOURCE_URL, timeout=30) as response:
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > MAX_ARCHIVE_SIZE:
                    raise ValueError("Python documentation archive exceeds the 100 MiB limit.")
                archive_file.write(block)
        archive_file.seek(0)
        try:
            with ZipFile(archive_file) as archive:
                files = []
                expanded = 0
                for entry in archive.infolist():
                    path = PurePosixPath(entry.filename)
                    if "tutorial" not in path.parts or path.suffix.lower() not in {".html", ".htm"}:
                        continue
                    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
                        raise ValueError(f"Unsafe path in Python documentation archive: {entry.filename}")
                    expanded += entry.file_size
                    if entry.file_size > 10 * 1024 * 1024 or expanded > MAX_TUTORIAL_SIZE:
                        raise ValueError("Python tutorial files exceed the 100 MiB extraction limit.")
                    files.append((entry, path.parts[path.parts.index("tutorial") + 1:]))
                if not files:
                    raise ValueError("Python documentation archive contains no tutorial HTML files.")
                for entry, relative_path in files:
                    target = OUTPUT.joinpath(*relative_path)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as source, target.open("wb") as destination:
                        shutil.copyfileobj(source, destination)
        except BadZipFile as error:
            raise ValueError("Downloaded Python documentation is not a valid ZIP archive.") from error
    print(f"Prepared {len(files)} official Python tutorial pages in {OUTPUT}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Python source preparation failed: {error}", file=sys.stderr)
        raise
