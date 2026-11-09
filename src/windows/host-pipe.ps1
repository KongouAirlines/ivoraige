# Built-in Windows PowerShell / .NET Framework only. No downloaded executable,
# script-policy change, profile, credential argument, or TCP listener is needed.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'HostPipe.cs') -ReferencedAssemblies System,System.Core,System.Web.Extensions
  [Ivoraige.HostPipe]::Run()
} catch {
  # Never write exception text: helper traffic can contain owner credentials.
  [Console]::Error.WriteLine('Host pipe helper unavailable')
  exit 1
}
