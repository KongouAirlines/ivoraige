import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { Context, Storage, StorageDomain, StorageSqlite, z } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { Records } from '../src/records.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-retention-domain-'))
  const store = join(dir, 'synthetic.sqlite')
  let app = await createApp({ store })
  t.after(async () => { await app?.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { store, get app() { return app }, async close() { await app?.dispose(); app = undefined },
    async reopen() { app = await createApp({ store }); return app } }
}

function version(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  try { return db.prepare("SELECT version FROM units WHERE name = 'ivoraige_records'").get()?.version }
  finally { db.close() }
}

function stamp(store, value) {
  const db = new DatabaseSync(store)
  try { assert.equal(db.prepare("UPDATE units SET version = ? WHERE name = 'ivoraige_records'").run(value).changes, 1) }
  finally { db.close() }
}

function editDocument(store, docId, transform) {
  const db = new DatabaseSync(store)
  try {
    const table = 'u_ivoraige_records_documents'
    const record = JSON.parse(db.prepare(`SELECT value FROM "${table}" WHERE key = ?`).get(docId).value)
    assert.equal(db.prepare(`UPDATE "${table}" SET value = ? WHERE key = ?`).run(
      JSON.stringify(transform(record)), docId).changes, 1)
  } finally { db.close() }
}

async function document(app) {
  return (await app.records.importDocument({ format: 'txt', content: 'Synthetic text.' },
    { sourceId: 'domain-gate', language: 'en' })).document
}

async function assertOldReaderRejects(store) {
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageSqlite, { path: store })
    await ctx.plugin(StorageDomain, { backend: 'sqlite' })
    const oldSpec = StorageDomain.defineDomain({ name: 'ivoraige_records', version: 1,
      layout: 'per-record', tables: { documents: StorageDomain.domainTable(z.unknown()),
        imports: StorageDomain.domainTable(z.unknown()) } })
    await assert.rejects(ctx.get('storageDomain').open(oldSpec), error =>
      error.code === 'version-mismatch' && /stamped version 2/.test(error.message))
  } finally { await ctx.fiber.dispose() }
}

test('embedding a version-1 Records service requires an activation callback', () => {
  assert.throws(() => new Records({}, { storageVersion: 1 }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => new Records({}, { storageVersion: 99 }), { code: 'INVALID_ARGUMENT' })
})

test('new store starts at domain 2; old domain 1 permits normal writes until first Q02 semantic write', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  assert.equal(version(f.store), 2)
  await f.close()
  stamp(f.store, 1)
  const app = await f.reopen()
  assert.equal(app.records.record(doc.id).schemaVersion, 2)
  await assert.rejects(app.records.update(doc.id, current => ({ ...current, schemaVersion: 3,
    artifacts: 'invalid' })))
  assert.equal(version(f.store), 1, 'invalid Q02 transform cannot activate the domain')
  const snapshot = await app.records.createSnapshot(doc.id, { contentMode: 'source' })
  assert.equal(version(f.store), 1, 'ordinary snapshot write keeps the old domain')
  assert.equal(app.records.record(doc.id).schemaVersion, 2)
  const item = (await app.exporter.exportDocument(doc.id, { contentMode: 'source',
    outputs: [{ format: 'md' }] })).artifacts[0]
  assert.equal(item.managedFile, true)
  assert.equal(version(f.store), 2)
  assert.equal(app.records.record(doc.id).schemaVersion, 3)
  assert.ok(app.records.listSnapshots(doc.id).some(value => value.id === snapshot.id))
  await f.close()
  await assertOldReaderRejects(f.store)
  assert.equal((await f.reopen()).records.record(doc.id).artifacts[0].id, item.id)
})

test('domain promotion precedes the Q02 row put and remains safe after a failed put', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  await f.close()
  stamp(f.store, 1)
  const app = await f.reopen()
  const unit = app.records.table.host.unit
  const put = unit.putRecord.bind(unit)
  unit.putRecord = async (table, key, value) => {
    if (table === 'documents' && value.schemaVersion === 3) throw new Error('synthetic Q02 row put failure')
    return put(table, key, value)
  }
  try {
    await assert.rejects(app.records.update(doc.id, current => ({ ...current, schemaVersion: 3 })),
      /synthetic Q02 row put failure/)
  } finally { unit.putRecord = put }
  assert.equal(version(f.store), 2, 'old binary is fenced before any Q02 row write')
  assert.equal(app.records.record(doc.id).schemaVersion, 2, 'failed row put retained the old record')
  await f.close()
  await assertOldReaderRejects(f.store)
  assert.equal((await f.reopen()).records.record(doc.id).schemaVersion, 2)
})

