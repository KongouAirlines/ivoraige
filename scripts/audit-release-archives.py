#!/usr/bin/env python3
"""Inventory saved release assets without extracting or executing archive contents.

This establishes byte identity and an inspectable content inventory, not legal compliance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import tempfile
import zipfile


CHUNK = 1024 * 1024
TEXT_LIMIT = 1024 * 1024
TEXT_TOTAL_LIMIT = 20 * 1024 * 1024
CATEGORIES = ("dist_info_metadata", "dist_info_record", "licenses", "python_locks", "npm_packages", "native_binaries")


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_name(raw: str) -> str:
    # Windows separators and drives matter even when this script runs on Unix.
    if not raw or "\x00" in raw or "\\" in raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise ValueError(f"unsafe archive path: {raw!r}")
    if raw in (".", "./"):
        return "."
    while raw.startswith("./"):
        raw = raw[2:]
    parts = raw.rstrip("/").split("/")
    if any(part in ("", ".", "..") or ":" in part for part in parts):
        raise ValueError(f"unsafe archive path: {raw!r}")
    return str(PurePosixPath(*parts))


def categories(name: str) -> list[str]:
    lower = name.lower()
    base = lower.rsplit("/", 1)[-1]
    result = []
    if lower.endswith(".dist-info/metadata"):
        result.append("dist_info_metadata")
    if lower.endswith(".dist-info/record"):
        result.append("dist_info_record")
    if ("/licenses/" in f"/{lower}/" or base in ("third_party.md", "third-party.md") or
            re.search(r"licen[cs]e|copying|notice", base)):
        result.append("licenses")
    if base in ("requirements.lock", "poetry.lock", "pdm.lock", "uv.lock", "pipfile.lock") or re.fullmatch(r"requirements[^/]*\.txt", base):
        result.append("python_locks")
    if base in ("package.json", "package-lock.json", "npm-shrinkwrap.json"):
        result.append("npm_packages")
    if base.endswith((".dll", ".pyd", ".exe", ".node", ".so", ".dylib")):
        result.append("native_binaries")
    return result


def hash_stream(stream, expected_size: int) -> tuple[str, int, bytes | None]:
    digest = hashlib.sha256()
    size = 0
    small = bytearray()
    while block := stream.read(CHUNK):
        size += len(block)
        if size > expected_size:
            raise ValueError("member exceeds its declared size")
        digest.update(block)
        if size <= TEXT_LIMIT:
            small.extend(block)
    if size != expected_size:
        raise ValueError(f"member size mismatch: expected {expected_size}, got {size}")
    return digest.hexdigest(), size, bytes(small) if size <= TEXT_LIMIT else None


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def inventory_archive(path: Path, destination: Path) -> dict:
    inventory = destination / "members.jsonl"
    index = {category: [] for category in CATEGORIES}
    counts = {"file": 0, "directory": 0, "symlink": 0, "hardlink": 0, "other": 0}
    copied = 0
    seen = set()

    def emit(raw: str, kind: str, declared: int, source=None, link_target: str | None = None) -> None:
        nonlocal copied
        name = safe_name(raw)
        if name == "." and kind != "directory":
            raise ValueError("archive root must be a directory")
        if name in seen:
            raise ValueError(f"duplicate archive member: {name}")
        seen.add(name)
        if declared < 0:
            raise ValueError(f"negative member size: {name}")
        digest = None
        content = None
        size = declared
        if kind == "file":
            if source is None:
                raise ValueError(f"missing file data: {name}")
            digest, size, content = hash_stream(source, declared)
        else:
            size = 0
        row = {"path": name, "type": kind, "size": size, "sha256": digest}
        if link_target is not None:
            row["link_target"] = link_target
        manifest.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        counts[kind] += 1
        if kind != "file":
            return
        for category in categories(name):
            index[category].append(name)
        if content is not None and any(category != "native_binaries" for category in categories(name)) and copied + size <= TEXT_TOTAL_LIMIT:
            # Only bounded, UTF-8 text is copied. The original member path was checked above.
            try:
                content.decode("utf-8")
            except UnicodeDecodeError:
                return
            target = destination / "text" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            copied += size

    with inventory.open("w", encoding="utf-8") as manifest:
        if path.name.lower().endswith(".zip"):
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    mode = member.external_attr >> 16
                    kind = "directory" if member.is_dir() else "symlink" if stat.S_ISLNK(mode) else "file"
                    if kind == "file":
                        with archive.open(member) as source:
                            emit(member.filename, kind, member.file_size, source)
                    elif kind == "symlink":
                        with archive.open(member) as source:
                            target = source.read(TEXT_LIMIT + 1)
                        emit(member.filename, kind, member.file_size, link_target=target.decode("utf-8", errors="replace") if len(target) <= TEXT_LIMIT else "<oversized>")
                    else:
                        emit(member.filename, kind, 0)
        elif path.name.lower().endswith((".tar.gz", ".tgz")):
            with tarfile.open(path, "r:gz") as archive:
                for member in archive:
                    kind = ("file" if member.isfile() else "directory" if member.isdir() else
                            "symlink" if member.issym() else "hardlink" if member.islnk() else "other")
                    if kind == "file":
                        source = archive.extractfile(member)
                        if source is None:
                            raise ValueError(f"missing file data: {member.name}")
                        with source:
                            emit(member.name, kind, member.size, source)
                    else:
                        emit(member.name, kind, member.size, link_target=member.linkname if kind in ("symlink", "hardlink") else None)
        else:
            raise ValueError(f"unsupported archive: {path.name}")
    write_json(destination / "content-index.json", index)
    return {"member_count": len(seen), "types": counts, "indexed_paths": {key: len(value) for key, value in index.items()},
            "copied_text_bytes": copied,
            "link_review": {"required": counts["symlink"] + counts["hardlink"] > 0,
                            "reason": "symlink/hardlink targets require manual review; inventory does not establish legal compliance"}}


def audit(release_json: Path, downloads: Path, output: Path) -> dict:
    release = json.loads(release_json.read_text(encoding="utf-8"))
    assets = release.get("assets")
    if not isinstance(assets, list) or not assets:
        raise ValueError("release JSON has no assets")
    if output.exists():
        raise ValueError(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        summary = {"release_tag": release.get("tag_name"), "scope": "byte identity and archive inventory only; no legal compliance conclusion",
                   "link_review": {"symlinks": 0, "hardlinks": 0, "required": False,
                                   "reason": "link targets require manual review; no compliance conclusion"}, "assets": []}
        names = set()
        for asset in assets:
            name = asset.get("name")
            expected_size = asset.get("size")
            expected_digest = asset.get("digest")
            if not isinstance(name, str) or safe_name(name) != name or "/" in name or name in names:
                raise ValueError(f"invalid or duplicate release asset name: {name!r}")
            names.add(name)
            if not isinstance(expected_size, int) or expected_size < 0 or not isinstance(expected_digest, str) or not re.fullmatch(r"sha256:[0-9a-fA-F]{64}", expected_digest):
                raise ValueError(f"missing usable size/SHA-256 for {name}")
            path = downloads / name
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"release asset missing or symlink: {path}")
            actual_size = path.stat().st_size
            if actual_size != expected_size:
                raise ValueError(f"asset size mismatch for {name}: expected {expected_size}, got {actual_size}")
            actual_digest = digest_file(path)
            if actual_digest.lower() != expected_digest[7:].lower():
                raise ValueError(f"asset SHA-256 mismatch for {name}")
            row = {"name": name, "size": actual_size, "sha256": actual_digest, "release_size": expected_size, "release_digest": expected_digest, "verified": True}
            if name.lower().endswith((".zip", ".tar.gz", ".tgz")):
                folder = staging / name
                folder.mkdir()
                row["archive"] = inventory_archive(path, folder)
                summary["link_review"]["symlinks"] += row["archive"]["types"]["symlink"]
                summary["link_review"]["hardlinks"] += row["archive"]["types"]["hardlink"]
            summary["assets"].append(row)
        summary["link_review"]["required"] = summary["link_review"]["symlinks"] + summary["link_review"]["hardlinks"] > 0
        write_json(staging / "summary.json", summary)
        os.replace(staging, output)
        return summary
    except BaseException:
        shutil.rmtree(staging)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True, help="saved GitHub Release API JSON")
    parser.add_argument("--downloads", type=Path, required=True, help="directory containing every release asset")
    parser.add_argument("--output", type=Path, required=True, help="new evidence directory")
    args = parser.parse_args()
    try:
        result = audit(args.release, args.downloads, args.output)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, tarfile.TarError) as error:
        parser.exit(1, f"archive audit failed: {error}\n")
    print(f"Verified {len(result['assets'])} release assets; evidence: {args.output}")


if __name__ == "__main__":
    main()
