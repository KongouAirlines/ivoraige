# SPDX-License-Identifier: AGPL-3.0-only
"""Build the versioned BabelDOC source bridge, never a replacement PDF pipeline."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import tempfile
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = "https://github.com/funstory-ai/BabelDOC.git"
REVISION = "d922e2b0c5a353bde8731921eb442c07ae75849d"
VERSION = "0.7.1+ivoraige.3"
PATCH = ROOT / "sidecars/babeldoc/patches/0.7.1/source-bridge-layout-fit-v1.patch"


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def isolated_source(cache: Path, destination: Path) -> Path:
    """Use Git objects only; never build cache worktree extras or its config/hooks."""
    if output(["git", "rev-parse", "HEAD"], cwd=cache) != REVISION:
        raise RuntimeError("Source checkout differs from pinned official BabelDOC revision")
    run(["git", "clone", "--no-hardlinks", "--no-checkout", str(cache), str(destination)])
    run(["git", "checkout", "--detach", REVISION], cwd=destination)
    run(["git", "apply", "--index", "--check", str(PATCH)], cwd=destination)
    run(["git", "apply", "--index", str(PATCH)], cwd=destination)
    if subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=destination) != PATCH.read_bytes():
        raise RuntimeError("Isolated source differs from the exact bridge patch")
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, default=ROOT / "evaluation/runs/babeldoc-runtime-0.7.1")
    args = parser.parse_args()
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    if importlib.metadata.version("maturin") != "1.15.0":
        raise RuntimeError("Install maturin==1.15.0 in the build environment")
    rust = output(["rustc", "--version"])
    if not rust.startswith("rustc 1.99.1 "):
        raise RuntimeError(f"Rust 1.99.1 required for this build recipe; found {rust}")
    source = work / "source"
    if not source.exists():
        run(["git", "clone", "--depth", "1", "--branch", "v0.7.1", UPSTREAM, str(source)])
    patch = PATCH.read_bytes()
    wheels = work / "wheels"
    wheels.mkdir(exist_ok=True)
    # Preserve the caller's source cache. Only the pinned Git tree enters the build.
    # Cargo products are kept separately and are never copied into the source tree.
    env = {**os.environ, "CARGO_TARGET_DIR": str(work / "target")}
    with tempfile.TemporaryDirectory(prefix="build-0.7.1-", dir=work) as directory:
        clean = isolated_source(source, Path(directory) / "source")
        run([sys.executable, "-m", "maturin", "build", "--locked", "--release",
             "--manifest-path", str(clean / "rust/p2_bridge/Cargo.toml"),
             "--interpreter", sys.executable, "--out", str(wheels)], cwd=clean, env=env)
    matches = list(wheels.glob("babeldoc-0.7.1+ivoraige.3-*.whl"))
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {VERSION} wheel in {wheels}")
    wheel = matches[0]
    evidence = {"version": VERSION, "upstreamVersion": "0.7.1", "upstream": UPSTREAM,
        "revision": REVISION, "sourceBridgeVersion": 1, "rust": rust, "maturin": "1.15.0",
        "layoutFitPolicy": "fit-box-v1", "underscoreLinePolicy": "ascii-alnum-base-v1",
        "patchSha256": hashlib.sha256(patch).hexdigest(), "wheel": wheel.name,
        "wheelSha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
        "parserResourceLimits": "upstream defaults unchanged", "binaryReleaseValidated": False,
        "sourceIsolation": "fresh clone of pinned Git objects; cache worktree excluded"}
    (wheels / "build-provenance.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(wheel)


if __name__ == "__main__":
    main()
