// A stopped-host lease, shared by AppBoot and offline package recovery.
import { mkdir, cp, readFile, rm, rename, lstat, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { KernelError } from './errors.mjs'
import { join, resolve } from 'node:path'
import { acquireStoreLock } from './store-lock.mjs'
import { writeFileAtomic, awaitTreeGone, treeAlive } from '../dist/dsh.mjs'

const leases = new WeakSet()
function profileConflict(directory, cause) {
  return new KernelError('CONFLICT', `Settings profile is in use: ${directory}. Stop hosts using these settings before changing installed plugins.`, { directory }, { cause })
}
function usersLock(directory, mode) {
  let db
  try {
    db = new DatabaseSync(join(directory, '.plugin-users.sqlite'), { timeout: 0 })
    // DELETE journaling is required: WAL readers do not exclude a writer.
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete')
      throw new Error('Profile coordination requires SQLite DELETE journal mode')
    db.exec(mode === 'write' ? 'BEGIN EXCLUSIVE' : 'BEGIN')
    if (mode === 'read') db.prepare('SELECT count(*) FROM sqlite_schema').get()
  } catch (error) {
    try { db?.close() } catch {}
    if ([5, 6].includes(error.errcode & 0xff)) throw profileConflict(directory, error)
    throw error
  }
  return { release() { if (db) { db.close(); db = undefined } } }
}
async function gate(directory) {
  try { return await acquireStoreLock(join(directory, '.plugin-profile')) }
  catch (error) { if (error.code === 'CONFLICT') throw profileConflict(directory, error); throw error }
}
// Serialize preparation/recovery under the old writer gate, then retain only
// a shared SQLite read transaction for the host lifetime. Never unlink locks.
export async function acquireHostProfile(directory, prepare) {
  directory = resolve(directory)
  await mkdir(directory, { recursive: true })
  directory = await realpath(directory)
  const lock = await gate(directory)
  let users, probe
  try {
    let writable = true
    try { users = usersLock(directory, 'write') }
    catch (error) { if (error.code !== 'CONFLICT') throw error; writable = false; users = usersLock(directory, 'read') }
    if (writable) {
      probe = await acquireProbe(directory)
      await recoverProfile(directory)
      await prepare(directory)
      users.release()
      users = usersLock(directory, 'read')
    } else {
      // A prepared live host guarantees initialization is complete. Never
      // perform package recovery or profile scaffolding under shared access.
      if (await exists(join(directory, '.plugin-transaction')) || await exists(join(directory, '.plugin-manager', 'run.json')))
        throw profileConflict(directory)
    }
    const lease = { directory, release() { leases.delete(lease); users?.release(); users = undefined } }
    return lease
  } catch (error) { users?.release(); throw error }
  finally { probe?.release(); lock.release() }
}
export async function acquireProfile(directory) {
  directory = resolve(directory)
  await mkdir(directory, { recursive: true })
  directory = await realpath(directory)
  const lock = await gate(directory)
  let probe, users
  try { users = usersLock(directory, 'write'); probe = await acquireProbe(directory) }
  catch (error) { users?.release(); lock.release(); throw error }
  const lease = { directory,
    releaseProbe() { probe?.release(); probe = undefined },
    async reacquireProbe() { probe ??= await acquireProbe(directory) },
    release() { leases.delete(lease); probe?.release(); users.release(); lock.release() },
  }
  leases.add(lease)
  return lease
}
export function acquireProbe(directory) { return acquireStoreLock(join(directory, '.plugin-validation')) }
export function ownsProfile(lease, directory) {
  if (!leases.has(lease)) return false
  // Match fs.promises.realpath: both use the native resolver. On Windows the
  // JavaScript resolver can retain an 8.3 alias that the native API expands.
  try { return lease.directory === realpathSync.native(resolve(directory)) }
  catch { return false }
}
async function configBaseline(directory) {
  const state = {}
  for (const name of ['cordis.patch.yml', '.plugin-config.json'])
    state[name] = await readFile(join(directory, name), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
  return JSON.stringify(state)
}
const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', '.plugin-config.json', 'node_modules']
const journal = directory => join(directory, '.plugin-transaction')
async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
// Backups are immutable until commit. Recovery may itself be interrupted and
// safely repeated; the profile lease excludes readers during directory restore.
export async function recoverProfile(directory) {
  const run = join(directory, '.plugin-manager', 'run.json')
  if (await exists(run)) {
    const tree = JSON.parse(await readFile(run, 'utf8'))
    if (!Number.isSafeInteger(tree.pid) || tree.pid < 1 || typeof tree.grouped !== 'boolean')
      throw new Error('Invalid DSH package run record; inspect it before recovery')
    await awaitTreeGone(tree)
    if (treeAlive(tree)) throw new Error('A DSH package process is still writing this profile; stop it before recovery')
    await rm(run)
  }
  // A commit interrupted between its two renames has not replaced the old
  // rollback point. Preserve it before restoring the uncommitted package set.
  const previous = join(directory, '.plugin-previous')
  const obsolete = join(directory, '.plugin-obsolete')
  if (!await exists(previous) && await exists(join(obsolete, 'ready')))
    await rename(obsolete, previous)
  const backup = journal(directory)
  if (!await exists(join(backup, 'ready'))) {
    await rm(backup, { recursive: true, force: true })
    return false
  }
  const saved = JSON.parse(await readFile(join(backup, 'ready'), 'utf8'))
  if (!Array.isArray(saved) || saved.some(name => !files.includes(name))) throw new Error('Invalid plugin recovery journal')
  for (const name of files) {
    await rm(join(directory, name), { recursive: true, force: true })
    if (saved.includes(name)) await cp(join(backup, name), join(directory, name), { recursive: true, verbatimSymlinks: true })
  }
  const recovered = join(directory, '.plugin-recovered')
  await rm(recovered, { recursive: true, force: true })
  await rename(backup, recovered) // Never replay a half-deleted backup after a crash.
  await rm(recovered, { recursive: true, force: true }).catch(() => {})
  return true
}
export async function snapshotProfile(directory) {
  const backup = journal(directory)
  await mkdir(backup)
  const saved = []
  for (const name of files) if (await exists(join(directory, name))) {
    await cp(join(directory, name), join(backup, name), { recursive: true, verbatimSymlinks: true })
    saved.push(name)
  }
  await writeFileAtomic(join(backup, 'ready'), JSON.stringify(saved), { mode: 0o600 })
}
export async function commitProfile(directory) {
  // The rename is the commit point. A crash before it restores the old complete
  // package set; a crash after it retains the new complete set.
  const previous = join(directory, '.plugin-previous')
  const obsolete = join(directory, '.plugin-obsolete')
  await rm(obsolete, { recursive: true, force: true })
  if (await exists(previous)) await rename(previous, obsolete)
  await writeFileAtomic(join(journal(directory), 'post-config'), await configBaseline(directory), { mode: 0o600 })
  await rename(journal(directory), previous)
  // Cleanup is outside the transaction's commit point. Leave harmless obsolete
  // bytes for a later cleanup if removal fails; do not report committed work as failed.
  await rm(obsolete, { recursive: true, force: true }).catch(() => {})
}
export async function rollbackProfile(directory, { allowConfigOverwrite = false } = {}) {
  const previous = join(directory, '.plugin-previous')
  if (!await exists(join(previous, 'ready'))) throw new Error('No previous complete plugin package set')
  let committedConfig
  try { committedConfig = await readFile(join(previous, 'post-config'), 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const currentConfig = await configBaseline(directory)
  if (!allowConfigOverwrite && (committedConfig === undefined || committedConfig !== currentConfig))
    throw new KernelError('PRECONDITION_FAILED', 'Profile configuration changed since the plugin operation (or has no recorded baseline). Back it up and explicitly set allowConfigOverwrite to roll back.')
  // Obsolete cleanup may have been interrupted after a completed commit. It
  // is not an interrupted-commit rollback point when explicitly consuming previous.
  await rm(join(directory, '.plugin-obsolete'), { recursive: true, force: true })
  await rename(previous, journal(directory))
  await recoverProfile(directory)
}
