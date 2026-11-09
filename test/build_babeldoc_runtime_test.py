"""Build source isolation, without Rust, downloads, models or a real upstream clone."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("babeldoc_build", Path(__file__).parents[1] / "scripts/build-babeldoc-runtime.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SourceIsolationTests(unittest.TestCase):
    def test_cache_untracked_ignored_and_dirty_files_do_not_enter_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "cache"
            cache.mkdir()
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=cache, text=True).strip()
            git("init")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            git("config", "core.autocrlf", "false")
            (cache / "source.py").write_text("original\n", encoding="utf-8")
            (cache / ".gitignore").write_text("ignored.py\n", encoding="utf-8")
            git("add", ".")
            git("-c", "commit.gpgsign=false", "commit", "-m", "original fixture")
            revision = git("rev-parse", "HEAD")
            (cache / "source.py").write_text("patched\n", encoding="utf-8")
            patch_file = root / "bridge.patch"
            patch_file.write_bytes(subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=cache))
            (cache / "source.py").write_text("unexpected worktree edit\n", encoding="utf-8")
            (cache / ".cargo").mkdir()
            (cache / ".cargo/config.toml").write_text("# untracked build configuration\n", encoding="utf-8")
            (cache / "babeldoc").mkdir()
            (cache / "babeldoc/extra.py").write_text("untracked package input\n", encoding="utf-8")
            (cache / "ignored.py").write_text("ignored package input\n", encoding="utf-8")
            clean = root / "isolated"
            with patch.object(builder, "REVISION", revision), patch.object(builder, "PATCH", patch_file):
                builder.isolated_source(cache, clean)
            self.assertEqual((clean / "source.py").read_text(), "patched\n")
            for name in (".cargo/config.toml", "babeldoc/extra.py", "ignored.py"):
                self.assertFalse((clean / name).exists(), name)
                self.assertTrue((cache / name).exists(), name)
            self.assertEqual((cache / "source.py").read_text(), "unexpected worktree edit\n")

    def test_other_head_is_rejected_without_creating_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(builder, "output", return_value="wrong"):
                with self.assertRaisesRegex(RuntimeError, "pinned official"):
                    builder.isolated_source(root, root / "build")
            self.assertFalse((root / "build").exists())


if __name__ == "__main__":
    unittest.main()
