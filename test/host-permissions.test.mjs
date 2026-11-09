import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assertPrivateDirectory, assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from '../src/host-permissions.mjs'
import { closeWindowsAclWorker, windowsFsOperation, windowsPowerShellPath } from '../src/host-windows-acl.mjs'

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

test('concurrent private creation publishes a directory safely and creates one file only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'control')
  await Promise.all(Array.from({ length: 4 }, () => ensurePrivateDirectory(directory)))
  await assertPrivateDirectory(directory)
  const file = join(directory, 'exclusive')
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => createPrivateFile(file, String(i))))
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.code === 'EEXIST').length, 3)
  assert.equal((await readFile(file, 'utf8')).length, 1)
  await assertPrivateFile(file)
})

test('private Windows file rejects a foreign access rule', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // The ACL probe must not depend on PowerShell's Security module autoload.
  const previousModulePath = process.env.PSModulePath
  process.env.PSModulePath = join(root, 'missing-modules')
  closeWindowsAclWorker()
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
  await execFileAsync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', script])
  await assert.rejects(assertPrivateFile(file), { code: 'PRECONDITION_FAILED' })
})

test('Windows ACL helper is reusable and does not keep an idle CLI alive', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, "control'; Write-Output 'unsafe")
  await ensurePrivateDirectory(directory)
  const pending = windowsFsOperation('assertDirectory', directory)
  closeWindowsAclWorker()
  await assert.rejects(pending, /worker closed/)
  await assertPrivateDirectory(directory)
  closeWindowsAclWorker()
  const script = `import { ensurePrivateDirectory } from './src/host-permissions.mjs';
    await ensurePrivateDirectory(process.argv[1]); console.log('done');`
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script, join(root, 'child')],
    { cwd: new URL('..', import.meta.url), timeout: 15_000 })
  assert.equal(stdout.trim(), 'done')
})

test('Windows ancestor replacement rights are rejected but create-only rights are not',
  { skip: process.platform !== 'win32' }, async t => {
    for (const [right, rejected] of [['AppendData', false], ['DeleteSubdirectoriesAndFiles', true]]) {
      const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
      t.after(() => rm(root, { recursive: true, force: true }))
      const parent = join(root, 'parent')
      const leaf = join(parent, 'leaf')
      await ensurePrivateDirectory(parent)
      await ensurePrivateDirectory(leaf)
      const literal = `'${root.replaceAll("'", "''")}'`
      const script = `
$ErrorActionPreference = 'Stop'
$acl = [System.IO.Directory]::GetAccessControl(${literal})
$everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($everyone, [System.Security.AccessControl.FileSystemRights]::${right}, [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl(${literal}, $acl)
`
      await execFileAsync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', script])
      if (rejected) await assert.rejects(assertPrivateDirectory(leaf), { code: 'PRECONDITION_FAILED' })
      else await assertPrivateDirectory(leaf)
    }
  })

test('preexisting Windows administrator-owned directory is never normalized', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'preexisting')
  await mkdir(directory)
  const literal = `'${directory.replaceAll("'", "''")}'`
  const setup = `
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Output 'not-elevated'; exit }
$admin = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$acl = [System.IO.Directory]::GetAccessControl(${literal})
$acl.SetOwner($admin)
[System.IO.Directory]::SetAccessControl(${literal}, $acl)
Write-Output 'elevated'
`
  const { stdout } = await execFileAsync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', setup])
  if (stdout.trim() === 'not-elevated') { t.skip('Current token is not elevated'); return }
  assert.equal(stdout.trim(), 'elevated')
  await assert.rejects(ensurePrivateDirectory(directory), { code: 'PRECONDITION_FAILED' })
  const { stdout: owner } = await execFileAsync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command',
    `$acl = [System.IO.Directory]::GetAccessControl(${literal}); $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value`])
  assert.equal(owner.trim(), 'S-1-5-32-544')
})
