param(
    [string]$RuntimeDir = 'evaluation/runs/pdf-build-runtime-0.1.0/.venv',
    [string]$PyInstallerVersion = '6.22.3'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runs = [System.IO.Path]::GetFullPath((Join-Path $repo 'evaluation/runs'))
$runtime = [System.IO.Path]::GetFullPath((Join-Path $repo $RuntimeDir))
if (-not $runtime.StartsWith($runs + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing Python build runtime outside evaluation/runs: $runtime"
}
$python = Join-Path $runtime 'Scripts/python.exe'
$lock = Join-Path $repo 'sidecars/babeldoc/requirements.lock'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required to create the pinned PDF build runtime.' }
if (-not (Test-Path -LiteralPath $python)) {
    uv venv $runtime --python 3.13
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
uv pip install --python $python -r $lock "pyinstaller==$PyInstallerVersion"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python (Join-Path $PSScriptRoot 'build-pdf-component.py') --python $python
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
