import { realpathSync, statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

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
  // A parent identity remains stable across unlink and recognizes junctions.
  // The canonical filename recognizes case aliases on insensitive volumes.
  try {
    const parent = statSync(dirname(absolute), { bigint: true })
    let name = basename(absolute)
    try { name = basename(realpathSync.native(absolute)) }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
    const identity = parent.ino === 0n ? realpathSync.native(dirname(absolute)) : `${parent.dev}:${parent.ino}`
    return `path:${identity}:${name}`
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    return `missing-path:${absolute}`
  }
}
