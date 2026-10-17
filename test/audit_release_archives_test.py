"""Small original fixtures for the read-only release archive inventory."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-release-archives.py"


class ArchiveAuditTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.downloads = self.root / "downloads"
        self.downloads.mkdir()
        self.release = self.root / "release.json"
        self.output = self.root / "evidence"

    def run_audit(self, assets):
        self.release.write_text(json.dumps({"tag_name": "fixture-0.1.0", "assets": [
            {"name": path.name, "size": path.stat().st_size,
             "digest": "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in assets
        ]}), encoding="utf-8")
        return subprocess.run([sys.executable, str(SCRIPT), "--release", str(self.release),
                               "--downloads", str(self.downloads), "--output", str(self.output)],
                              text=True, capture_output=True)

    def test_zip_tar_and_independent_index(self):
        zip_path = self.downloads / "app.zip"
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("./", "")
            archive.writestr("./app/package.json", '{"name":"fixture"}\n')
            archive.writestr("app/runtime/a.dll", b"binary")
            for name in ("THIRD_PARTY_LICENSES.txt", "PYTHON-LICENSE.txt", "NODE-LICENSE.txt", "THIRD_PARTY.md", "ThirdPartyNotices.txt", "CopyrightNotice.txt"):
                archive.writestr("app/" + name, "fixture license\n")
            for name in ("addon.node", "lib.so", "lib.dylib"):
                archive.writestr("app/native/" + name, b"binary")
        tar_path = self.downloads / "component.tar.gz"
        with tarfile.open(tar_path, "w:gz") as archive:
            for name, data in [("bundle/pkg.dist-info/METADATA", b"Name: fixture\n"),
                               ("bundle/pkg.dist-info/RECORD", b"row\n"),
                               ("bundle/requirements.lock", b"pkg==1\n")]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            link = tarfile.TarInfo("bundle/link")
            link.type = tarfile.SYMTYPE
            link.linkname = "target"
            archive.addfile(link)
            hardlink = tarfile.TarInfo("bundle/hardlink")
            hardlink.type = tarfile.LNKTYPE
            hardlink.linkname = "bundle/pkg.dist-info/METADATA"
            archive.addfile(hardlink)
        extra = self.downloads / "components-manifest.json"
        extra.write_text("{}", encoding="utf-8")
        result = self.run_audit([zip_path, tar_path, extra])
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(len(summary["assets"]), 3)
        self.assertEqual(summary["link_review"]["symlinks"], 1)
        self.assertEqual(summary["link_review"]["hardlinks"], 1)
        self.assertTrue(summary["link_review"]["required"])
        self.assertIn("manual review", summary["link_review"]["reason"])
        rows = [json.loads(line) for line in (self.output / "component.tar.gz" / "members.jsonl").read_text().splitlines()]
        self.assertEqual(rows[0]["sha256"], hashlib.sha256(b"Name: fixture\n").hexdigest())
        self.assertEqual([row["type"] for row in rows[-2:]], ["symlink", "hardlink"])
        index = json.loads((self.output / "component.tar.gz" / "content-index.json").read_text())
        self.assertEqual(index["dist_info_record"], ["bundle/pkg.dist-info/RECORD"])
        zip_index = json.loads((self.output / "app.zip" / "content-index.json").read_text())
        self.assertEqual(set(zip_index["licenses"]), {
            "app/THIRD_PARTY_LICENSES.txt", "app/PYTHON-LICENSE.txt", "app/NODE-LICENSE.txt", "app/THIRD_PARTY.md",
            "app/ThirdPartyNotices.txt", "app/CopyrightNotice.txt"})
        self.assertTrue({"app/native/addon.node", "app/native/lib.so", "app/native/lib.dylib"}.issubset(zip_index["native_binaries"]))
        for path in zip_index["licenses"]:
            self.assertEqual((self.output / "app.zip" / "text" / path).read_text(), "fixture license\n")

    def test_missing_or_wrong_hash_fails_without_partial_evidence(self):
        archive = self.downloads / "ok.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("a", "a")
        missing = self.downloads / "missing.zip"
        self.release.write_text(json.dumps({"assets": [
            {"name": archive.name, "size": archive.stat().st_size,
             "digest": "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest()},
            {"name": missing.name, "size": 1, "digest": "sha256:" + "0" * 64},
        ]}), encoding="utf-8")
        command = [sys.executable, str(SCRIPT), "--release", str(self.release),
                   "--downloads", str(self.downloads), "--output", str(self.output)]
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
        self.assertFalse(self.output.exists())
        self.release.write_text(json.dumps({"assets": [{"name": archive.name, "size": archive.stat().st_size,
            "digest": "sha256:" + "0" * 64}]}), encoding="utf-8")
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
        self.assertFalse(self.output.exists())

    def test_unsafe_and_duplicate_members_fail(self):
        for members in [[("../escape", "x")], [("same", "x"), ("same", "y")]]:
            with self.subTest(members=members):
                archive = self.downloads / "bad.zip"
                with zipfile.ZipFile(archive, "w") as z:
                    for name, data in members:
                        z.writestr(name, data)
                result = self.run_audit([archive])
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
