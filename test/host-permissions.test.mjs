import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { assertPrivateDirectory, assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from '../src/host-permissions.mjs'
import { closeWindowsAclWorker, createWindowsAclClientForTesting, windowsFsOperation, windowsPowerShellPath } from '../src/host-windows-acl.mjs'

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
  await closeWindowsAclWorker()
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
  const closing = closeWindowsAclWorker()
  await assert.rejects(pending, /worker closed/)
  await closing
  await assertPrivateDirectory(directory)
  await closeWindowsAclWorker()
  const script = `import { ensurePrivateDirectory } from './src/host-permissions.mjs';
    await ensurePrivateDirectory(process.argv[1]); console.log('done');`
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script, join(root, 'child')],
    { cwd: new URL('..', import.meta.url), timeout: 15_000 })
  assert.equal(stdout.trim(), 'done')
})

test('Windows ancestor replacement rights are rejected but create-only rights are not',
  { skip: process.platform !== 'win32' }, async t => {
    for (const [sid, right, rejected] of [
      ['S-1-1-0', 'AppendData', false],
      ['S-1-1-0', 'DeleteSubdirectoriesAndFiles', true],
      ['S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464', 'DeleteSubdirectoriesAndFiles', false],
    ]) {
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
$principal = [System.Security.Principal.SecurityIdentifier]::new('${sid}')
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal, [System.Security.AccessControl.FileSystemRights]::${right}, [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl(${literal}, $acl)
`
      await execFileAsync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', script])
      if (rejected) await assert.rejects(assertPrivateDirectory(leaf), { code: 'PRECONDITION_FAILED' })
      else await assertPrivateDirectory(leaf)
    }
  })

test('faulted Windows ACL helper waits for observed exit before replacement', async () => {
  const children = []
  const spawnProcess = () => {
    const child = new EventEmitter()
    child.pid = 1000 + children.length
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.ref = () => { child.refs++; child.referenced = true }
    child.unref = () => { child.unrefs++; child.referenced = false }
    child.refs = 0
    child.unrefs = 0
    child.kills = 0
    child.kill = () => { child.kills++; return false }
    for (const pipe of [child.stdin, child.stdout, child.stderr]) {
      pipe.ref = () => {}
      pipe.unref = () => {}
    }
    child.requests = []
    child.stdin.on('data', data => child.requests.push(JSON.parse(data.toString())))
    children.push(child)
    return child
  }
  const client = createWindowsAclClientForTesting(spawnProcess)
  const pending = client.operation('moveReplace', 'C:\\source', 'C:\\target')
  assert.equal(children.length, 1)
  assert.equal(children[0].requests[0].op, 'moveReplace')
  children[0].stdout.write('not json\n')
  await assert.rejects(pending, /invalid JSON/)
  const closing = client.close()
  assert.equal(children[0].kills, 1)
  assert.equal(children[0].referenced, true)
  let released = false
  const deferredRelease = client.afterRetirement(() => { released = true })
  assert.equal(released, false)
  assert.ok(deferredRelease instanceof Promise)
  await assert.rejects(client.operation('createFile', 'C:\\other'), /exit is pending/)
  assert.equal(children.length, 1)
  // A late success reply cannot certify that the old helper has stopped.
  children[0].stdout.write(`${JSON.stringify({ id: children[0].requests[0].id, ok: true, code: 'ok' })}\n`)
  await assert.rejects(client.operation('assertFile', 'C:\\other'), /exit is pending/)
  assert.equal(children.length, 1)
  assert.equal(released, false)
  children[0].emit('exit', null, 'SIGTERM')
  await closing
  await deferredRelease
  assert.equal(released, true)
  assert.equal(children[0].referenced, false)
  const recovered = client.operation('assertFile', 'C:\\other')
  assert.equal(children.length, 2)
  assert.equal(children[1].requests[0].op, 'assertFile')
  children[1].stdout.write(`${JSON.stringify({ id: children[1].requests[0].id, ok: true, code: 'ok' })}\n`)
  assert.equal(await recovered, 'ok')
  assert.ok(children[1].refs > 0 && children[1].unrefs > 0)
  const done = client.close()
  children[1].emit('exit', null, 'SIGTERM')
  await done
})

test('Windows ACL helper can restart after a spawn error with no child process', async () => {
  let starts = 0
  const client = createWindowsAclClientForTesting(() => {
    starts++
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.ref = () => {}
    child.unref = () => {}
    child.kill = () => { throw new Error('no process') }
    for (const pipe of [child.stdin, child.stdout, child.stderr]) {
      pipe.ref = () => {}
      pipe.unref = () => {}
    }
    queueMicrotask(() => child.emit('error', new Error('ENOENT')))
    return child
  })
  await assert.rejects(client.operation('assertFile', 'C:\\file'), /ENOENT/)
  await assert.rejects(client.operation('assertFile', 'C:\\file'), /ENOENT/)
  assert.equal(starts, 2)
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
