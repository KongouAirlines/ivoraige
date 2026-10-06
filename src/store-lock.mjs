import { realpath, stat } from 'node:fs/promises'
import { dirname, basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { KernelError } from './errors.mjs'

async function canonicalStorePath(store) {
  const absolute = resolve(store)
  try { return await realpath(absolute) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    // The database need not exist yet, but its parent must exist before boot.
    return join(await realpath(dirname(absolute)), basename(absolute))
  }
}

// SQLite's BEGIN IMMEDIATE is an OS-backed, process-wide lock. A crashed process
// releases it automatically; no PID file, stale timeout, or takeover race exists.
// This sidecar is ownership coordination only. DSH owns the application database
// and all records. Never unlink the sidecar while an owner may still be running.
export async function acquireStoreLock(store) {
  const path = await canonicalStorePath(store)
  try {
    if ((await stat(path)).nlink > 1) {
      throw new KernelError('CONFLICT',
        `Store has hard-linked aliases: ${path}. Open the database through one path after removing its hard links.`,
        { store: path })
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const lockPath = `${path}.owner.sqlite`
  let db
  try {
    db = new DatabaseSync(lockPath, { timeout: 0 })
    db.exec('BEGIN IMMEDIATE')
  } catch (error) {
    try { db?.close() } catch { /* Preserve the acquisition error. */ }
    if (error.message?.includes('database is locked')) {
      throw new KernelError('CONFLICT',
        `Store is already open by another process: ${path}. Connect to its server with --url URL, or close the owner first.`,
        { store: path })
    }
    throw error
  }
  let released = false
  return {
    path,
    release() {
      if (released) return
      db.close() // Closing rolls back the open ownership transaction.
      released = true
    },
  }
}
