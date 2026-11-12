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
component_spec = importlib.util.spec_from_file_location("pdf_component_build", Path(__file__).parents[1] / "scripts/build-pdf-component.py")
component_builder = importlib.util.module_from_spec(component_spec)
component_spec.loader.exec_module(component_builder)


class FrozenDependencyTests(unittest.TestCase):
    def test_frozen_probe_checks_pillow_instead_of_trusting_host(self):
        import json
        versions = {"python": "3.13.5", "babeldoc": component_builder.COMPONENT_VERSION,
                    "pymupdf": component_builder.PYMUPDF_VERSION, "pillow": "13.0.0",
                    "sourceBridge": 1, "layoutFitPolicy": component_builder.LAYOUT_FIT_POLICY,
                    "underscoreLinePolicy": component_builder.UNDERSCORE_LINE_POLICY}
        for pillow in ("12.3.0", "13.0.0"):
            with self.subTest(pillow=pillow):
                reported = {**versions, "pillow": pillow}
                result = subprocess.CompletedProcess([], 0, json.dumps(reported), "")
                with patch.object(component_builder.subprocess, "run", return_value=result) as run:
                    if pillow == "13.0.0":
                        self.assertEqual(component_builder.frozen_runtime_versions(Path("sidecar.exe"), Path(".")), reported)
                    else:
                        with self.assertRaisesRegex(RuntimeError, "rebuild without --reuse-pyinstaller-build"):
                            component_builder.frozen_runtime_versions(Path("sidecar.exe"), Path("."))
                    self.assertEqual(run.call_args.args[0], ["sidecar.exe", "--runtime-versions"])
                    self.assertEqual(run.call_args.kwargs["input"], "")

    def test_frozen_probe_rejects_missing_or_stale_native_policies(self):
        import json
        versions = {"python": "3.13.5", "babeldoc": component_builder.COMPONENT_VERSION,
                    "pymupdf": component_builder.PYMUPDF_VERSION, "pillow": "13.0.0",
                    "sourceBridge": 1, "layoutFitPolicy": "fit-box-v1",
                    "underscoreLinePolicy": "ascii-alnum-base-v1"}
        for key, stale in (("sourceBridge", 0), ("layoutFitPolicy", "fit-box-v0"),
                           ("underscoreLinePolicy", "ascii-base-v2")):
            for value in (None, stale):
                with self.subTest(key=key, value=value), patch.object(component_builder.subprocess, "run",
                        return_value=subprocess.CompletedProcess([], 0, json.dumps({**versions, key: value}), "")):
                    with self.assertRaisesRegex(RuntimeError, "Unexpected frozen runtime"):
                        component_builder.frozen_runtime_versions(Path("sidecar.exe"), Path("."))

    def test_native_runtime_version_matches_the_full_lock(self):
        root = Path(__file__).parents[1]
        lock = (root / "sidecars/babeldoc/requirements.lock").read_text(encoding="utf-8").splitlines()
        self.assertEqual(component_builder.COMPONENT_VERSION, builder.VERSION)
        self.assertIn(f"babeldoc=={builder.VERSION}", lock)
        self.assertIn('version = "' + builder.VERSION + '"', builder.PATCH.read_text(encoding="utf-8"))

    def test_native_runtime_version_does_not_depend_on_windows_locale(self):
        # Emulate the Windows ANSI default even on UTF-8 development hosts.
        with patch("pathlib.io.text_encoding",
                   side_effect=lambda encoding, *args: "cp1252" if encoding is None else encoding):
            self.test_native_runtime_version_matches_the_full_lock()

    def test_legacy_frozen_output_cannot_masquerade_as_upgraded_runtime(self):
        for stdout in ("", "[]", "{}", '{"pillow":"13.0.0"}'):
            with self.subTest(stdout=stdout), patch.object(component_builder.subprocess, "run",
                    return_value=subprocess.CompletedProcess([], 0, stdout, "")):
                with self.assertRaisesRegex(RuntimeError, "rebuild without --reuse-pyinstaller-build"):
                    component_builder.frozen_runtime_versions(Path("sidecar.exe"), Path("."))

    def test_active_lock_pins_fixed_pillow(self):
        root = Path(__file__).parents[1]
        self.assertIn("pillow==13.0.0", (root / "sidecars/babeldoc/requirements.lock").read_text(encoding="utf-8").splitlines())
        self.assertEqual(component_builder.PILLOW_VERSION, "13.0.0")

    def test_frozen_probe_requires_the_python_313_baseline(self):
        import json
        versions = {"babeldoc": component_builder.COMPONENT_VERSION,
                    "pymupdf": component_builder.PYMUPDF_VERSION, "pillow": "13.0.0",
                    "sourceBridge": 1, "layoutFitPolicy": component_builder.LAYOUT_FIT_POLICY,
                    "underscoreLinePolicy": component_builder.UNDERSCORE_LINE_POLICY}
        for python in (None, "3.12.14", "3.14.0", "3.13.5"):
            with self.subTest(python=python), patch.object(component_builder.subprocess, "run",
                    return_value=subprocess.CompletedProcess([], 0, json.dumps({**versions, "python": python}), "")):
                if python == "3.13.5":
                    self.assertEqual(component_builder.frozen_runtime_versions(Path("sidecar.exe"), Path("."))["python"], python)
                else:
                    with self.assertRaisesRegex(RuntimeError, "Unexpected frozen runtime"):
                        component_builder.frozen_runtime_versions(Path("sidecar.exe"), Path("."))

    def test_component_build_rejects_another_python_before_packaging(self):
        with patch.object(component_builder.sys, "argv", ["build", "--python", component_builder.sys.executable]), \
                patch.object(component_builder.sys, "version_info", (3, 12, 14)):
            with self.assertRaisesRegex(RuntimeError, "Python 3.13 required"):
                component_builder.main()


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
            (cache / "added_test.py").write_text("new regression from recorded patch\n", encoding="utf-8")
            git("add", "-N", "added_test.py")
            patch_file = root / "bridge.patch"
            patch_file.write_bytes(subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=cache))
            (cache / "source.py").write_text("unexpected worktree edit\n", encoding="utf-8")
            (cache / "added_test.py").write_text("dirty cache copy must not enter build\n", encoding="utf-8")
            (cache / ".cargo").mkdir()
            (cache / ".cargo/config.toml").write_text("# untracked build configuration\n", encoding="utf-8")
            (cache / "babeldoc").mkdir()
            (cache / "babeldoc/extra.py").write_text("untracked package input\n", encoding="utf-8")
            (cache / "ignored.py").write_text("ignored package input\n", encoding="utf-8")
            clean = root / "isolated"
            with patch.object(builder, "REVISION", revision), patch.object(builder, "PATCH", patch_file):
                builder.isolated_source(cache, clean)
            self.assertEqual((clean / "source.py").read_text(), "patched\n")
            self.assertEqual((clean / "added_test.py").read_text(), "new regression from recorded patch\n")
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
