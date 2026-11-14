// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.
// Windows filesystem protection is performed by one owned PowerShell process
// per Node process. The command is fixed; paths arrive only as JSON data.
import { spawn } from 'node:child_process'
import { win32 as windowsPath } from 'node:path'

const MAX_PENDING = 64
const MAX_FRAME = 64 * 1024
const OP_TIMEOUT_MS = 15_000

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[void][System.Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
$json = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
$json.MaxJsonLength = 65536
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
# Windows volume roots may be owned by the built-in servicing principal. It is
# trusted only on ancestors, never as owner or an ACE on a private leaf.
$trustedInstaller = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')

function Assert-Ancestors($path) {
  $ancestor = [System.IO.Path]::GetDirectoryName($path)
  $immediate = $true
  $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::AppendData -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  $replacementMask = [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  while ($null -ne $ancestor -and $ancestor -ne '') {
    if (([System.IO.File]::GetAttributes($ancestor) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "reparse ancestor: $ancestor" }
    $acl = [System.IO.Directory]::GetAccessControl($ancestor)
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $sid.Value -and $owner -ne $system.Value -and $owner -ne $administrators.Value -and $owner -ne $trustedInstaller.Value) { throw "untrusted ancestor owner: $ancestor ($owner)" }
    $mask = if ($immediate) { $writeMask } else { $replacementMask }
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      $id = $rule.IdentityReference.Value
      if ($id -eq $sid.Value -or $id -eq $system.Value -or $id -eq $administrators.Value -or $id -eq $trustedInstaller.Value -or $id -eq 'S-1-3-0' -or $id -eq 'S-1-3-4') { continue }
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
          ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
      $rights = [int64]$rule.FileSystemRights
      if (($rights -band [int64]$mask) -ne 0 -or ($rights -band 0x10000000) -ne 0) { throw "replaceable ancestor: $ancestor ($id, $rights)" }
    }
    $next = [System.IO.Path]::GetDirectoryName($ancestor)
    if ($next -eq $ancestor) { break }
    $ancestor = $next
    $immediate = $false
  }
}

function Assert-Acl($path, $directory) {
  $acl = if ($directory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
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
}

function Create-Directory($path) {
  Assert-Ancestors $path
  # An existing directory is returned unchanged and must pass the assertion.
  $privateAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $privateAcl.SetOwner($sid)
  $privateAcl.SetAccessRuleProtection($true, $false)
  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $ownerRule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$privateAcl.AddAccessRule($ownerRule)
  [void][System.IO.Directory]::CreateDirectory($path, $privateAcl)
  Assert-Acl $path $true
}

function Create-File($path) {
  Assert-Ancestors $path
  Assert-Acl ([System.IO.Path]::GetDirectoryName($path)) $true
  $privateAcl = [System.Security.AccessControl.FileSecurity]::new()
  $privateAcl.SetOwner($sid)
  $privateAcl.SetAccessRuleProtection($true, $false)
  $ownerRule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$privateAcl.AddAccessRule($ownerRule)
  try {
    # CreateNew applies the protected ACL before publishing the file name.
    $stream = [System.IO.FileStream]::new($path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $privateAcl)
    $stream.Dispose()
  } catch {
    if ([System.IO.File]::Exists($path)) { return 'EEXIST' }
    throw
  }
  Assert-Acl $path $false
  return 'ok'
}

function Move-Replace($source, $target) {
  Assert-Ancestors $source
  Assert-Ancestors $target
  Assert-Acl $source $false
  if (-not ('IvoraigeMoveFile' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IvoraigeMoveFile {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool MoveFileEx(string source, string target, int flags);
}
'@
  }
  # MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
  if (-not [IvoraigeMoveFile]::MoveFileEx($source, $target, 9)) {
    throw ([System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()))
  }
}

function Invoke-Operation($request) {
  $op = [string]$request['op']
  $path = [string]$request['path']
  if (-not [System.IO.Path]::IsPathRooted($path)) { throw 'invalid path' }
  switch ($op) {
    'assertDirectory' { Assert-Ancestors $path; Assert-Acl $path $true; return 'ok' }
    'createDirectory' { Create-Directory $path; return 'ok' }
    'assertFile' { Assert-Ancestors $path; Assert-Acl $path $false; return 'ok' }
    'createFile' { $result = Create-File $path; return $result }
    'moveReplace' {
      $target = [string]$request['target']
      if (-not [System.IO.Path]::IsPathRooted($target)) { throw 'invalid target' }
      Move-Replace $path $target
      return 'ok'
    }
    default { throw 'invalid operation' }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = $null
  try {
    $request = $json.DeserializeObject($line)
    $id = $request['id']
    $code = Invoke-Operation $request
    [Console]::Out.WriteLine($json.Serialize(@{ id = $id; ok = $true; code = $code }))
  } catch {
    [Console]::Out.WriteLine($json.Serialize(@{ id = $id; ok = $false; code = 'FAILED'; message = $_.Exception.Message }))
  }
}
`

export function windowsPowerShellPath() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  if (!windowsPath.isAbsolute(systemRoot)) throw new Error('Windows system root is not absolute')
  return windowsPath.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function setReferenced(state, active) {
  const action = active ? 'ref' : 'unref'
  state.child[action]()
  state.child.stdin[action]()
  state.child.stdout[action]()
  state.child.stderr[action]()
}

function createWindowsAclClient(spawnProcess, installExitHook) {
  let worker = null
  let nextId = 0
  let exitHookInstalled = false

  function retire(state, error, observedExit = false) {
    if (state.closed) return
    state.closed = true
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    state.pending.clear()
    // A failed or delayed kill does not prove the helper stopped. Keep this
    // state and its pipes referenced until exit. Otherwise the owning Node
    // process could exit and another process could race the old helper's writes.
    if (!observedExit && state.child.pid != null) {
      setReferenced(state, true)
      try { state.child.kill() }
      catch { /* The old process remains unproven dead; keep retirement pending. */ }
    }
  }

  function observedExit(state, error) {
    retire(state, error, true)
    setReferenced(state, false)
    if (worker === state) worker = null
    state.resolveExit()
  }

  function startWorker() {
    const child = spawnProcess(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let resolveExit
    const exited = new Promise(resolve => { resolveExit = resolve })
    const state = { child, pending: new Map(), buffer: '', stderr: '', closed: false, exited, resolveExit }
    worker = state
    if (installExitHook && !exitHookInstalled) {
      process.once('exit', () => worker?.child.kill())
      exitHookInstalled = true
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (state.closed) return
      state.buffer += chunk
      for (;;) {
        const end = state.buffer.indexOf('\n')
        if (end < 0) break
        if (Buffer.byteLength(state.buffer.slice(0, end), 'utf8') > MAX_FRAME) {
          retire(state, new Error('Windows ACL worker frame too large')); return
        }
        const line = state.buffer.slice(0, end).trim()
        state.buffer = state.buffer.slice(end + 1)
        let reply
        try { reply = JSON.parse(line) }
        catch { retire(state, new Error('Windows ACL worker returned invalid JSON')); return }
        const pending = state.pending.get(reply.id)
        if (!pending || typeof reply.ok !== 'boolean' || typeof reply.code !== 'string' ||
            reply.ok && reply.code !== 'ok' && !(pending.op === 'createFile' && reply.code === 'EEXIST')) {
          retire(state, new Error('Windows ACL worker returned an unexpected response')); return
        }
        state.pending.delete(reply.id)
        clearTimeout(pending.timer)
        if (reply.ok) pending.resolve(reply.code)
        else pending.reject(Object.assign(new Error(reply.message || 'Windows ACL operation failed'), { code: reply.code }))
        if (state.pending.size === 0 && !state.closed) setReferenced(state, false)
      }
      if (Buffer.byteLength(state.buffer, 'utf8') > MAX_FRAME)
        retire(state, new Error('Windows ACL worker frame too large'))
    })
    child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-4096) })
    child.on('error', error => {
      retire(state, error)
      // A spawn failure has no process to wait for and may not emit exit.
      if (child.pid == null) observedExit(state, error)
    })
    child.on('exit', (code, signal) => observedExit(state,
      new Error(`Windows ACL worker exited (${code ?? signal ?? 'unknown'}): ${state.stderr}`)))
    child.stdin.on('error', error => retire(state, error))
    setReferenced(state, false)
    return state
  }

  function close() {
    if (!worker) return Promise.resolve()
    const state = worker
    retire(state, new Error('Windows ACL worker closed'))
    return state.exited
  }

  function afterRetirement(callback) {
    // Callers holding a cross-process lock must not release it while a timed
    // out or faulted helper may still complete a filesystem mutation.
    if (!worker?.closed) { callback(); return null }
    return worker.exited.then(callback)
  }

  function operation(op, path, target) {
    if (!['assertDirectory', 'createDirectory', 'assertFile', 'createFile', 'moveReplace'].includes(op))
      return Promise.reject(new Error('Invalid Windows filesystem operation'))
    const request = JSON.stringify({ id: ++nextId, op, path, ...(target === undefined ? {} : { target }) })
    if (Buffer.byteLength(request, 'utf8') > MAX_FRAME)
      return Promise.reject(new Error('Windows ACL worker request too large'))
    if (worker?.closed) return Promise.reject(new Error('Windows ACL worker exit is pending'))
    let state
    try { state = worker ?? startWorker() }
    catch (error) { return Promise.reject(error) }
    if (state.pending.size >= MAX_PENDING) return Promise.reject(new Error('Windows ACL worker is overloaded'))
    return new Promise((resolve, reject) => {
      const id = nextId
      const timer = setTimeout(() => retire(state, new Error('Windows ACL worker timed out')), OP_TIMEOUT_MS)
      state.pending.set(id, { resolve, reject, timer, op })
      setReferenced(state, true)
      try { state.child.stdin.write(`${request}\n`) }
      catch (error) { retire(state, error) }
    })
  }

  return { operation, close, afterRetirement }
}

const defaultClient = createWindowsAclClient(spawn, true)

export const windowsFsOperation = defaultClient.operation
export const closeWindowsAclWorker = defaultClient.close
export const afterWindowsAclWorkerRetirement = defaultClient.afterRetirement

// The injected process is confined to a separate client, never the production
// singleton. Tests can model a kill that fails or exits late without Windows.
export function createWindowsAclClientForTesting(spawnProcess) {
  return createWindowsAclClient(spawnProcess, false)
}
