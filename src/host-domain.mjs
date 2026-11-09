// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.
// The registry is per OS user. The DSH domain is the authority for a store's
// identity; the registry binds that identity to this machine's canonical path.
import './runtime.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { backup, DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Storage, StorageDomain, StorageSqlite, z } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { acquireStoreLock, canonicalStorePath } from './store-lock.mjs'
import { assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from './host-permissions.mjs'
import { windowsFsOperation } from './host-windows-acl.mjs'

const spec = StorageDomain.defineDomain({ name: 'ivoraige_host', version: 1, layout: 'per-record',
  tables: { identity: StorageDomain.domainTable(z.object({ domainId: z.string().uuid(),
    registrationId: z.string().uuid(), bindingVersion: z.literal(1) }).strict()) } })
const key = 'store'
const REGISTRY = 'domains.json'
const INTENT = 'domain-intent.json'
const LOCK = 'domains.owner.sqlite'
// If DSH disposal cannot be confirmed, retaining the lease is safer than
// permitting another owner to open a store with a possible live writer.
const unconfirmedLeases = new Set()
const fail = (code, reason, details = {}) => new KernelError(code, reason, { reason, ...details })
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const uuid = () => randomUUID()
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function defaultHostRegistryRoot() {
  if (process.env.IVORAIGE_HOST_REGISTRY_ROOT) {
    if (!isAbsolute(process.env.IVORAIGE_HOST_REGISTRY_ROOT)) throw fail('INVALID_ARGUMENT', 'invalid-registry-root')
    return process.env.IVORAIGE_HOST_REGISTRY_ROOT
  }
  if (process.platform === 'win32') {
    if (!process.env.LOCALAPPDATA) throw fail('PRECONDITION_FAILED', 'registry-unavailable')
    return process.env.LOCALAPPDATA
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'linux') return process.env.XDG_STATE_HOME && isAbsolute(process.env.XDG_STATE_HOME) ?
    process.env.XDG_STATE_HOME : join(homedir(), '.local', 'state')
  throw fail('PRECONDITION_FAILED', 'registry-unavailable')
}

export function hostRegistryDirectory(registryRoot = defaultHostRegistryRoot()) {
  if (typeof registryRoot !== 'string' || !isAbsolute(registryRoot)) throw fail('INVALID_ARGUMENT', 'invalid-registry-root')
  return join(resolve(registryRoot), 'ivoraige-host')
}

async function secureDirectory(registryRoot, create) {
  const dir = hostRegistryDirectory(registryRoot)
  if (create) {
    await mkdir(dirname(dir), { recursive: true, mode: 0o700 })
    await ensurePrivateDirectory(dir)
  }
  else {
    let entry
    try { entry = await lstat(dir) } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw fail('PRECONDITION_FAILED', 'registry-unavailable')
    await ensurePrivateDirectory(dir)
  }
  return dir
}

async function privateRead(path) {
  try {
    await assertPrivateFile(path)
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function validIdentity(value) {
  return isObject(value) && value.platform === process.platform &&
    typeof value.dev === 'string' && typeof value.ino === 'string' &&
    (value.birthtimeNs === undefined || typeof value.birthtimeNs === 'string' && /^\d+$/.test(value.birthtimeNs))
}
function sameIdentity(saved, current) {
  return !!saved && !!current && saved.platform === current.platform && saved.dev === current.dev &&
    saved.ino === current.ino && (saved.birthtimeNs === undefined ||
      current.birthtimeNs !== undefined && saved.birthtimeNs === current.birthtimeNs)
}
function sameRecord(a, b) {
  return !!a && !!b && same({ ...a, fileIdentity: null }, { ...b, fileIdentity: null }) &&
    (a.fileIdentity === null && b.fileIdentity === null || sameIdentity(a.fileIdentity, b.fileIdentity))
}
function validRecord(value, allowMissingIdentity = false) {
  return isObject(value) && /^[0-9a-f-]{36}$/i.test(value.domainId) && /^[0-9a-f-]{36}$/i.test(value.registrationId) &&
    typeof value.canonicalStore === 'string' && (validIdentity(value.fileIdentity) || allowMissingIdentity && value.fileIdentity === null) &&
    /^[a-f0-9]{64}$/.test(value.ownerConfigBinding) && value.status === 'completed'
}
function parseRegistry(raw) {
  if (raw === null) return { schemaVersion: 1, domains: [] }
  let value
  try { value = JSON.parse(raw) } catch { throw fail('PRECONDITION_FAILED', 'registry-corrupt') }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.domains) ||
      value.domains.some(record => !validRecord(record)) ||
      new Set(value.domains.map(record => record.domainId)).size !== value.domains.length ||
      new Set(value.domains.map(record => record.canonicalStore)).size !== value.domains.length) {
    throw fail('PRECONDITION_FAILED', Number.isInteger(value?.schemaVersion) && value.schemaVersion !== 1 ?
      'domain-schema-unsupported' : 'registry-corrupt')
  }
  return value
}
async function readRegistry(dir) { return parseRegistry(dir ? await privateRead(join(dir, REGISTRY)) : null) }
async function readIntent(dir) {
  const raw = dir ? await privateRead(join(dir, INTENT)) : null
  if (raw === null) return null
  let value
  try { value = JSON.parse(raw) } catch { throw fail('PRECONDITION_FAILED', 'registry-corrupt') }
  if (!isObject(value) || value.version !== 1 || !['initialize', 'migrate', 'copy', 'repair-registration'].includes(value.mode) ||
      !/^[0-9a-f-]{36}$/i.test(value.transactionId) || !validRecord(value.record, true) ||
      !/^[a-f0-9]{64}$/.test(value.beforeRevision) ||
      !(value.source === null || validRecord(value.source))) throw fail('PRECONDITION_FAILED', 'registry-corrupt')
  return value
}
function registryRevision(registry) { return hash(registry) }
async function durableReplace(dir, name, value) {
  const target = join(dir, name)
  const tmp = join(dir, `.${name}.${uuid()}.tmp`)
  try {
    await createPrivateFile(tmp, `${JSON.stringify(value)}\n`)
    if (process.platform === 'win32') {
      // Node does not expose a directory fsync on Windows. Use the OS's
      // write-through replacement primitive, and fail closed if it is absent.
      try { await windowsFsOperation('moveReplace', tmp, target) }
      catch { throw fail('PRECONDITION_FAILED', 'registry-unavailable') }
    } else await rename(tmp, target)
    await assertPrivateFile(target)
    if (process.platform !== 'win32') {
      const folder = await open(dir, constants.O_RDONLY)
      try { await folder.sync() } finally { await folder.close() }
    }
  } finally { await rm(tmp, { force: true }).catch(() => {}) }
}
async function durableRemove(dir, name) {
  await rm(join(dir, name), { force: true })
  if (process.platform !== 'win32') {
    const folder = await open(dir, constants.O_RDONLY)
    try { await folder.sync() } finally { await folder.close() }
  }
}
async function acquireRegistryLock(dir) {
  const path = join(dir, LOCK)
  let created = false
  try {
    await createPrivateFile(path, '')
    created = true
  } catch (error) { if (error.code !== 'EEXIST') throw error }
  if (!created) await assertPrivateFile(path)
  let db
  try {
    db = new DatabaseSync(path, { timeout: 0 })
  } catch (error) {
    try { db?.close() } catch { /* Preserve error. */ }
    throw error
  }
  return db
}
async function acquireRegistryLockBounded(dir) {
  // Prove the file private once. Retrying creation and ACL checks on each
  // SQLite busy result spawns many PowerShell processes under contention.
  const db = await acquireRegistryLock(dir)
  const end = performance.now() + 20_000
  try {
    for (;;) {
      try { db.exec('BEGIN IMMEDIATE'); break }
      catch (error) {
        const busy = (error.errcode & 0xff) === 5 || (error.errcode & 0xff) === 6 ||
          /database is locked/.test(error.message ?? '')
        if (!busy) throw error
        if (performance.now() >= end) throw fail('CONFLICT', 'registry-busy')
        await delay(50)
      }
    }
  } catch (error) { db.close(); throw error }
  let released = false
  return { release() { if (!released) { db.close(); released = true } } }
}
async function fileIdentity(path) {
  try {
    const s = await stat(path, { bigint: true })
    if (!s.isFile() || s.nlink !== 1n || s.ino === 0n) throw fail('CONFLICT', 'domain-registration-mismatch')
    return { platform: process.platform, dev: String(s.dev), ino: String(s.ino),
      ...(s.birthtimeNs > 0n ? { birthtimeNs: String(s.birthtimeNs) } : {}) }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function bindingDigest(ownerConfigBinding) {
  if (typeof ownerConfigBinding === 'string' && /^[a-f0-9]{64}$/.test(ownerConfigBinding)) return ownerConfigBinding
  if (!isObject(ownerConfigBinding)) throw fail('INVALID_ARGUMENT', 'invalid-owner-config-binding')
  const canonical = value => Array.isArray(value) ? value.map(canonical) : isObject(value) ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return hash(canonical(ownerConfigBinding))
}
function registryRecord(meta, path, identity, binding) {
  return { domainId: meta.domainId, registrationId: meta.registrationId, canonicalStore: path,
    fileIdentity: identity, ownerConfigBinding: binding, status: 'completed' }
}
function findByStore(registry, path) { return registry.domains.find(item => item.canonicalStore === path) }
function findByDomain(registry, domainId) { return registry.domains.find(item => item.domainId === domainId) }
function replaceRecord(registry, record, source) {
  const domains = registry.domains.filter(item => item.domainId !== record.domainId &&
    item.canonicalStore !== record.canonicalStore && item.domainId !== source?.domainId)
  return { schemaVersion: 1, domains: [...domains, record].sort((a, b) => a.domainId.localeCompare(b.domainId)) }
}
function metadataError(error) {
  if (error?.code === 'version-mismatch') return fail('PRECONDITION_FAILED', 'domain-schema-unsupported')
  if (error?.code === 'invalid-record' || error?.code === 'malformed-medium') return fail('PRECONDITION_FAILED', 'domain-schema-unsupported')
  if (error?.code === 'ERR_SQLITE_ERROR' && [1, 11, 26].includes(error.errcode & 0xff))
    return fail('PRECONDITION_FAILED', 'domain-schema-unsupported')
  return error
}
// This is the sole metadata read/write path. DSH owns its schema, tables and serialization.
async function withMetadata(path, work) {
  const ctx = new Context()
  let domain, facility, backend, result, failed, disposalFailed
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageSqlite, { path })
    await ctx.plugin(StorageDomain, { backend: 'sqlite' })
    facility = ctx.get('storageDomain')
    backend = ctx.storage.backend.get('sqlite')
    domain = await facility.open(spec)
    const table = domain.table('identity')
    if (table.size > 1 || (table.size === 1 && !table.get(key))) throw fail('PRECONDITION_FAILED', 'domain-schema-unsupported')
    result = await work(table.get(key) ?? null, table)
  } catch (error) { failed = metadataError(error) }
  try { await domain?.close() } catch (error) { disposalFailed = error }
  try { await facility?.closeAll() } catch (error) { disposalFailed ??= error }
  try { await backend?.close() } catch (error) { disposalFailed ??= error }
  try { await ctx.fiber.dispose() } catch (error) { disposalFailed ??= error }
  if (disposalFailed) {
    const error = fail('PRECONDITION_FAILED', 'storage-disposal-unconfirmed')
    error.storageDisposalUnconfirmed = true
    throw error
  }
  if (failed) throw failed
  return result
}
async function readMetadataSnapshot(path) {
  if (!await fileIdentity(path)) return null
  const tempDir = join(tmpdir(), `ivoraige-host-inspect-${uuid()}`)
  await ensurePrivateDirectory(tempDir)
  let source
  try {
    source = new DatabaseSync(path, { readOnly: true })
    const temp = join(tempDir, 'store.sqlite')
    await backup(source, temp)
    return await withMetadata(temp, value => value)
  } catch (error) { throw metadataError(error)
  } finally { try { source?.close() } finally { await rm(tempDir, { recursive: true, force: true }) } }
}
function checkRecord(record, meta, identity, binding) {
  if (!meta || !identity || record.domainId !== meta.domainId || record.registrationId !== meta.registrationId ||
      !sameIdentity(record.fileIdentity, identity)) throw fail('CONFLICT', 'domain-registration-mismatch')
  if (record.ownerConfigBinding !== binding) throw fail('CONFLICT', 'owner-config-mismatch')
}

// Protected read only: used before opening a busy store to locate its owner IPC.
export async function findHostDomain({ store, registryRoot } = {}) {
  const path = await canonicalStorePath(store)
  const dir = await secureDirectory(registryRoot, false)
  const registry = await readRegistry(dir)
  if (await readIntent(dir)) throw fail('CONFLICT', 'registry-intent-pending')
  const found = findByStore(registry, path) ?? null
  if (found) {
    const observedIdentity = await fileIdentity(path)
    if (!sameIdentity(found.fileIdentity, observedIdentity)) throw fail('CONFLICT', 'domain-registration-mismatch')
    // Older registrations did not record creation time. Windows can also
    // retain a deleted path's creation time when that path is quickly
    // recreated. In either case, verify the DSH registration before attach.
    if (process.platform === 'win32' || found.fileIdentity.birthtimeNs === undefined) {
      const meta = await readMetadataSnapshot(path)
      if (!sameIdentity(observedIdentity, await fileIdentity(path)) || !meta ||
          meta.domainId !== found.domainId || meta.registrationId !== found.registrationId)
        throw fail('CONFLICT', 'domain-registration-mismatch')
    }
  }
  return found
}

// Return an already-held StoreLock lease. The caller must retain it until all
// writers are disposed; it is never acquired from an arbitrary caller object.
export async function createHostDomain({ store, ownerConfigBinding, registryRoot } = {}, { prepareStore } = {}) {
  if (!store || typeof store !== 'string') throw fail('INVALID_ARGUMENT', 'invalid-store')
  const path = await canonicalStorePath(store)
  const binding = bindingDigest(ownerConfigBinding)
  const dir = await secureDirectory(registryRoot, true)
  const registryLock = await acquireRegistryLockBounded(dir)
  let storeLease, sourceLease
  try {
    const registry = await readRegistry(dir)
    const intent = await readIntent(dir)
    storeLease = await acquireStoreLock(path)
    // Existing store compatibility is checked under the lease before adding
    // host metadata. The application supplies its pinned Records gate here.
    await prepareStore?.(path)
    let identity = await fileIdentity(path)
    if (intent) {
      if (intent.record.canonicalStore !== path) throw fail('CONFLICT', 'registry-intent-pending')
      const completed = { ...intent.record, fileIdentity: identity }
      const alreadyCommitted = sameRecord(findByStore(registry, path), completed)
      if (!alreadyCommitted && intent.beforeRevision !== registryRevision(registry)) throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!alreadyCommitted && intent.source && !registry.domains.some(item => sameRecord(item, intent.source)))
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!alreadyCommitted && intent.source) {
        if (intent.source.canonicalStore.localeCompare(path) < 0) {
          storeLease.release(); storeLease = undefined
          sourceLease = await acquireStoreLock(intent.source.canonicalStore)
          storeLease = await acquireStoreLock(path)
        } else sourceLease = await acquireStoreLock(intent.source.canonicalStore)
        const originalIdentity = await fileIdentity(intent.source.canonicalStore)
        if (!sameIdentity(intent.source.fileIdentity, originalIdentity)) throw fail('CONFLICT', 'domain-registration-mismatch')
      }
      if (intent.record.fileIdentity && !sameIdentity(intent.record.fileIdentity, identity)) throw fail('CONFLICT', 'domain-registration-mismatch')
      let current = await readMetadataSnapshot(path)
      if (!current && intent.mode === 'initialize' ||
          intent.mode === 'copy' && current && intent.source && same(current,
            { domainId: intent.source.domainId, registrationId: intent.source.registrationId, bindingVersion: 1 })) {
        await withMetadata(path, async (value, table) => {
          if (!same(value, current)) throw fail('CONFLICT', 'domain-registration-mismatch')
          await table.put(key, { domainId: intent.record.domainId,
            registrationId: intent.record.registrationId, bindingVersion: 1 })
        })
        current = await readMetadataSnapshot(path)
        identity = await fileIdentity(path)
      }
      if (!current || current.domainId !== intent.record.domainId || current.registrationId !== intent.record.registrationId)
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!alreadyCommitted) await durableReplace(dir, REGISTRY,
        replaceRecord(registry, { ...intent.record, fileIdentity: identity },
          intent.mode === 'migrate' ? intent.source : null))
      await durableRemove(dir, INTENT)
    }
    const active = await readRegistry(dir)
    const existing = findByStore(active, path)
    const meta = await readMetadataSnapshot(path)
    identity = await fileIdentity(path)
    if (existing) {
      checkRecord(existing, meta, identity, binding)
      if (existing.fileIdentity.birthtimeNs === undefined && identity.birthtimeNs !== undefined)
        await durableReplace(dir, REGISTRY, replaceRecord(active, { ...existing, fileIdentity: identity }))
      return { dataDomainRef: meta.domainId, registrationId: meta.registrationId,
        canonicalStore: path, fileIdentity: identity, ownerConfigBinding: binding, storeLease }
    }
    if (meta) throw fail('CONFLICT', 'domain-registration-mismatch')
    const proposed = { domainId: uuid(), registrationId: uuid(), bindingVersion: 1 }
    const record = registryRecord(proposed, path, identity, binding)
    const initIntent = { version: 1, mode: 'initialize', transactionId: uuid(),
      beforeRevision: registryRevision(active), source: null, record }
    // For a new store the file identity is filled after DSH creates it.
    await durableReplace(dir, INTENT, initIntent)
    await withMetadata(path, async (current, table) => {
      if (current) throw fail('CONFLICT', 'domain-registration-mismatch')
      await table.put(key, proposed)
    })
    identity = await fileIdentity(path)
    const completed = { ...record, fileIdentity: identity }
    await durableReplace(dir, REGISTRY, replaceRecord(active, completed))
    await durableRemove(dir, INTENT)
    return { dataDomainRef: proposed.domainId, registrationId: proposed.registrationId,
      canonicalStore: path, fileIdentity: identity, ownerConfigBinding: binding, storeLease }
  } catch (error) {
    if (error.storageDisposalUnconfirmed) unconfirmedLeases.add(storeLease)
    else storeLease?.release()
    throw error
  } finally { sourceLease?.release(); registryLock.release() }
}

