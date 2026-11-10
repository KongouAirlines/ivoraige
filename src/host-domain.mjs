// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.
// The registry is per OS user. The DSH domain is the authority for a store's
// identity; the registry binds that identity to this machine's canonical path.
import './runtime.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { backup, DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Storage, StorageDomain, StorageSqlite, z } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { acquireStoreLock, canonicalStorePath } from './store-lock.mjs'
import { assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from './host-permissions.mjs'
import { afterWindowsAclWorkerRetirement, windowsFsOperation } from './host-windows-acl.mjs'

const spec = StorageDomain.defineDomain({ name: 'ivoraige_host', version: 1, layout: 'per-record',
  tables: { identity: StorageDomain.domainTable(z.object({ domainId: z.string().uuid(),
    registrationId: z.string().uuid(), bindingVersion: z.literal(1) }).strict()) } })
const key = 'store'
const REGISTRY = 'domains.json'
const INTENT = 'domain-intent.json'
const INTENT_LAYOUT = { version: 3, layout: 'per-store' }
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
function intentName(path) { return `domain-intent-${hash(path)}.json` }
async function parseIntent(raw, allowLayout = false) {
  if (raw === null) return null
  let value
  try { value = JSON.parse(raw) } catch { throw fail('PRECONDITION_FAILED', 'registry-corrupt') }
  if (allowLayout && isObject(value) && value.version === 3 && value.layout === 'per-store' && Object.keys(value).length === 2) return null
  if (!isObject(value) || ![1, 2, 3].includes(value.version) ||
      !['initialize', 'migrate', 'copy', 'refresh-identity', 'repair-registration'].includes(value.mode) ||
      !/^[0-9a-f-]{36}$/i.test(value.transactionId) || !validRecord(value.record, true) ||
      !(value.source === null || validRecord(value.source)) ||
      (value.version === 1 && !/^[a-f0-9]{64}$/.test(value.beforeRevision)) ||
      (value.version >= 2 && !(value.targetBefore === null || validRecord(value.targetBefore))) ||
      (value.version === 3 && (!validIdentity(value.record.fileIdentity) ||
        !['prepared', 'writing'].includes(value.phase) || value.phase === 'prepared' && value.mode !== 'initialize')))
    throw fail('PRECONDITION_FAILED', 'registry-corrupt')
  return value
}
async function readIntent(dir, path) {
  if (!dir) return null
  const current = await parseIntent(await privateRead(join(dir, intentName(path))))
  const legacy = await parseIntent(await privateRead(join(dir, INTENT)), true)
  if (current && current.record.canonicalStore !== path) throw fail('PRECONDITION_FAILED', 'registry-corrupt')
  if (current && legacy?.record.canonicalStore === path &&
      (current.transactionId !== legacy.transactionId || current.mode !== legacy.mode ||
       !same(current.record, legacy.record) || !same(current.source, legacy.source)))
    throw fail('PRECONDITION_FAILED', 'registry-corrupt')
  return current ?? (legacy?.record.canonicalStore === path ? legacy : null)
}
function intentFile(intent) { return intent.version === 1 ? INTENT : intentName(intent.record.canonicalStore) }
// The global file becomes a permanent format gate: both older singleton and
// phase-less v2 binaries must reject it rather than ignore per-store journals.
// Never label a legacy intent prepared. Publish its per-store representation
// first, then the gate; a crash between these writes is safely deduplicated.
async function ensureIntentLayout(dir, registry) {
  const raw = await privateRead(join(dir, INTENT))
  const legacy = await parseIntent(raw, true)
  if (raw !== null && legacy === null) return
  if (legacy) {
    if (legacy.version !== 1) throw fail('PRECONDITION_FAILED', 'registry-corrupt')
    const name = intentName(legacy.record.canonicalStore)
    const existing = await parseIntent(await privateRead(join(dir, name)), name === INTENT)
    if (existing) {
      if (existing.transactionId !== legacy.transactionId || existing.mode !== legacy.mode ||
          !same(existing.record, legacy.record) || !same(existing.source, legacy.source))
        throw fail('CONFLICT', 'registry-intent-pending')
    } else {
      const atPath = findByStore(registry, legacy.record.canonicalStore)
      const committed = atPath && sameRecord(atPath, { ...legacy.record,
        fileIdentity: legacy.record.fileIdentity ?? atPath.fileIdentity })
      if (!committed && registryRevision(registry) !== legacy.beforeRevision)
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!committed && legacy.source && !registry.domains.some(item => sameRecord(item, legacy.source)))
        throw fail('CONFLICT', 'domain-registration-mismatch')
      await durableReplace(dir, name, { version: 2, mode: legacy.mode,
        transactionId: legacy.transactionId, targetBefore: committed ? null : atPath ?? null,
        source: legacy.source, record: legacy.record })
    }
  }
  await durableReplace(dir, INTENT, INTENT_LAYOUT)
}
async function assertSourceIntentFree(dir, source, target) {
  if (!source) return
  const names = (await readdir(dir)).filter(name => name === INTENT || /^domain-intent-[a-f0-9]{64}\.json$/.test(name))
  for (const name of names) {
    const pending = await parseIntent(await privateRead(join(dir, name)), name === INTENT)
    if (!pending || pending.record.canonicalStore === target) continue
    if (pending.record.canonicalStore === source.canonicalStore ||
        pending.source?.canonicalStore === source.canonicalStore ||
        pending.source?.domainId === source.domainId)
      throw fail('CONFLICT', 'registry-intent-pending')
  }
}
async function assertSourceNotMigrating(dir, path) {
  if (!dir) return
  const names = (await readdir(dir)).filter(name => name === INTENT || /^domain-intent-[a-f0-9]{64}\.json$/.test(name))
  for (const name of names) {
    const pending = await parseIntent(await privateRead(join(dir, name)), name === INTENT)
    if (pending?.mode === 'migrate' && pending.source?.canonicalStore === path)
      throw fail('CONFLICT', 'registry-intent-pending')
  }
}
function intendedRecord(registry, intent, identity) {
  const record = { ...intent.record, fileIdentity: identity }
  const committed = sameRecord(findByStore(registry, record.canonicalStore), record)
  if (!committed) {
    const atPath = findByStore(registry, record.canonicalStore) ?? null
    if (!sameRecord(atPath, intent.version === 1 ? null : intent.targetBefore) &&
        !(atPath === null && (intent.version === 1 || intent.targetBefore === null)))
      throw fail('CONFLICT', 'domain-registration-mismatch')
    if (intent.source && !registry.domains.some(item => sameRecord(item, intent.source)))
      throw fail('CONFLICT', 'domain-registration-mismatch')
    const byDomain = findByDomain(registry, record.domainId)
    if (byDomain && !sameRecord(byDomain, atPath) && !sameRecord(byDomain, intent.source))
      throw fail('CONFLICT', 'domain-registration-mismatch')
  }
  return { record, committed }
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
export async function acquireRegistryLockBounded(dir) {
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
  return { release() {
    if (released) return
    // On a helper timeout/protocol fault, the operation reports failure
    // promptly, but its native filesystem mutation may still be running.
    // Keep the SQLite registry lease until the child has actually exited.
    const deferred = process.platform === 'win32' ? afterWindowsAclWorkerRetirement(() => db.close()) : null
    if (process.platform !== 'win32') db.close()
    released = true
    if (deferred) void deferred.catch(error => {
      // A failed close is unconfirmed ownership; never silently drop it.
      unconfirmedLeases.add(db)
      process.emitWarning(error, 'Windows registry lock release failed')
    })
  } }
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
  if (await readIntent(dir, path)) throw fail('CONFLICT', 'registry-intent-pending')
  await assertSourceNotMigrating(dir, path)
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
export async function createHostDomain({ store, ownerConfigBinding, registryRoot, verifySourceRetired } = {}, { prepareStore } = {}) {
  if (!store || typeof store !== 'string') throw fail('INVALID_ARGUMENT', 'invalid-store')
  const path = await canonicalStorePath(store)
  const binding = bindingDigest(ownerConfigBinding)
  const dir = await secureDirectory(registryRoot, true)
  const registryLock = await acquireRegistryLockBounded(dir)
  let storeLease, sourceLease
  let initIntent
  try {
    const registry = await readRegistry(dir)
    await ensureIntentLayout(dir, registry)
    const intent = await readIntent(dir, path)
    await assertSourceNotMigrating(dir, path)
    storeLease = await acquireStoreLock(path)
    // Existing store compatibility is checked under the lease before adding
    // host metadata. The application supplies its pinned Records gate here.
    await prepareStore?.(path)
    let identity = await fileIdentity(path)
    if (intent) {
      if (intent.record.ownerConfigBinding !== binding) throw fail('CONFLICT', 'owner-config-mismatch')
      const { committed: alreadyCommitted } = intendedRecord(registry, intent, identity)
      if (!alreadyCommitted && intent.source) {
        await assertSourceIntentFree(dir, intent.source, path)
        if (intent.source.canonicalStore.localeCompare(path) < 0) {
          storeLease.release(); storeLease = undefined
          sourceLease = await acquireStoreLock(intent.source.canonicalStore)
          storeLease = await acquireStoreLock(path)
        } else sourceLease = await acquireStoreLock(intent.source.canonicalStore)
        const originalIdentity = await fileIdentity(intent.source.canonicalStore)
        const sourceMeta = await readMetadataSnapshot(intent.source.canonicalStore)
        if (!sameIdentity(intent.source.fileIdentity, originalIdentity) ||
            !sameIdentity(originalIdentity, await fileIdentity(intent.source.canonicalStore)) ||
            !same(sourceMeta, { domainId: intent.source.domainId,
              registrationId: intent.source.registrationId, bindingVersion: 1 }))
          throw fail('CONFLICT', 'domain-registration-mismatch')
        if (intent.mode === 'migrate' && (typeof verifySourceRetired !== 'function' ||
            verifySourceRetired(intent.source) !== true))
          throw fail('PRECONDITION_FAILED', 'source-retirement-unverified')
      }
      identity = await fileIdentity(path)
      if (intent.record.fileIdentity && !sameIdentity(intent.record.fileIdentity, identity))
        throw fail('CONFLICT', 'domain-registration-mismatch')
      let current = await readMetadataSnapshot(path)
      // A phase-less legacy intent with no file identity can prove an existing
      // committed ID, not that a disappeared/empty target is safe to recreate.
      if (intent.mode === 'initialize' && !intent.record.fileIdentity && !current)
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!current && intent.mode === 'initialize' ||
          intent.mode === 'copy' && current && intent.source && same(current,
            { domainId: intent.source.domainId, registrationId: intent.source.registrationId, bindingVersion: 1 })) {
        if (intent.version === 3) await durableReplace(dir, intentFile(intent), { ...intent, phase: 'writing' })
        await withMetadata(path, async (value, table) => {
          if (!same(value, current)) throw fail('CONFLICT', 'domain-registration-mismatch')
          await table.put(key, { domainId: intent.record.domainId,
            registrationId: intent.record.registrationId, bindingVersion: 1 })
        })
        current = await readMetadataSnapshot(path)
        identity = await fileIdentity(path)
      }
      identity = await fileIdentity(path)
      if (intent.record.fileIdentity && !sameIdentity(intent.record.fileIdentity, identity))
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!current || current.domainId !== intent.record.domainId || current.registrationId !== intent.record.registrationId)
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (!alreadyCommitted) await durableReplace(dir, REGISTRY,
        replaceRecord(registry, { ...intent.record, fileIdentity: identity },
          intent.mode === 'migrate' ? intent.source : null))
      await durableRemove(dir, intentFile(intent))
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
    if (!identity) {
      const target = await open(path, 'wx', 0o600)
      try { await target.sync() } finally { await target.close() }
      identity = await fileIdentity(path)
    }
    if (!identity || !sameIdentity(identity, await fileIdentity(path)))
      throw fail('CONFLICT', 'domain-registration-mismatch')
    const proposed = { domainId: uuid(), registrationId: uuid(), bindingVersion: 1 }
    const record = registryRecord(proposed, path, identity, binding)
    initIntent = { version: 3, mode: 'initialize', transactionId: uuid(),
      phase: 'prepared', targetBefore: null, source: null, record }
    // A durable write-start barrier separates provable no-write preparation
    // from every point at which a domain metadata commit might have occurred.
    await durableReplace(dir, intentFile(initIntent), initIntent)
    initIntent = { ...initIntent, phase: 'writing' }
    await durableReplace(dir, intentFile(initIntent), initIntent)
    await withMetadata(path, async (current, table) => {
      if (current) throw fail('CONFLICT', 'domain-registration-mismatch')
      await table.put(key, proposed)
    })
    identity = await fileIdentity(path)
    if (!sameIdentity(record.fileIdentity, identity)) throw fail('CONFLICT', 'domain-registration-mismatch')
    const completed = { ...record, fileIdentity: identity }
    await durableReplace(dir, REGISTRY, replaceRecord(active, completed))
    await durableRemove(dir, intentFile(initIntent))
    return { dataDomainRef: proposed.domainId, registrationId: proposed.registrationId,
      canonicalStore: path, fileIdentity: identity, ownerConfigBinding: binding, storeLease }
  } catch (error) {
    // Only a confirmed metadata-free target permits removing a failed
    // initialization intent. Inaccessible media or unconfirmed DSH disposal
    // cannot establish that no write took effect.
    if (initIntent && !error.storageDisposalUnconfirmed) {
      try {
        const identity = await fileIdentity(path)
        if (sameIdentity(initIntent.record.fileIdentity, identity) && !await readMetadataSnapshot(path) &&
            sameIdentity(identity, await fileIdentity(path))) await durableRemove(dir, intentFile(initIntent))
      } catch { /* Preserve the intent and original failure. */ }
    }
    if (error.storageDisposalUnconfirmed) unconfirmedLeases.add(storeLease)
    else storeLease?.release()
    throw error
  } finally { sourceLease?.release(); registryLock.release() }
}

// Only a saved v3 prepared target may be addressed without its missing parent.
// The registry lease fences all initialization/replay writers; no store or lock
// file is recreated merely to abandon an operation that never attempted a write.
async function recoveryPath(store, dir) {
  try { return { path: await canonicalStorePath(store), missingParent: false } }
  catch (error) {
    if (error.code !== 'INVALID_ARGUMENT') throw error
    const path = resolve(store)
    const intent = await readIntent(dir, path)
    if (!intent || intent.version !== 3 || intent.mode !== 'initialize' || intent.phase !== 'prepared' ||
        intent.record.canonicalStore !== path || await fileIdentity(path)) throw error
    return { path, missingParent: true }
  }
}
function canAbandonInitialization(intent, atPath, identity, metadata, locked) {
  if (!locked || intent?.mode !== 'initialize' || atPath || intent.source || intent.targetBefore || metadata)
    return false
  if (!identity) return intent.version === 3 && intent.phase === 'prepared'
  return sameIdentity(intent.record.fileIdentity, identity)
}
async function observation(path, dir, lease, missingParent = false) {
  const registry = await readRegistry(dir)
  const intent = await readIntent(dir, path)
  const identity = await fileIdentity(path)
  const metadata = lease && identity ? await readMetadataSnapshot(path) : null
  if (missingParent && identity || lease && identity && !sameIdentity(identity, await fileIdentity(path)))
    throw fail('CONFLICT', 'diagnostic-changed')
  const atPath = findByStore(registry, path) ?? null
  const byDomain = metadata ? findByDomain(registry, metadata.domainId) ?? null : null
  const canAbandon = canAbandonInitialization(intent, atPath, identity, metadata, lease || missingParent)
  const problem = intent ? 'pending-intent' : !identity ? 'store-absent' : !metadata ? 'metadata-absent' :
    atPath && atPath.domainId === metadata.domainId && atPath.registrationId === metadata.registrationId &&
      sameIdentity(atPath.fileIdentity, identity) ? 'none' :
    atPath && atPath.domainId === metadata.domainId && atPath.registrationId === metadata.registrationId &&
      !sameIdentity(atPath.fileIdentity, identity) ? 'store-replaced-in-place' :
    atPath ? 'path-replaced' : byDomain ? 'domain-at-other-path' : 'registration-missing'
  const observed = { canonicalStore: path, fileIdentity: identity, metadata, atPath, byDomain, problem,
    lock: lease ? 'available' : missingParent ? 'unavailable' : 'busy', registryRevision: registryRevision(registry) }
  const diagnosticRevision = hash({ ...observed, registryRevision: undefined,
    intent: intent ? hash(intent) : null })
  const availableModes = canAbandon ? ['abandon-initialization'] : !lease ? [] :
    problem === 'store-replaced-in-place' ? ['refresh-identity'] : []
  return { ...observed, diagnosticRevision, availableModes }
}
export async function inspectHostDomain({ store, registryRoot } = {}) {
  if (!store || typeof store !== 'string') throw fail('INVALID_ARGUMENT', 'invalid-store')
  const dir = await secureDirectory(registryRoot, false)
  const { path, missingParent } = await recoveryPath(store, dir)
  let lease
  if (!missingParent) {
    try { lease = await acquireStoreLock(path) }
    catch (error) { if (error.code !== 'CONFLICT') throw error }
  }
  try {
    let found = await observation(path, dir, lease, missingParent)
    if (lease && found.problem === 'domain-at-other-path' && found.byDomain?.canonicalStore !== path) {
      let sourceLease
      try {
        const sourcePath = found.byDomain.canonicalStore
        if (sourcePath.localeCompare(path) < 0) {
          lease.release(); lease = undefined
          sourceLease = await acquireStoreLock(sourcePath)
          lease = await acquireStoreLock(path)
          found = await observation(path, dir, lease)
        } else sourceLease = await acquireStoreLock(sourcePath)
        if (found.problem === 'domain-at-other-path' && found.byDomain?.canonicalStore === sourcePath &&
            sameIdentity(found.byDomain.fileIdentity, await fileIdentity(sourcePath)) &&
            same(found.metadata, await readMetadataSnapshot(sourcePath)))
          found.availableModes = ['copy']
      } catch (error) {
        if (error.code !== 'CONFLICT' && error.code !== 'ENOENT') throw error
        if (!lease) {
          try { lease = await acquireStoreLock(path) }
          catch (error) { if (error.code !== 'CONFLICT') throw error }
          found = await observation(path, dir, lease)
        }
      }
      finally { sourceLease?.release() }
    }
    return found
  } finally { lease?.release() }
}

export async function recoverHostDomain({ store, mode, expectedDiagnostic, confirm, ownerConfigBinding,
  verifySourceRetired, registryRoot } = {}) {
  if (!['migrate', 'copy', 'refresh-identity', 'abandon-initialization'].includes(mode) ||
      typeof store !== 'string' || !store || !expectedDiagnostic || confirm !== true)
    throw fail('INVALID_ARGUMENT', 'invalid-recovery-request')
  const dir = await secureDirectory(registryRoot, true)
  const { path, missingParent } = await recoveryPath(store, dir)
  const registryLock = await acquireRegistryLockBounded(dir)
  let lease, sourceLease, retainTargetLease = false
  try {
    if (!missingParent) lease = await acquireStoreLock(path)
    else {
      const current = await recoveryPath(store, dir)
      if (!current.missingParent || current.path !== path) throw fail('CONFLICT', 'diagnostic-changed')
    }
    const actual = await observation(path, dir, lease, missingParent)
    if (actual.diagnosticRevision !== expectedDiagnostic)
      throw fail('CONFLICT', 'diagnostic-changed')
    if (mode === 'abandon-initialization') {
      if (!actual.availableModes.includes(mode)) throw fail('CONFLICT', 'domain-registration-mismatch')
      await ensureIntentLayout(dir, await readRegistry(dir))
      const pending = await readIntent(dir, path)
      if (!pending || pending.mode !== 'initialize') throw fail('CONFLICT', 'diagnostic-changed')
      await durableRemove(dir, intentFile(pending))
      return { abandonedTransactionId: pending.transactionId, diagnosticRevision: actual.diagnosticRevision }
    }
    await ensureIntentLayout(dir, await readRegistry(dir))
    if (mode === 'migrate' && actual.problem === 'pending-intent') {
      const pending = await readIntent(dir, path)
      if (pending?.mode !== 'migrate' || !pending.source || !actual.metadata || !actual.fileIdentity ||
          !sameIdentity(pending.record.fileIdentity, actual.fileIdentity) ||
          actual.metadata.domainId !== pending.record.domainId ||
          actual.metadata.registrationId !== pending.record.registrationId)
        throw fail('CONFLICT', 'domain-registration-mismatch')
      if (ownerConfigBinding !== undefined && bindingDigest(ownerConfigBinding) !== pending.record.ownerConfigBinding)
        throw fail('CONFLICT', 'owner-config-mismatch')
      const registry = await readRegistry(dir)
      const { committed } = intendedRecord(registry, pending, actual.fileIdentity)
      if (!committed) {
        await assertSourceIntentFree(dir, pending.source, path)
        if (pending.source.canonicalStore.localeCompare(path) < 0) {
          lease.release(); lease = undefined
          sourceLease = await acquireStoreLock(pending.source.canonicalStore)
          lease = await acquireStoreLock(path)
        } else sourceLease = await acquireStoreLock(pending.source.canonicalStore)
        if (!sameIdentity(actual.fileIdentity, await fileIdentity(path)) ||
            !same(actual.metadata, await readMetadataSnapshot(path)) ||
            !sameIdentity(pending.source.fileIdentity, await fileIdentity(pending.source.canonicalStore)) ||
            !same(actual.metadata, await readMetadataSnapshot(pending.source.canonicalStore)))
          throw fail('CONFLICT', 'domain-registration-mismatch')
        if (typeof verifySourceRetired !== 'function' || verifySourceRetired(pending.source) !== true)
          throw fail('PRECONDITION_FAILED', 'source-retirement-unverified')
        await durableReplace(dir, REGISTRY, replaceRecord(registry, pending.record, pending.source))
      }
      await durableRemove(dir, intentFile(pending))
      return { dataDomainRef: pending.record.domainId, registrationId: pending.record.registrationId,
        diagnosticRevision: actual.diagnosticRevision }
    }
    if (!actual.metadata || !actual.fileIdentity) throw fail('CONFLICT', 'diagnostic-changed')
    if (await readIntent(dir, path)) throw fail('CONFLICT', 'registry-intent-pending')
    const registry = await readRegistry(dir)
    const source = actual.byDomain
    let meta = actual.metadata
    if (mode === 'refresh-identity') {
      if (actual.problem !== 'store-replaced-in-place' || !actual.atPath ||
          actual.atPath.domainId !== meta.domainId || actual.atPath.registrationId !== meta.registrationId)
        throw fail('CONFLICT', 'domain-registration-mismatch')
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
    const binding = ownerConfigBinding === undefined ? (actual.atPath ?? source)?.ownerConfigBinding : bindingDigest(ownerConfigBinding)
    if (!binding) throw fail('PRECONDITION_FAILED', 'owner-config-mismatch')
    if (mode === 'refresh-identity' && actual.atPath.ownerConfigBinding !== binding)
      throw fail('CONFLICT', 'owner-config-mismatch')
    if (mode === 'copy' && source.ownerConfigBinding !== binding) throw fail('CONFLICT', 'owner-config-mismatch')
    if (mode === 'copy' || mode === 'migrate') await assertSourceIntentFree(dir, source, path)
    if (!sameIdentity(actual.fileIdentity, await fileIdentity(path)) ||
        !same(actual.metadata, await readMetadataSnapshot(path)))
      throw fail('CONFLICT', 'diagnostic-changed')
    const record = registryRecord(meta, path, actual.fileIdentity, binding)
    const intent = { version: 3, mode, transactionId: uuid(), phase: 'writing', targetBefore: actual.atPath ?? null,
      source: mode === 'refresh-identity' ? null : source ?? null, record }
    await durableReplace(dir, intentFile(intent), intent)
    if (mode === 'copy') await withMetadata(path, async (current, table) => {
      if (!same(current, actual.metadata)) throw fail('CONFLICT', 'domain-registration-mismatch')
      await table.put(key, meta)
    })
    if (!sameIdentity(actual.fileIdentity, await fileIdentity(path)) ||
        !same(meta, await readMetadataSnapshot(path)))
      throw fail('CONFLICT', 'domain-registration-mismatch')
    await durableReplace(dir, REGISTRY, replaceRecord(registry, record, mode === 'migrate' ? source : null))
    await durableRemove(dir, intentFile(intent))
    return { dataDomainRef: meta.domainId, registrationId: meta.registrationId, diagnosticRevision: actual.diagnosticRevision }
  } catch (error) {
    if (error.storageDisposalUnconfirmed) { unconfirmedLeases.add(lease); retainTargetLease = true }
    throw error
  } finally { sourceLease?.release(); if (!retainTargetLease) lease?.release(); registryLock.release() }
}
