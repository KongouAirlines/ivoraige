import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageSqlite } from '../dist/dsh.mjs'
import { createHostDomain, findHostDomain, hostRegistryDirectory, inspectHostDomain, recoverHostDomain } from '../src/host-domain.mjs'
import { createPrivateFile } from '../src/host-permissions.mjs'

const config = {}
const reason = value => error => error.details?.reason === value
const intentName = path => `domain-intent-${createHash('sha256').update(path).digest('hex')}.json`
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'ivoraige-domain-journal-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, store: join(dir, 'seed.sqlite'), registryRoot: join(dir, 'state') }
}
async function create(f, store = f.store) {
  const result = await createHostDomain({ store, registryRoot: f.registryRoot, ownerConfigBinding: config })
  result.storeLease.release()
  return result
}
async function registry(f) { return JSON.parse(await readFile(join(hostRegistryDirectory(f.registryRoot), 'domains.json'))) }
async function identity(path) {
  const s = await stat(path, { bigint: true })
  return { platform: process.platform, dev: String(s.dev), ino: String(s.ino),
    ...(s.birthtimeNs > 0n ? { birthtimeNs: String(s.birthtimeNs) } : {}) }
}
async function saveIntent(f, intent) {
  const path = join(hostRegistryDirectory(f.registryRoot), intentName(intent.record.canonicalStore))
  await createPrivateFile(path, JSON.stringify(intent))
  return path
}
async function prepared(f, store) {
  await writeFile(store, '')
  const template = (await registry(f)).domains[0]
  return { version: 3, mode: 'initialize', transactionId: randomUUID(), phase: 'prepared',
    targetBefore: null, source: null, record: { ...template, canonicalStore: store, fileIdentity: await identity(store),
      domainId: randomUUID(), registrationId: randomUUID() } }
}
async function abandon(f, store, diagnosis) {
  return recoverHostDomain({ store, registryRoot: f.registryRoot, mode: 'abandon-initialization',
    expectedDiagnostic: diagnosis.diagnosticRevision, confirm: true })
}

test('phase-less v2 cannot abandon or recreate a target whose committed file disappeared', async t => {
  const f = await fixture(t)
  const first = await create(f)
  const record = (await registry(f)).domains[0]
  await writeFile(join(hostRegistryDirectory(f.registryRoot), 'domains.json'), JSON.stringify({ schemaVersion: 1, domains: [] }))
  const intent = { version: 2, mode: 'initialize', transactionId: randomUUID(), targetBefore: null,
    source: null, record: { ...record, fileIdentity: null } }
  const path = await saveIntent(f, intent)
  await rename(f.store, `${f.store}.persisted`)
  const diagnosis = await inspectHostDomain(f)
  assert.deepEqual(diagnosis.availableModes, [])
  await assert.rejects(abandon(f, f.store, diagnosis), reason('domain-registration-mismatch'))
  await assert.rejects(create(f), reason('domain-registration-mismatch'))
  await assert.rejects(stat(f.store), { code: 'ENOENT' })
  assert.ok(await readFile(path))
  assert.ok((await stat(`${f.store}.persisted`)).size > 0)
  await create(f, join(f.dir, 'unrelated.sqlite'))
  // Restoring the exact persisted metadata still permits legacy completion.
  await rename(`${f.store}.persisted`, f.store)
  assert.equal((await create(f)).dataDomainRef, first.dataDomainRef)
})

test('only v3 prepared proves no write when the canonical target parent disappears', async t => {
  const f = await fixture(t)
  await create(f)
  const parent = join(f.dir, 'gone')
  await mkdir(parent)
  const target = join(parent, 'target.sqlite')
  const intent = await prepared(f, target)
  const path = await saveIntent(f, intent)
  await rm(parent, { recursive: true })
  const diagnosis = await inspectHostDomain({ ...f, store: target })
  assert.equal(diagnosis.lock, 'unavailable')
  assert.deepEqual(diagnosis.availableModes, ['abandon-initialization'])
  await create(f, join(f.dir, 'unrelated.sqlite'))
  assert.equal((await abandon(f, target, diagnosis)).abandonedTransactionId, intent.transactionId)
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  await assert.rejects(stat(parent), { code: 'ENOENT' })
})

test('writing intent requires the same accessible metadata-free target for abandonment', async t => {
  const f = await fixture(t)
  await create(f)
  const target = join(f.dir, 'target.sqlite')
  const intent = await prepared(f, target)
  const path = await saveIntent(f, intent)
  const preparedDiagnosis = await inspectHostDomain({ ...f, store: target })
  await writeFile(path, JSON.stringify({ ...intent, phase: 'writing' }))
  await assert.rejects(abandon(f, target, preparedDiagnosis), reason('diagnostic-changed'))
  const writingDiagnosis = await inspectHostDomain({ ...f, store: target })
  assert.deepEqual(writingDiagnosis.availableModes, ['abandon-initialization'])
  await abandon(f, target, writingDiagnosis)
  assert.equal((await stat(target)).size, 0)
  await saveIntent(f, { ...intent, phase: 'writing' })
  await rm(target)
  const missing = await inspectHostDomain({ ...f, store: target })
  assert.deepEqual(missing.availableModes, [])
  await assert.rejects(abandon(f, target, missing), reason('domain-registration-mismatch'))
  await assert.rejects(create(f, target), reason('domain-registration-mismatch'))
  assert.ok(await readFile(path))
})