async function observation(path, dir, lease) {
  const registry = await readRegistry(dir)
  const intent = await readIntent(dir)
  const identity = await fileIdentity(path)
  const metadata = lease && identity ? await readMetadataSnapshot(path) : null
  const atPath = findByStore(registry, path) ?? null
  const byDomain = metadata ? findByDomain(registry, metadata.domainId) ?? null : null
  const problem = intent ? 'pending-intent' : !identity ? 'store-absent' : !metadata ? 'metadata-absent' :
    atPath && byDomain && atPath.domainId === metadata.domainId && sameIdentity(atPath.fileIdentity, identity) ? 'none' :
    atPath && atPath.domainId !== metadata.domainId ? 'path-replaced' : byDomain ? 'domain-at-other-path' : 'registration-missing'
  const observed = { canonicalStore: path, fileIdentity: identity, metadata, atPath, byDomain, problem,
    lock: lease ? 'available' : 'busy', registryRevision: registryRevision(registry) }
  return { ...observed, diagnosticRevision: hash(observed) }
}
export async function inspectHostDomain({ store, registryRoot } = {}) {
  if (!store || typeof store !== 'string') throw fail('INVALID_ARGUMENT', 'invalid-store')
  const path = await canonicalStorePath(store)
  const dir = await secureDirectory(registryRoot, false)
  let lease
  try { lease = await acquireStoreLock(path) }
  catch (error) { if (error.code !== 'CONFLICT') throw error }
  try {
    const found = await observation(path, dir, lease)
    return { ...found, availableModes: !lease ? [] : found.problem === 'domain-at-other-path' ? ['copy'] : [] }
  } finally { lease?.release() }
}

