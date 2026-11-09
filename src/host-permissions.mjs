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

async function windowsAcl(path, { createFile = false, createDirectory = false, directory = false } = {}) {
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
if (${createDirectory ? '$true' : '$false'}) {
  # CreateDirectory returns an existing directory without changing its ACL.
  # A concurrent caller therefore never observes an inherited ACL on a new
  # directory, and a preexisting untrusted directory is only verified below.
  $privateAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $privateAcl.SetOwner($sid)
  $privateAcl.SetAccessRuleProtection($true, $false)
  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $ownerRule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$privateAcl.AddAccessRule($ownerRule)
  [void][System.IO.Directory]::CreateDirectory($path, $privateAcl)
}
if (${createFile ? '$true' : '$false'}) {
  $privateAcl = [System.Security.AccessControl.FileSecurity]::new()
  $privateAcl.SetOwner($sid)
  $privateAcl.SetAccessRuleProtection($true, $false)
  $ownerRule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$privateAcl.AddAccessRule($ownerRule)
  try {
    # CreateNew is exclusive and applies the DACL before the name is visible.
    $stream = [System.IO.FileStream]::new($path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $privateAcl)
    $stream.Dispose()
  } catch {
    if ([System.IO.File]::Exists($path)) { [Console]::Error.WriteLine('IVORAIGE_FILE_EXISTS'); exit 17 }
    throw
  }
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
  catch (error) {
    if (createFile && error.code === 17 && error.stderr?.includes('IVORAIGE_FILE_EXISTS')) {
      throw Object.assign(new Error('Private file already exists'), { code: 'EEXIST' })
    }
    throw denied(error)
  }
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

async function privateDirectory(path, probeWindowsAcl) {
  if (process.platform === 'win32') {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw denied()
    if (probeWindowsAcl) await windowsAcl(path, { directory: true })
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

export async function assertPrivateDirectory(path) { return privateDirectory(resolve(path), true) }

export async function ensurePrivateDirectory(path) {
  path = resolve(path)
  if (process.platform === 'win32') {
    try { await lstat(path) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      await windowsAcl(path, { createDirectory: true, directory: true })
      // Creation and ACL verification were one OS operation. Recheck the
      // entry shape without launching a redundant second ACL probe.
      return privateDirectory(path, false)
    }
    return assertPrivateDirectory(path)
  }
  let created = false
  try { await lstat(path) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    try { await mkdir(path, { mode: 0o700 }); created = true }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause }
    // A concurrent creator winning mkdir is not permission evidence; the
    // common assertion below still verifies its owner, type and access.
  }
  if (created) await chmod(path, 0o700)
  return assertPrivateDirectory(path)
}

async function privateFile(path, probeWindowsAcl) {
  if (process.platform === 'win32') {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw denied()
    if (probeWindowsAcl) await windowsAcl(path)
  } else await unixCheck(path, 'file', 0o600)
  return path
}

export async function assertPrivateFile(path) { return privateFile(resolve(path), true) }

export async function createPrivateFile(path, contents) {
  path = resolve(path)
  await assertPrivateDirectory(dirname(path))
  if (process.platform === 'win32') await windowsAcl(path, { createFile: true })
  const file = await open(path, process.platform === 'win32' ? 'r+' : 'wx', 0o600)
  try {
    await file.writeFile(contents)
    await file.sync()
  } finally { await file.close() }
  if (process.platform !== 'win32') await chmod(path, 0o600)
  await privateFile(path, process.platform !== 'win32')
  return path
}