test('new initialization binds the file and flushes write-start before DSH opens its domain', async t => {
  const f = await fixture(t)
  await create(f)
  const target = join(f.dir, 'failing.sqlite')
  const pending = await prepared(f, join(f.dir, 'pending.sqlite'))
  const unrelatedIntent = await saveIntent(f, pending)
  const openUnit = StorageSqlite.SqliteStorageBackend.prototype.openUnit
  let calls = 0
  const mock = t.mock.method(StorageSqlite.SqliteStorageBackend.prototype, 'openUnit', async function (descriptor) {
    if (++calls === 1) {
      const intent = JSON.parse(await readFile(join(hostRegistryDirectory(f.registryRoot), intentName(target))))
      assert.equal(intent.version, 3)
      assert.equal(intent.phase, 'writing')
      assert.deepEqual(intent.record.fileIdentity, await identity(target))
      assert.deepEqual(JSON.parse(await readFile(join(hostRegistryDirectory(f.registryRoot), 'domain-intent.json'))),
        { version: 3, layout: 'per-store' })
      throw new Error('injected pre-metadata failure')
    }
    return openUnit.call(this, descriptor)
  })
  await assert.rejects(create(f, target), /injected pre-metadata failure/)
  mock.mock.restore()
  await assert.rejects(readFile(join(hostRegistryDirectory(f.registryRoot), intentName(target))), { code: 'ENOENT' })
  assert.ok(await readFile(unrelatedIntent))
  await create(f, target)
})

test('legacy-to-layout conversion is restartable without inventing a prepared phase', async t => {
  const f = await fixture(t)
  const first = await create(f)
  const record = (await registry(f)).domains[0]
  const empty = { schemaVersion: 1, domains: [] }
  const dir = hostRegistryDirectory(f.registryRoot)
  await writeFile(join(dir, 'domains.json'), JSON.stringify(empty))
  const legacy = { version: 1, mode: 'initialize', transactionId: randomUUID(),
    beforeRevision: createHash('sha256').update(JSON.stringify(empty)).digest('hex'),
    source: null, record: { ...record, fileIdentity: null } }
  await writeFile(join(dir, 'domain-intent.json'), JSON.stringify(legacy))
  await saveIntent(f, { version: 2, mode: legacy.mode, transactionId: legacy.transactionId,
    targetBefore: null, source: null, record: legacy.record })
  assert.equal((await inspectHostDomain(f)).problem, 'pending-intent')
  await create(f, join(f.dir, 'unrelated.sqlite'))
  assert.equal((await create(f)).dataDomainRef, first.dataDomainRef)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'domain-intent.json'))), { version: 3, layout: 'per-store' })
  assert.equal((await registry(f)).domains.length, 2)
  assert.equal((await findHostDomain(f)).domainId, first.dataDomainRef)
})

test('v3 initialization replays each metadata/registry boundary with the original IDs', async t => {
  const f = await fixture(t)
  await create(f)
  const target = join(f.dir, 'target.sqlite')
  const intent = await prepared(f, target)
  const path = await saveIntent(f, intent)
  assert.equal((await create(f, target)).dataDomainRef, intent.record.domainId)
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  const registered = await registry(f)
  registered.domains = registered.domains.filter(item => item.canonicalStore !== target)
  await writeFile(join(hostRegistryDirectory(f.registryRoot), 'domains.json'), JSON.stringify(registered))
  await saveIntent(f, { ...intent, phase: 'writing' })
  await create(f, join(f.dir, 'unrelated.sqlite'))
  assert.equal((await create(f, target)).registrationId, intent.record.registrationId)
  await saveIntent(f, { ...intent, phase: 'writing' })
  assert.equal((await create(f, target)).dataDomainRef, intent.record.domainId)
  await assert.rejects(readFile(path), { code: 'ENOENT' })
})

test('a write followed by target disappearance retains the intent instead of automatic cleanup', async t => {
  const f = await fixture(t)
  await create(f)
  const target = join(f.dir, 'disappearing.sqlite')
  const close = StorageSqlite.SqliteStorageBackend.prototype.close
  let closes = 0
  const mock = t.mock.method(StorageSqlite.SqliteStorageBackend.prototype, 'close', async function () {
    await close.call(this)
    if (++closes === 1) await rename(target, `${target}.persisted`)
  })
  await assert.rejects(create(f, target), reason('domain-registration-mismatch'))
  mock.mock.restore()
  const path = join(hostRegistryDirectory(f.registryRoot), intentName(target))
  const intent = JSON.parse(await readFile(path))
  assert.equal(intent.phase, 'writing')
  const missing = await inspectHostDomain({ ...f, store: target })
  assert.deepEqual(missing.availableModes, [])
  await assert.rejects(abandon(f, target, missing), reason('domain-registration-mismatch'))
  await assert.rejects(create(f, target), reason('domain-registration-mismatch'))
  await rename(`${target}.persisted`, target)
  assert.equal((await create(f, target)).dataDomainRef, intent.record.domainId)
})


test('a stale initialization journal cannot overwrite the same domain registered at another path', async t => {
  const f = await fixture(t)
  const first = await create(f)
  const original = (await registry(f)).domains[0]
  const target = join(f.dir, 'moved.sqlite')
  await copyFile(f.store, target)
  const diagnosis = await inspectHostDomain({ ...f, store: target })
  await recoverHostDomain({ store: target, registryRoot: f.registryRoot, mode: 'migrate',
    expectedDiagnostic: diagnosis.diagnosticRevision, confirm: true, verifySourceRetired: () => true })
  await saveIntent(f, { version: 2, mode: 'initialize', transactionId: randomUUID(),
    targetBefore: null, source: null, record: original })
  await assert.rejects(create(f), reason('domain-registration-mismatch'))
  assert.equal((await registry(f)).domains[0].canonicalStore, target)
  assert.equal((await findHostDomain({ ...f, store: target })).domainId, first.dataDomainRef)
})
