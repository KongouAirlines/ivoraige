param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('setup', 'capture', 'replay')]
    [string]$Mode,
    [string]$InputPdf = 'evaluation/runs/m1-pdf-injection/original-control.pdf',
    [string]$Records = 'evaluation/runs/m1-pdf-injection/accepted.json',
    [string]$Pages,
    [int]$MinTextLength = 5,
    [string]$RunDir
)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$python = Join-Path $repo 'evaluation/runs/m3-1/.venv/Scripts/python.exe'
if ($Mode -eq 'setup') {
    $env:UV_CACHE_DIR = Join-Path $repo 'evaluation/runs/m3-1/uv-cache'
    uv venv (Join-Path $repo 'evaluation/runs/m3-1/.venv') --python 3.13
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    uv pip install --python $python -r (Join-Path $PSScriptRoot 'requirements.lock')
    exit $LASTEXITCODE
}
if (-not $RunDir) { throw 'Capture and replay require -RunDir (a new directory under this project).' }
$arguments = @((Join-Path $PSScriptRoot 'adapter.py'), $Mode, '--input', $InputPdf, '--run-dir', $RunDir)
if ($Pages) { $arguments += @('--pages', $Pages) }
$arguments += @('--min-text-length', [string]$MinTextLength)
if ($Mode -eq 'replay') { $arguments += @('--records', $Records) }
& $python @arguments
exit $LASTEXITCODE
