import argparse
import json
import shutil
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from subject_pack import pack_path, read_subject


def activate(pack, root):
    root = Path(root).resolve()
    source = Path(pack).resolve()
    release = json.loads((root / "release.json").read_text(encoding="utf-8"))
    if release["application"] != "sourcedesk-ai":
        raise ValueError("Prepare the SourceDesk AI application before activating a subject.")
    subject, _ = read_subject(source, release)
    folder = f"{subject['id']}-{subject['version']}"
    subjects = root / "subjects"
    subjects.mkdir(exist_ok=True)
    if subjects.is_symlink():
        raise ValueError("The subject directory must not be a symbolic link.")
    destination = subjects / folder
    if destination.is_symlink():
        raise ValueError("The installed pack must not be a symbolic link.")
    if destination.exists():
        existing, _ = read_subject(destination, release)
        if existing != subject:
            raise ValueError("An existing subject version has different metadata.")
    else:
        with tempfile.TemporaryDirectory(prefix=".install-", dir=subjects) as temporary:
            staged = Path(temporary) / folder
            staged.mkdir()
            for name in ("subject.json", *subject["files"]):
                path = staged / name
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(pack_path(source, name), path)
            read_subject(staged, release)
            staged.rename(destination)
    # Keep the working pointer unchanged until the entire new pack is validated.
    temporary = root / "active-subject.json.download"
    temporary.write_text(json.dumps({"path": f"subjects/{folder}/subject.json"}, indent=2) + "\n", encoding="utf-8")
    temporary.replace(root / "active-subject.json")
    print(f"Active subject: {subject['title']}. Reload http://localhost:8080/ to start a new chat.")
    print("Shared application and model files were not copied or changed.")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Install and activate one SourceDesk AI subject pack.")
    parser.add_argument("--pack", type=Path, required=True, help="Extracted folder containing subject.json")
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[1] / "offline")
    args = parser.parse_args()
    try:
        activate(args.pack, args.directory)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Cannot activate subject: {error}\n")
