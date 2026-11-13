import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { KernelError } from './errors.mjs'
import { windowsFsOperation } from './host-windows-acl.mjs'

const denied = (cause) => new KernelError('PRECONDITION_FAILED',
  'The host control directory or file is not private to this OS user',
  { reason: 'owner-permissions-unverified' }, cause ? { cause } : {})

async function windowsAcl(path, { createFile = false, createDirectory = false, directory = false } = {}) {
  const operation = createFile ? 'createFile' : createDirectory ? 'createDirectory' :
    directory ? 'assertDirectory' : 'assertFile'
  try {
    const result = await windowsFsOperation(operation, path)
    if (result === 'EEXIST' && createFile)
      throw Object.assign(new Error('Private file already exists'), { code: 'EEXIST' })
    if (result !== 'ok') throw new Error('Windows ACL worker returned an unexpected result')
  } catch (error) {
    if (error.code === 'EEXIST') throw error
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
