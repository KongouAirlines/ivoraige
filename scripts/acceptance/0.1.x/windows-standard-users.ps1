# Opt-in only. Do not add to normal CI or rerun after provisioning/failure.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$ExpectedCommit,
    [Parameter(Mandatory = $true)][string]$ProductCommit,
    [Parameter(Mandatory = $true)][string]$ExpectedRef,
    [switch]$ProvisionStandardAccounts
)
$ErrorActionPreference = 'Stop'
$stage = 'source-validation'
try {
    if ($ExpectedCommit -notmatch '^[0-9a-f]{40}$' -or $ProductCommit -notmatch '^[0-9a-f]{40}$') { throw 'Exact commits are required' }
    if ($ExpectedRef -notmatch '^refs/heads/acceptance/0[.]1[.]x-windows-users-[a-z0-9-]+$' -or $env:GITHUB_REF -cne $ExpectedRef) { throw 'Unexpected one-time branch' }
    $event = [System.IO.File]::ReadAllText($env:GITHUB_EVENT_PATH) | ConvertFrom-Json
    if ($env:GITHUB_EVENT_NAME -cne 'push' -or $event.created -ne $true -or $event.before -cne '0000000000000000000000000000000000000000' -or $event.after -cne $env:GITHUB_SHA -or $ExpectedCommit -cne $env:GITHUB_SHA -or $event.ref -cne $ExpectedRef -or $event.deleted) { throw 'Not the single approved branch-creation push' }
    if ($env:IVORAIGE_ACCOUNT_ACCEPTANCE -cne 'approved-two-users-one-run') { throw 'One-time gate absent' }
    $head = (& git -C $SourceRoot rev-parse --verify HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $head -cne $ExpectedCommit) { throw 'Unexpected checkout' }
    & git -C $SourceRoot diff --quiet $ProductCommit -- src/host-windows-pipe.mjs src/windows/HostPipe.cs src/errors.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Transport differs from the approved integrated product commit' }
    $nodeVersion = (& $NodePath -p 'process.versions.node').Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -cne '26.13.0') { throw 'Unexpected Node runtime' }
    & $NodePath --check ([System.IO.Path]::Combine($SourceRoot, 'scripts\acceptance\0.1.x\windows-standard-users-actor.mjs'))
    if ($LASTEXITCODE -ne 0) { throw 'Actor syntax failed' }
    $files = @('scripts\acceptance\0.1.x\windows-standard-users-probe.cs',
        'scripts\acceptance\0.1.x\windows-standard-users-runner.cs', 'src\windows\HostPipe.cs')
    $sources = @($files | ForEach-Object { [System.IO.Path]::Combine($SourceRoot, $_) })
    # Compile the runner, diagnostics and actual native helper before any account
    # exists. No execution-policy override, privilege enabling or service start.
    $stage = 'native-compilation'
    Add-Type -LiteralPath $sources -ReferencedAssemblies System,System.Core,System.Web.Extensions,System.ServiceProcess
    $stage = 'native-preflight'
    [StandardAccountAcceptance]::Preflight($SourceRoot, $NodePath)
    $hashes = @{}
    foreach ($relative in @('src\host-windows-pipe.mjs', 'src\errors.mjs', 'src\windows\HostPipe.cs',
        'scripts\acceptance\0.1.x\windows-standard-users-probe.cs', 'scripts\acceptance\0.1.x\windows-standard-users-runner.cs',
        'scripts\acceptance\0.1.x\windows-standard-users-actor.mjs', 'scripts\acceptance\0.1.x\windows-standard-users.ps1')) {
        $stream = [System.IO.File]::OpenRead([System.IO.Path]::Combine($SourceRoot, $relative))
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $hashes[$relative.Replace('\', '/')] = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $sha.Dispose() }
    }
    $json = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
    [Console]::WriteLine($json.Serialize(@{ stage = 'preflight-passed'; sourceCommit = $ExpectedCommit; productCommit = $ProductCommit;
        triggerCommit = $env:GITHUB_SHA; nodeVersion = $nodeVersion; powershellVersion = $PSVersionTable.PSVersion.ToString(); sourceHashes = $hashes }))
    if (-not $ProvisionStandardAccounts) { exit 0 }
    $result = [StandardAccountAcceptance]::Run($SourceRoot, $NodePath, $ExpectedCommit)
    exit $result
} catch {
    # Compilation precedes credential generation/account creation. Its source-
    # only diagnostics are safe and necessary; later failures stay sanitized.
    if ($stage -eq 'native-compilation') { [Console]::Error.WriteLine($_.ToString()) }
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    $code = if ($cause -is [System.ComponentModel.Win32Exception]) { $cause.NativeErrorCode } else { 0 }
    if ($stage -eq 'native-preflight') { $stage = [StandardAccountAcceptance]::CurrentStage }
    [Console]::Error.WriteLine('Acceptance preflight failed: stage={0}; type={1}; win32Error={2}; no automatic retry', $stage, $cause.GetType().Name, $code)
    exit 1
}
