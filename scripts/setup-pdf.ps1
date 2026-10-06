param(
    [string]$RuntimeDir = 'evaluation/runs/pdf-runtime/.venv',
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
    uv pip install --python $python -r $lock
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not (Test-Path -LiteralPath $babeldoc)) { throw "BabelDOC command missing: $babeldoc" }
    & $babeldoc --warmup
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path -LiteralPath $python)) { throw "PDF runtime missing: $python" }
$versions = & $python -c 'import sys, babeldoc.const as b, pymupdf; print(sys.version_info.major, sys.version_info.minor, b.__version__, pymupdf.VersionBind)'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($versions.Trim() -ne '3 13 0.6.4 1.26.7') { throw "Unexpected PDF runtime versions: $versions" }
Write-Output "Python 3.13 BabelDOC 0.6.4 PyMuPDF 1.26.7"
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
