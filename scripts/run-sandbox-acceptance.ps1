# Run inside Windows Sandbox with C:\Input mapped read-only and C:\Results mapped writable.
# Copy this script and smoke-distribution.mjs beside one distribution ZIP and the
# local PDF component manifest/archives, then use the LogonCommand below:
# powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Input\run-sandbox-acceptance.ps1
param(
  [string]$InputDirectory = 'C:\Input',
  [string]$ResultsDirectory = 'C:\Results'
)

$ErrorActionPreference = 'Stop'
$packageDirectory = 'C:\Package'
$workDirectory = 'C:\Acceptance'
$report = [ordered]@{
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  finishedAt = $null
  passed = $false
  stage = 'starting'
  failedAtStage = $null
  packageArchive = $null
  smokeExitCode = $null
  evidencePassed = $null
  checks = @()
  error = $null
}

function Save-Report {
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'report.json') -Encoding UTF8
}

function Set-Stage([string]$Name) {
  $report.stage = $Name
  Save-Report
}

try {
  New-Item -ItemType Directory -Path $ResultsDirectory -Force | Out-Null
  Save-Report
  $os = $null
  $osQueryError = $null
  try { $os = Get-CimInstance Win32_OperatingSystem }
  catch { $osQueryError = $_.Exception.Message }
  [ordered]@{
    os = if ($os) { $os.Caption } else { $null }
    version = if ($os) { $os.Version } else { $null }
    build = if ($os) { $os.BuildNumber } else { $null }
    osQueryError = $osQueryError
    powershell = $PSVersionTable.PSVersion.ToString()
    preinstalledTools = @(Get-Command node, python, git -ErrorAction SilentlyContinue |
      Select-Object Name, Source)
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'environment.json') -Encoding UTF8

  Set-Stage 'locating-package'
  $archives = @(Get-ChildItem -LiteralPath $InputDirectory -Filter 'ivoraige-*-win32-x64.zip' -File)
  if ($archives.Count -ne 1) { throw "Expected one distribution ZIP in $InputDirectory; found $($archives.Count)" }
  $archive = $archives[0]
  $report.packageArchive = $archive.Name
  $smoke = Join-Path $InputDirectory 'smoke-distribution.mjs'
  $manifest = Join-Path $InputDirectory 'components-manifest.json'
  $fixture = Join-Path $InputDirectory 'fixture.pdf'
  if (!(Test-Path -LiteralPath $smoke -PathType Leaf)) { throw "Missing $smoke" }
  if (!(Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Missing $manifest" }
  if (Test-Path -LiteralPath $packageDirectory) { throw "Package directory must be fresh: $packageDirectory" }
  if (Test-Path -LiteralPath $workDirectory) { throw "Work directory must be fresh: $workDirectory" }

  Set-Stage 'extracting-package'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archive.FullName, $packageDirectory)
  $runtime = Join-Path $packageDirectory 'runtime\node.exe'
  if (!(Test-Path -LiteralPath $runtime -PathType Leaf)) { throw "Bundled runtime is missing: $runtime" }

  Set-Stage 'running-smoke'
  $stdout = Join-Path $ResultsDirectory 'smoke.stdout.log'
  $stderr = Join-Path $ResultsDirectory 'smoke.stderr.log'
  $smokeArguments = @($smoke, $packageDirectory, $workDirectory, $manifest)
  if (Test-Path -LiteralPath $fixture -PathType Leaf) { $smokeArguments += $fixture }
  $process = Start-Process -FilePath $runtime -ArgumentList $smokeArguments `
    -WorkingDirectory $packageDirectory -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $report.smokeExitCode = $process.ExitCode
  Set-Stage 'collecting-evidence'
}
catch {
  $report.failedAtStage = $report.stage
  $report.error = $_.Exception.Message
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'failure.txt') -Encoding UTF8
}
finally {
  $downloads = Join-Path $workDirectory 'downloads'
  if (Test-Path -LiteralPath $downloads -PathType Container) {
    try { Copy-Item -LiteralPath $downloads -Destination $ResultsDirectory -Recurse -Force }
    catch { $report.error = "Could not collect downloads: $($_.Exception.Message)" }
  }
  $evidencePath = Join-Path $workDirectory 'evidence.json'
  if (Test-Path -LiteralPath $evidencePath -PathType Leaf) {
    try {
      Copy-Item -LiteralPath $evidencePath -Destination (Join-Path $ResultsDirectory 'evidence.json') -Force
      $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
      $report.evidencePassed = [bool]$evidence.passed
      $report.checks = @($evidence.checks | ForEach-Object { $_.name })
      if (!$evidence.passed -and !$report.error) { $report.error = $evidence.error.message }
    }
    catch {
      $report.error = "Could not collect evidence: $($_.Exception.Message)"
    }
  }
  elseif ($null -ne $report.smokeExitCode) {
    $report.error = 'Smoke process did not write evidence.json; inspect smoke stdout and stderr logs'
  }
  if ($null -eq $report.smokeExitCode) { $report.smokeExitCode = -1 }
  if ($report.smokeExitCode -ne 0 -and !$report.failedAtStage) { $report.failedAtStage = 'running-smoke' }
  $report.passed = ($report.smokeExitCode -eq 0 -and $report.evidencePassed -eq $true -and !$report.error)
  $report.stage = 'finished'
  $report.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $report.smokeExitCode | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'exit-code.txt') -Encoding UTF8
  Save-Report
}

if (!$report.passed) { exit 1 }