export async function recoverHostDomain({ store, mode, expectedDiagnostic, confirm, ownerConfigBinding,
  verifySourceRetired, registryRoot } = {}) {
  if (!['migrate', 'copy', 'repair-registration'].includes(mode) || !expectedDiagnostic || confirm !== true)
    throw fail('INVALID_ARGUMENT', 'invalid-recovery-request')
  const path = await canonicalStorePath(store)
  const dir = await secureDirectory(registryRoot, true)
  const registryLock = await acquireRegistryLockBounded(dir)
  let lease, sourceLease, retainTargetLease = false
  try {
    lease = await acquireStoreLock(path)
    const actual = await observation(path, dir, lease)
    if (actual.diagnosticRevision !== expectedDiagnostic || !actual.metadata || !actual.fileIdentity)
      throw fail('CONFLICT', 'diagnostic-changed')
    const registry = await readRegistry(dir)
    const source = actual.byDomain
    let meta = actual.metadata
    if (mode === 'repair-registration') {
      if (actual.problem !== 'registration-missing' || actual.atPath) throw fail('CONFLICT', 'domain-registration-mismatch')
      // A verified same-domain source is required; guessing an unregistered ID is unsafe.
      if (!source || !sameIdentity(source.fileIdentity, actual.fileIdentity)) throw fail('PRECONDITION_FAILED', 'repair-evidence-unavailable')
    } else if (mode === 'migrate' || mode === 'copy') {
      if (actual.problem !== 'domain-at-other-path' || !source || source.canonicalStore === path)
        throw fail('CONFLICT', 'domain-registration-mismatch')
      // The old path must still be accessible. Acquire it without waiting; a
      // missing/busy source cannot establish retirement or distinct-copy proof.
      if (source.canonicalStore.localeCompare(path) < 0) {
        lease.release(); lease = undefined
        sourceLease = await acquireStoreLock(source.canonicalStore)
        lease = await acquireStoreLock(path)
      } else sourceLease = await acquireStoreLock(source.canonicalStore)
      if (!sameIdentity(actual.fileIdentity, await fileIdentity(path)) ||
          !same(await readMetadataSnapshot(path), actual.metadata))
        throw fail('CONFLICT', 'diagnostic-changed')
      const sourceIdentity = await fileIdentity(source.canonicalStore)
      if (!sameIdentity(source.fileIdentity, sourceIdentity) || sameIdentity(sourceIdentity, actual.fileIdentity))
        throw fail('CONFLICT', 'domain-registration-mismatch')
      const sourceMeta = await readMetadataSnapshot(source.canonicalStore)
      if (!same(sourceMeta, actual.metadata)) throw fail('CONFLICT', 'domain-registration-mismatch')
      // The verifier must be an immediate, local process-handle observation:
      // never wait for IPC, a network, or user input while holding registry lock.
      if (mode === 'migrate' && (typeof verifySourceRetired !== 'function' ||
          verifySourceRetired(source) !== true))
        throw fail('PRECONDITION_FAILED', 'source-retirement-unverified')
      if (mode === 'copy') meta = { domainId: uuid(), registrationId: uuid(), bindingVersion: 1 }
    }
    const binding = ownerConfigBinding === undefined ? (source ?? actual.atPath)?.ownerConfigBinding : bindingDigest(ownerConfigBinding)
    if (!binding) throw fail('PRECONDITION_FAILED', 'owner-config-mismatch')
    if (mode === 'copy' && source.ownerConfigBinding !== binding) throw fail('CONFLICT', 'owner-config-mismatch')
    const record = registryRecord(meta, path, actual.fileIdentity, binding)
    const intent = { version: 1, mode, transactionId: uuid(), beforeRevision: registryRevision(registry), source: source ?? null, record }
    await durableReplace(dir, INTENT, intent)
    if (mode === 'copy') await withMetadata(path, async (current, table) => {
      if (!same(current, actual.metadata)) throw fail('CONFLICT', 'domain-registration-mismatch')
      await table.put(key, meta)
    })
    await durableReplace(dir, REGISTRY, replaceRecord(registry, record, mode === 'migrate' ? source : null))
    await durableRemove(dir, INTENT)
    return { dataDomainRef: meta.domainId, registrationId: meta.registrationId, diagnosticRevision: actual.diagnosticRevision }
  } catch (error) {
    if (error.storageDisposalUnconfirmed) { unconfirmedLeases.add(lease); retainTargetLease = true }
    throw error
  } finally { sourceLease?.release(); if (!retainTargetLease) lease?.release(); registryLock.release() }
}
