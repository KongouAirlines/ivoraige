import { lstatSync, realpathSync, statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { KernelError } from './errors.mjs'

export async function sameDirectory(left, right) {
  if (!right) return false
  const a = await stat(resolve(left), { bigint: true }).catch(() => undefined)
  const b = await stat(resolve(right), { bigint: true }).catch(() => undefined)
  if (!a?.isDirectory() || !b?.isDirectory()) return false
  if (a.ino !== 0n && b.ino !== 0n) return a.dev === b.dev && a.ino === b.ino
  const canonicalLeft = await realpath(left).catch(() => undefined)
  const canonicalRight = await realpath(right).catch(() => undefined)
  return canonicalLeft !== undefined && canonicalLeft === canonicalRight
}

export function managedPathKey(path) {
  const absolute = resolve(path)
  // Resolve the entire existing path before identifying its parent. A file
  // symlink may live in a different directory from the file it references.
  let target = absolute
  try { target = realpathSync.native(absolute) }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    // A dangling symlink has no provable target identity; never let it
    // participate in a physical deletion or adoption as another file.
    try { if (lstatSync(absolute).isSymbolicLink())
      throw new KernelError('PRECONDITION_FAILED', 'Dangling artifact symlink has no file identity', { path }) }
    catch (linkError) { if (!['ENOENT', 'ENOTDIR'].includes(linkError.code)) throw linkError }
  }
  // A parent identity remains stable across unlink and recognizes junctions.
  // The canonical filename recognizes case aliases on insensitive volumes.
  try {
    const parent = statSync(dirname(target), { bigint: true })
    const name = basename(target)
    const identity = parent.ino === 0n ? realpathSync.native(dirname(target)) : `${parent.dev}:${parent.ino}`
    return `path:${identity}:${name}`
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    return `missing-path:${absolute}`
  }
}
