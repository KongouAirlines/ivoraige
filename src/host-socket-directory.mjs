import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rmdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { assertPrivateDirectory, ensurePrivateDirectory } from './host-permissions.mjs'

// Leave room for `host-<128-bit nonce>.sock` under the conservative Unix
// sockaddr limit. Discovery, rather than a deterministic path, locates it.
const ownedRandomDirectories = new Set()
const fits = directory => Buffer.byteLength(join(directory, `host-${'x'.repeat(22)}.sock`)) <= 100

export async function hostSocketDirectory(registryDirectory, { runtimeDirectory = process.env.XDG_RUNTIME_DIR,
  userTemporaryDirectory = tmpdir(), homeDirectory = homedir(),
  sharedTemporaryDirectory = '/tmp' } = {}) {
  const namespace = createHash('sha256').update(`${process.getuid()}:${resolve(registryDirectory)}`).digest('hex').slice(0, 20)
  const candidates = process.platform === 'darwin'
    ? [userTemporaryDirectory, join(homeDirectory, `.ivoraige-${namespace}`)]
    : [runtimeDirectory && isAbsolute(runtimeDirectory) && join(runtimeDirectory, `ivoraige-${namespace}`),
      join(homeDirectory, `.ivoraige-${namespace}`)]
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate) || !fits(candidate)) continue
    try {
      if (candidate === userTemporaryDirectory) await assertPrivateDirectory(candidate)
      else {
        if (runtimeDirectory && candidate.startsWith(`${runtimeDirectory}/`)) await assertPrivateDirectory(runtimeDirectory)
        await ensurePrivateDirectory(candidate)
      }
      return resolve(candidate)
    } catch (error) {
      // Do not chmod or reinterpret an existing, unverified directory.
      if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.code !== 'EPERM' &&
        error.code !== 'EROFS' && error.details?.reason !== 'owner-permissions-unverified') throw error
    }
  }
  // A shared temporary directory can be preoccupied at a predictable name.
  // A random, private leaf remains usable and is recorded for discovery.
  const root = await realpath(sharedTemporaryDirectory)
  const prefix = join(root, `ivoraige-${namespace}-`)
  if (!fits(`${prefix}XXXXXX`)) throw new Error('No short private socket directory is available')
  const directory = await mkdtemp(prefix)
  try { await assertPrivateDirectory(directory) }
  catch (error) { await rmdir(directory); throw error }
  ownedRandomDirectories.add(directory)
  return directory
}

// Only fresh random leaves allocated in this process belong to the transport.
// Runtime/home directories can be shared by owners and must never be removed.
export async function releaseHostSocketDirectory(directory) {
  if (!ownedRandomDirectories.has(directory)) return
  try { await rmdir(directory) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  ownedRandomDirectories.delete(directory)
}
