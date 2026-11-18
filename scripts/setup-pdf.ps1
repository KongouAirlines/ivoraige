param(
    [string]$RuntimeDir = 'evaluation/runs/pdf-runtime/.venv',
    [string]$WheelDir = 'evaluation/runs/babeldoc-runtime-0.7.1/wheels',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $repo $RuntimeDir
$python = Join-Path $runtime 'Scripts/python.exe'
$babeldoc = Join-Path $runtime 'Scripts/babeldoc.exe'
$lock = Join-Path $repo 'sidecars/babeldoc/requirements.lock'

if (-not $CheckOnly) {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required to create the pinned PDF runtime.' }
    if (-not (Test-Path -LiteralPath $python)) {
        uv venv $runtime --python 3.13
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    $wheels = Join-Path $repo $WheelDir
    if (-not (Test-Path -LiteralPath $wheels)) { throw "Build the derived BabelDOC 0.7.1+ivoraige.3 wheel first; see docs/plan/0.1.x/babeldoc-0.7.1.md" }
    uv pip install --python $python --index-url https://pypi.org/simple --find-links $wheels -r $lock
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not (Test-Path -LiteralPath $babeldoc)) { throw "BabelDOC command missing: $babeldoc" }
    & $babeldoc --warmup
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path -LiteralPath $python)) { throw "PDF runtime missing: $python" }
$versions = & $python -c 'import sys, importlib.metadata as m, babeldoc._rust_il as b, pymupdf; from PIL import Image; print(sys.version_info.major, sys.version_info.minor, m.version("BabelDOC"), b.ivoraige_source_bridge_version, b.ivoraige_layout_fit_policy, b.ivoraige_underscore_line_policy, pymupdf.VersionBind, Image.__version__)'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($versions.Trim() -ne '3 13 0.7.1+ivoraige.3 1 fit-box-v1 ascii-alnum-base-v1 1.26.7 13.0.0') { throw "Unexpected PDF runtime versions: $versions" }
Write-Output "Python 3.13 BabelDOC 0.7.1+ivoraige.3 (derived source bridge v1) PyMuPDF 1.26.7 Pillow 13.0.0"
$cache = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache/babeldoc'
$required = @(
    (Join-Path $cache 'models/doclayout_yolo_docstructbench_imgsz1024.onnx'),
    (Join-Path $cache 'fonts'),
    (Join-Path $cache 'cmap'),
    (Join-Path $cache 'tiktoken')
)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count -gt 0) { throw "PDF assets missing: $($missing -join ', ')" }
Write-Output "BabelDOC assets $cache"
Write-Output "Sidecar command: `"$python`" `"$(Join-Path $repo 'sidecars/babeldoc/server.py')`""