test('abandoned import uses the same domain gate; existing Q02 payload under unit 1 is fenced on boot', async t => {
  const f = await fixture(t)
  const task = await f.app.records.createImportTask('synthetic')
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'failed' }))
  await f.close()
  stamp(f.store, 1)
  const app = await f.reopen()
  assert.equal(version(f.store), 1)
  await app.records.abandonTask(task.id)
  assert.equal(version(f.store), 2)
  assert.equal(app.records.getTask(task.id).state, 'abandoned')
  await f.close()
  stamp(f.store, 1) // Simulate the already-written Q02 payload beneath an old header.
  const recovered = await f.reopen()
  assert.equal(version(f.store), 2)
  assert.equal(recovered.records.getTask(task.id).state, 'abandoned')
})

test('pending cleanup beneath an old header is fenced before loading Records', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = (await f.app.exporter.exportDocument(doc.id, { contentMode: 'source',
    outputs: [{ format: 'md' }] })).artifacts[0]
  f.app.operations.removeOwnedFile = async () => { throw new Error('synthetic unlink failure') }
  const failed = await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })
  assert.equal(failed.cleanupPending, true)
  await f.close()
  stamp(f.store, 1)
  const app = await f.reopen()
  assert.equal(version(f.store), 2)
  assert.equal(app.records.listArtifactCleanup(doc.id)[0].artifactId, item.id)
})

test('unsupported source IR on a Q02 payload cannot blindly promote an old domain', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  await f.close()
  editDocument(f.store, doc.id, record => ({ ...record, schemaVersion: 3,
    sourceIR: { ...record.sourceIR, version: 2 } }))
  stamp(f.store, 1)
  await assert.rejects(f.reopen(), { code: 'PRECONDITION_FAILED' })
  assert.equal(version(f.store), 1)
})

test('unknown storage domain version rejects before Records starts', async t => {
  const f = await fixture(t)
  await f.close()
  stamp(f.store, 99)
  await assert.rejects(f.reopen(), error => error.code === 'PRECONDITION_FAILED' && error.details?.version === 99)
  assert.equal(version(f.store), 99)
})

test('existing SQLite with incompatible pinned layout fails closed without materializing DSH tables', async t => {
  const f = await fixture(t)
  await f.close()
  const db = new DatabaseSync(f.store)
  try { db.exec('DROP TABLE u_ivoraige_records_imports') } finally { db.close() }
  await assert.rejects(f.reopen(), { code: 'PRECONDITION_FAILED' })
  const check = new DatabaseSync(f.store, { readOnly: true })
  try { assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'u_ivoraige_records_imports'").get(), undefined) }
  finally { check.close() }
})

test('unrelated SQLite file is not mistaken for a fresh DSH store', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-incompatible-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = join(dir, 'other.sqlite')
  const db = new DatabaseSync(store)
  try { db.exec('CREATE TABLE other (value TEXT)') } finally { db.close() }
  await assert.rejects(createApp({ store }), { code: 'PRECONDITION_FAILED' })
  const check = new DatabaseSync(store, { readOnly: true })
  try { assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'units'").get(), undefined) }
  finally { check.close() }
})

test('a foreign bundled DSH pin rejects before touching an existing store', async t => {
  const f = await fixture(t)
  await document(f.app)
  await f.close()
  stamp(f.store, 1)
  const before = await readFile(f.store)
  const foreign = join(f.store + '-foreign')
  await mkdir(join(foreign, 'src'), { recursive: true })
  await mkdir(join(foreign, 'dist'))
  for (const name of ['retention-domain.mjs', 'retention-payload.mjs', 'errors.mjs']) {
    await copyFile(new URL(`../src/${name}`, import.meta.url), join(foreign, 'src', name))
  }
  await writeFile(join(foreign, 'dist', 'dsh.mjs'),
    "export const IVORAIGE_DSH_COMMIT = 'foreign-build-commit'\n")
  const { inspectRetentionDomain } = await import(pathToFileURL(join(foreign, 'src', 'retention-domain.mjs')))
  assert.throws(() => inspectRetentionDomain(f.store), { code: 'PRECONDITION_FAILED' })
  assert.deepEqual(await readFile(f.store), before)
  assert.equal(version(f.store), 1)
  await rm(foreign, { recursive: true, force: true })
})
