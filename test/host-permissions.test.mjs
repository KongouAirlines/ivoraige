import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assertPrivateDirectory, assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from '../src/host-permissions.mjs'

const execFileAsync = promisify(execFile)

test('private directory accepts a safe system-owned ancestor alias', { skip: process.platform !== 'darwin' }, async t => {
  // macOS commonly reports /var/folders/... for tmpdir while realpath expands
  // the root-owned /var -> /private/var alias.
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'control')
  await ensurePrivateDirectory(directory)
  await assertPrivateDirectory(directory)
})

test('private directory rejects a user-owned ancestor symlink', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const actual = join(root, 'actual')
  await ensurePrivateDirectory(actual)
  const alias = join(root, 'alias')
  await symlink(actual, alias)
  await assert.rejects(assertPrivateDirectory(alias), { code: 'PRECONDITION_FAILED' })
  const nested = join(actual, 'nested')
  await ensurePrivateDirectory(nested)
  await assert.rejects(assertPrivateDirectory(join(alias, 'nested')), { code: 'PRECONDITION_FAILED' })
})

test('private Windows file rejects a foreign access rule', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // The ACL probe must not depend on PowerShell's Security module autoload.
  const previousModulePath = process.env.PSModulePath
  process.env.PSModulePath = join(root, 'missing-modules')
  t.after(() => {
    if (previousModulePath === undefined) delete process.env.PSModulePath
    else process.env.PSModulePath = previousModulePath
  })
  const directory = join(root, 'control')
  await ensurePrivateDirectory(directory)
  const file = join(directory, 'secret')
  await createPrivateFile(file, 'secret')
  await assertPrivateFile(file)
  const literal = `'${file.replaceAll("'", "''")}'`
  const script = `
$ErrorActionPreference = 'Stop'
$acl = [System.IO.File]::GetAccessControl(${literal})
$everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($everyone, [System.Security.AccessControl.FileSystemRights]::ReadData, [System.Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[System.IO.File]::SetAccessControl(${literal}, $acl)
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  await assert.rejects(assertPrivateFile(file), { code: 'PRECONDITION_FAILED' })
})
