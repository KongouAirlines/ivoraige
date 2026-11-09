import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { KernelError } from './errors.mjs'

const execFileAsync = promisify(execFile)
const denied = (cause) => new KernelError('PRECONDITION_FAILED',
  'The host control directory or file is not private to this OS user',
  { reason: 'owner-permissions-unverified' }, cause ? { cause } : {})

function quotePowerShell(value) { return `'${value.replaceAll("'", "''")}'` }

async function windowsAcl(path, { initialize = false, directory = false } = {}) {
  // Node's mode bits do not express Windows DACLs. Use .NET Framework's
  // filesystem ACL API directly: Get-Acl/Set-Acl depend on a PowerShell
  // module that may not load when the runner's PSModulePath points at pwsh.
  // Refuse to proceed if the ACL probe cannot establish access.
  const script = `
$ErrorActionPreference = 'Stop'
$path = ${quotePowerShell(path)}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
if (${directory ? '$true' : '$false'}) {
  $parentPath = [System.IO.Path]::GetDirectoryName($path)
  $parentAcl = [System.IO.Directory]::GetAccessControl($parentPath)
  $parentOwner = $parentAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($parentOwner -ne $sid.Value -and $parentOwner -ne $system.Value -and $parentOwner -ne $administrators.Value) { throw 'untrusted parent owner' }
  $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::AppendData -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $parentAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    $id = $rule.IdentityReference.Value
    if ($id -ne $sid.Value -and $id -ne $system.Value -and $id -ne $administrators.Value -and $id -ne 'S-1-3-0' -and $id -ne 'S-1-3-4' -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($rule.FileSystemRights -band $writeMask) -ne 0)) { throw 'writable parent' }
  }
}
if (${initialize ? '$true' : '$false'}) {
  $acl = if (${directory ? '$true' : '$false'}) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
  $initialOwner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($initialOwner -ne $sid.Value) {
    # An elevated token may create new objects owned by the Administrators group.
    # Only the caller-proven new-object path reaches this branch. Do not
    # normalize a preexisting object or an owner outside the current token.
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if ($initialOwner -ne $administrators.Value -or -not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'wrong owner' }
    $acl.SetOwner($sid)
  }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleAll($rule) }
  $inherit = if (${directory ? '$true' : '$false'}) { [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [System.Security.AccessControl.InheritanceFlags]::None }
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
  if (${directory ? '$true' : '$false'}) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }
}
$acl = if (${directory ? '$true' : '$false'}) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
if (-not $acl.AreAccessRulesProtected) { throw 'inherited ACL' }
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if ($owner -ne $sid.Value) { throw 'wrong owner' }
$mine = $false
foreach ($rule in $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])) {
  $id = $rule.IdentityReference.Value
  if ($id -ne $sid.Value -and $id -ne $system.Value) { throw 'foreign ACE' }
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw 'unexpected deny ACE' }
  if ($id -eq $sid.Value -and (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::ReadData) -ne 0)) { $mine = $true }
}
if (-not $mine) { throw 'owner has no access' }
`
  try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 10_000, maxBuffer: 16_384 }) }
  catch (error) { throw denied(error) }
}

async function unixAncestors(path, allowRootSymlink) {
  for (let parentPath = dirname(path);;) {
    const parent = await lstat(parentPath)
    const rootAlias = allowRootSymlink && parent.isSymbolicLink() && parent.uid === 0
    if ((!parent.isDirectory() && !rootAlias) ||
      (parent.uid !== process.getuid() && parent.uid !== 0) ||
      (!rootAlias && (parent.mode & 0o022) && !(parent.mode & 0o1000))) throw denied()
    const next = dirname(parentPath)
    if (next === parentPath) break
    parentPath = next
  }
}

async function unixCheck(path, kind, mode) {
  const info = await lstat(path)
  if ((kind === 'directory' ? !info.isDirectory() : !info.isFile()) ||
    info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== mode) throw denied()
  return info
}

export async function assertPrivateDirectory(path) {
  path = resolve(path)
  if (process.platform === 'win32') {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw denied()
    await windowsAcl(path, { directory: true })
  } else {
    await unixCheck(path, 'directory', 0o700)
    // Root-owned path aliases such as macOS /var -> /private/var are safe
    // only when both the named path and its resolved ancestry are safe.
    await unixAncestors(path, true)
  }
  const canonical = await realpath(path)
  if (process.platform !== 'win32') await unixAncestors(canonical, false)
  const expected = resolve(await realpath(dirname(path)), basename(path))
  if (process.platform === 'win32' ? canonical.toLowerCase() !== expected.toLowerCase() : canonical !== expected) throw denied()
  return path
}

export async function ensurePrivateDirectory(path) {
  path = resolve(path)
  let created = false
  try { await lstat(path) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    try { await mkdir(path, { mode: 0o700 }); created = true }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause }
    // A concurrent creator winning mkdir is not permission evidence; the
    // common assertion below still verifies its owner, type and access.
  }
  if (created) {
    if (process.platform === 'win32') {
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw denied()
      await windowsAcl(path, { initialize: true, directory: true })
    }
    else await chmod(path, 0o700)
  }
  return assertPrivateDirectory(path)
}

export async function assertPrivateFile(path) {
  path = resolve(path)
  if (process.platform === 'win32') {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw denied()
    await windowsAcl(path)
  } else await unixCheck(path, 'file', 0o600)
  return path
}

export async function createPrivateFile(path, contents) {
  path = resolve(path)
  await assertPrivateDirectory(dirname(path))
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(contents)
    await file.sync()
  } finally { await file.close() }
  if (process.platform === 'win32') {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw denied()
    await windowsAcl(path, { initialize: true })
  }
  else await chmod(path, 0o600)
  await assertPrivateFile(path)
  return path
}
