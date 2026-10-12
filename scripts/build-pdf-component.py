from __future__ import annotations

import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
COMPONENT_VERSION = "0.6.4"
PYMUPDF_VERSION = "1.26.7"
PYINSTALLER_VERSION = "6.22.3"


def checked_path(path: Path, parent: Path, label: str) -> Path:
    path = path.resolve()
    parent = parent.resolve()
    if not path.is_relative_to(parent):
        raise RuntimeError(f"Refusing {label} outside {parent}: {path}")
    return path


def run(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def license_text() -> str:
    lock_lines = (ROOT / "sidecars/babeldoc/requirements.lock").read_text(encoding="utf-8").splitlines()
    package_names = []
    for line in lock_lines:
        if not line or line.startswith("#") or "==" not in line:
            continue
        package_names.append(line.split("==", 1)[0].lower().replace("_", "-").replace(".", "-"))
    package_names.append("pyinstaller")
    sections = []
    for name in package_names:
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        files = list(dist.files or [])
        notices = []
        for entry in files:
            normalized = str(entry).replace("\\", "/")
            base = normalized.rsplit("/", 1)[-1]
            if "/licenses/" not in normalized.lower() and not any(
                base.lower().startswith(prefix) for prefix in ("license", "licence", "copying", "notice")
            ):
                continue
            try:
                content = dist.locate_file(entry).read_text(encoding="utf-8", errors="replace").strip()
            except (OSError, UnicodeError):
                continue
            if content and content not in notices:
                notices.append(content)
        if notices:
            sections.append(f"{dist.metadata['Name']} {dist.version} ({dist.metadata.get('License') or 'see included notice'})\n" + "\n\n".join(notices))
        elif dist.metadata.get("License"):
            sections.append(f"{dist.metadata['Name']} {dist.version}: {dist.metadata['License']} (no standalone license text in installed distribution)")
    return "\n\n====================\n\n".join(sections) + "\n"


def smoke(executable: Path, cwd: Path, asset_dir: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="ivoraige-pdf-component-smoke-", dir=cwd) as temp:
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "handshake", "params": {"protocolVersion": 1}},
            {"jsonrpc": "2.0", "id": 2, "method": "configure", "params": {"modelDirs": {"babeldoc": str(asset_dir)}, "options": {}}},
            {"jsonrpc": "2.0", "id": 3, "method": "shutdown", "params": {}},
        ]
        payload = "".join(json.dumps(item) + "\n" for item in requests)
        clean_home = Path(temp) / "home"
        clean_home.mkdir()
        env = {"PATH": os.pathsep.join([os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")]),
               "SystemRoot": os.environ.get("SystemRoot", r"C:\Windows"),
               "WINDIR": os.environ.get("WINDIR", r"C:\Windows"),
               "TEMP": temp, "TMP": temp, "USERPROFILE": str(clean_home),
               "HOME": str(clean_home), "LOCALAPPDATA": str(clean_home / "AppData/Local"),
               "APPDATA": str(clean_home / "AppData/Roaming"), "PYTHONNOUSERSITE": "1"}
        for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV", "UV_PROJECT_ENVIRONMENT"):
            env.pop(key, None)
        result = subprocess.run(
            [str(executable)], input=payload, cwd=cwd, text=True, encoding="utf-8",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Sidecar exited {result.returncode}: {result.stderr[-4000:]}")
        lines = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        if len(lines) != 3 or lines[0].get("result", {}).get("protocolVersion") != 1:
            raise RuntimeError(f"Frozen sidecar handshake failed: {result.stdout}\n{result.stderr}")
        configure = lines[1].get("result")
        if lines[1].get("error") or not isinstance(configure, dict):
            raise RuntimeError(f"Sidecar rejected its bundled assets: {lines[1]}\n{result.stderr}")
        if lines[2].get("result") is not None:
            raise RuntimeError(f"Sidecar shutdown response was unexpected: {lines[2]}")
        return {"handshake": lines[0]["result"], "configureWithAssets": configure, "stderr": result.stderr[-1000:]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", required=True)
    parser.add_argument("--reuse-pyinstaller-build", action="store_true")
    args = parser.parse_args()
    python = Path(args.python).resolve()
    import platform

    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("BabelDOC component builds must run on Windows x64")
    import babeldoc.const as babeldoc_const
    import pymupdf
    import PyInstaller
    from PyInstaller.utils.hooks import collect_delvewheel_libs_directory

    if babeldoc_const.__version__ != COMPONENT_VERSION or pymupdf.VersionBind != PYMUPDF_VERSION:
        raise RuntimeError(
            f"Unexpected runtime versions: BabelDOC {babeldoc_const.__version__}, PyMuPDF {pymupdf.VersionBind}"
        )
    if PyInstaller.__version__ != PYINSTALLER_VERSION:
        raise RuntimeError(f"PyInstaller {PYINSTALLER_VERSION} required; found {PyInstaller.__version__}")
    # hyperscan's extension loads its hashed VC runtime from this sibling wheel
    # directory. --collect-all hyperscan does not include delvewheel .libs files.
    delvewheel_data, delvewheel_binaries = collect_delvewheel_libs_directory("hyperscan")
    if not delvewheel_binaries:
        raise RuntimeError("hyperscan.libs DLLs are missing from the build Python environment")

    runs = (ROOT / "evaluation/runs").resolve()
    distribution = checked_path(runs / f"distribution-{VERSION}", runs, "component output")
    output = checked_path(distribution / "components", distribution, "component archive directory")
    stage = checked_path(output / "babeldoc-component", output, "component staging directory")
    work = checked_path(runs / f"pdf-component-build-{VERSION}", runs, "PyInstaller work directory")
    dist_dir = work / "dist"
    built = dist_dir / "babeldoc-sidecar"
    shutil.rmtree(stage, ignore_errors=True)
    if not args.reuse_pyinstaller_build:
        shutil.rmtree(work, ignore_errors=True)
    output.mkdir(parents=True, exist_ok=True)
    stage.mkdir(parents=True, exist_ok=True)
    spec_dir = work / "spec"
    build_dir = work / "build"
    spec_dir.mkdir(parents=True, exist_ok=True)

    pyinstaller = [
        str(python), "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console",
        "--name", "babeldoc-sidecar", "--distpath", str(dist_dir), "--workpath", str(build_dir),
        "--specpath", str(spec_dir), "--collect-all", "babeldoc", "--collect-all", "pymupdf",
        "--collect-all", "onnxruntime", "--collect-all", "cv2", "--collect-all", "tiktoken",
        "--collect-all", "bitstring", "--collect-all", "bitarray",
        "--hidden-import", "tiktoken_ext.openai_public",
    ]
    for source, destination in delvewheel_data:
        pyinstaller.extend(["--add-data", f"{source}{os.pathsep}{destination}"])
    for source, destination in delvewheel_binaries:
        pyinstaller.extend(["--add-binary", f"{source}{os.pathsep}{destination}"])
    pyinstaller.append(str(ROOT / "sidecars/babeldoc/server.py"))
    if args.reuse_pyinstaller_build:
        if not (built / "babeldoc-sidecar.exe").is_file():
            raise RuntimeError(f"Cannot reuse missing PyInstaller output: {built}")
    else:
        run(pyinstaller, ROOT)
    if not (built / "babeldoc-sidecar.exe").is_file():
        raise RuntimeError("PyInstaller did not produce babeldoc-sidecar.exe")
    bundled_hyperscan_libs = [built / "_internal" / destination / Path(source).name
                              for source, destination in delvewheel_binaries]
    missing_hyperscan_libs = [str(path) for path in bundled_hyperscan_libs if not path.is_file()]
    if missing_hyperscan_libs:
        raise RuntimeError(f"PyInstaller output omits hyperscan DLLs; rebuild without --reuse-pyinstaller-build: {missing_hyperscan_libs}")
    shutil.copytree(built, stage, dirs_exist_ok=True)
    (stage / "requirements.lock").write_bytes((ROOT / "sidecars/babeldoc/requirements.lock").read_bytes())
    (stage / "README.md").write_text(
        "BabelDOC sidecar 0.6.4 for Windows x64. Install the separate asset archive under ./assets before PDF capture.\n",
        encoding="utf-8",
    )
    (stage / "THIRD_PARTY_LICENSES.txt").write_text(license_text(), encoding="utf-8")
    python_license = Path(sys.base_prefix) / "LICENSE_PYTHON.txt"
    if not python_license.is_file():
        raise RuntimeError(f"Python license file missing from build runtime: {python_license}")
    shutil.copyfile(python_license, stage / "PYTHON-LICENSE.txt")
    component = {
        "id": "babeldoc",
        "version": COMPONENT_VERSION,
        "platform": "win32",
        "arch": "x64",
        "protocolVersion": 1,
        "command": "babeldoc-sidecar.exe",
        "args": [],
        "modelDirs": {"babeldoc": "assets"},
    }
    (stage / "component.json").write_text(json.dumps(component, indent=2) + "\n", encoding="utf-8")

    source_cache = Path.home() / ".cache" / "babeldoc"
    required_asset_paths = ["cmap", "fonts", "models", "tiktoken"]
    missing = [name for name in required_asset_paths if not (source_cache / name).is_dir()]
    model_file = source_cache / "models" / "doclayout_yolo_docstructbench_imgsz1024.onnx"
    if missing or not model_file.is_file():
        raise RuntimeError(f"Existing BabelDOC cache is incomplete: missing dirs={missing}, model={model_file.is_file()}")
    assets_stage = checked_path(output / "babeldoc-assets", output, "assets staging directory")
    shutil.rmtree(assets_stage, ignore_errors=True)
    assets_root = assets_stage / "assets"
    assets_root.mkdir(parents=True)
    for name in required_asset_paths:
        shutil.copytree(source_cache / name, assets_root / name)
    (assets_root / "ASSET-SOURCES.md").write_text(
        "BabelDOC offline assets, packaged from the existing BabelDOC 0.6.4 cache.\n\n"
        "The fonts/ and cmap/ files come from BabelDOC-Assets. The per-file sources,\n"
        "font notices, and included upstream license texts are documented in licenses/.\n"
        "The model file doclayout_yolo_docstructbench_imgsz1024.onnx comes from\n"
        "https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx.\n"
        "The tiktoken cache file fb374d419588a4632f3f557e76b4b70aebbca790 is the\n"
        "o200k_base encoding from https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken.\n"
        "See licenses/ASSET-LICENSE-STATUS.md for the complete source and notice map.\n\n"
        "This archive carries upstream provenance, notices, and license texts documented\n"
        "in licenses/ASSET-LICENSE-STATUS.md.\n"
        "No BabelDOC cache database is included.\n",
        encoding="utf-8",
    )
    license_source = ROOT / "sidecars/babeldoc/asset-licenses"
    license_dir = assets_root / "licenses"
    if license_source.is_dir():
        shutil.copytree(
            license_source, license_dir,
            ignore=lambda _directory, names: [name for name in names if name.lower().endswith(".tmp") or name == "__pycache__"],
        )
    license_files = sorted(str(path.relative_to(assets_root)).replace("\\", "/")
                           for path in license_dir.rglob("*") if path.is_file()) if license_dir.exists() else []
    smoke_result = smoke(stage / "babeldoc-sidecar.exe", stage, assets_root)

    archive_name = f"babeldoc-{COMPONENT_VERSION}-win32-x64.tar.gz"
    archive = output / archive_name
    archive.unlink(missing_ok=True)
    with tarfile.open(archive, "w:gz", compresslevel=1) as tar:
        for item in sorted(stage.iterdir()):
            tar.add(item, arcname=item.name)
    package = {"name": archive_name, "size": archive.stat().st_size, "sha256": sha256(archive)}
    assets_archive_name = f"babeldoc-assets-{COMPONENT_VERSION}-win32-x64.tar.gz"
    assets_archive = output / assets_archive_name
    assets_archive.unlink(missing_ok=True)
    with tarfile.open(assets_archive, "w:gz", compresslevel=1) as tar:
        tar.add(assets_root, arcname="assets")
    assets_package = {"name": assets_archive_name, "size": assets_archive.stat().st_size, "sha256": sha256(assets_archive)}
    manifest = {
        "schemaVersion": 1,
        "components": [{
            "id": "babeldoc", "version": COMPONENT_VERSION, "platform": "win32", "arch": "x64",
            "protocolVersion": 1, "package": package, "assets": assets_package,
        }],
    }
    (output / "components-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    evidence = {
        "runtime": {"python": sys.version.split()[0], "babeldoc": babeldoc_const.__version__,
                    "pymupdf": pymupdf.VersionBind, "pyinstaller": PyInstaller.__version__},
        "pyinstallerBuildReused": args.reuse_pyinstaller_build,
        "hyperscanDelvewheelBinaries": [str(path.relative_to(built)).replace("\\", "/")
                                        for path in bundled_hyperscan_libs],
        "component": component,
        "pythonLicense": "PYTHON-LICENSE.txt",
        "package": package,
        "smoke": smoke_result,
        "assets": assets_package,
        "modelAssetsIncluded": True,
        "assetSourceCache": str(source_cache),
        "assetLicenseFiles": license_files,
        "assetLicenseStatus": "assets/licenses/ASSET-LICENSE-STATUS.md",
    }
    (output / "build-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
