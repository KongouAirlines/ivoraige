import test from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { Context, Storage, StorageSqlite, StorageDomain } from '../dist/dsh.mjs'
import { Records } from '../src/records.mjs'
import { OperationCatalog } from '../src/operation-catalog.mjs'
import { Operations } from '../src/operations.mjs'
import { CoreOperations } from '../src/core-operations.mjs'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { runCli } from '../src/cli.mjs'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { managedPathKey, sameDirectory } from '../src/managed-path.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-q02-'))
  const store = join(dir, 'store.sqlite')
  let app = await createApp({ store })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { dir, get app() { return app }, async restart() { await app.dispose(); app = await createApp({ store }) } }
}
async function document(app, sourceId = 'q02') {
  return (await app.records.importDocument({ format: 'txt', content: 'Original text.' },
    { sourceId, language: 'en', origin: 'cli' })).document
}
async function artifact(app, doc, out) {
  const result = await app.exporter.exportDocument(doc.id, { contentMode: 'source',
    outputs: [{ format: 'md', ...(out ? { out } : {}) }] })
  return { ...result.artifacts[0], snapshotId: result.snapshotId }
}

test('failed export requires explicit abandon; record-only deletion retains external bytes and releases snapshot', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const out = join(f.dir, 'external.txt')
  const item = await artifact(f.app, doc, out)
  const task = await f.app.records.createOperationTask(doc.id, { kind: 'export', snapshotId: item.snapshotId,
    outputs: [{ format: 'md', out }] })
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'failed',
    error: { stage: 'export', message: 'synthetic failure' } }))
  await assert.rejects(f.app.tasks.cancel(task.id), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(f.app.records.deleteArtifact(doc.id, item.id), { code: 'CONFLICT' })
  await assert.rejects(f.app.records.deleteSnapshot(doc.id, item.snapshotId), { code: 'CONFLICT' })
  const abandoned = await f.app.operations.invoke('abandonTask', { taskId: task.id })
  assert.equal(abandoned.task.state, 'abandoned')
  assert.equal(f.app.records.record(doc.id).schemaVersion, 3)
  await assert.rejects(f.app.tasks.resume(task.id), { code: 'PRECONDITION_FAILED' })
  const removed = await f.app.operations.invoke('deleteArtifact', { docId: doc.id, artifactId: item.id })
  assert.equal(removed.recordDeleted, true)
  assert.equal(removed.fileDeleted, false)
  assert.match(await readFile(out, 'utf8'), /Original text\./)
  await f.app.records.deleteSnapshot(doc.id, item.snapshotId)
  await f.restart()
  assert.equal(f.app.records.getTask(task.id).state, 'abandoned')
  assert.deepEqual(f.app.records.listArtifacts(doc.id), [])
  assert.match(await readFile(out, 'utf8'), /Original text\./)
})

test('managed bytes require explicit deletion, pending cleanup is durable and retryable', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc)
  assert.equal(item.managedFile, true)
  const originalUnlink = f.app.operations.removeOwnedFile
  f.app.operations.removeOwnedFile = async () => { throw new Error('synthetic unlink failure') }
  const failed = await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })
  assert.equal(failed.cleanupPending, true)
  assert.equal(failed.fileDeleted, false)
  assert.equal((await f.app.operations.invoke('listArtifactCleanup', { docId: doc.id })).items[0].state, 'failed')
  await assert.rejects(f.app.records.deleteSnapshot(doc.id, item.snapshotId), { code: 'CONFLICT' })
  await assert.rejects(f.app.records.addArtifact(doc.id, { snapshotId: item.snapshotId,
    format: 'md', path: item.path }), { code: 'CONFLICT' })
  f.app.operations.removeOwnedFile = originalUnlink
  await f.restart()
  const retried = await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })
  assert.equal(retried.fileDeleted, true)
  await assert.rejects(stat(item.path), { code: 'ENOENT' })
  assert.deepEqual(f.app.records.listArtifactCleanup(doc.id), [])
  await f.app.records.deleteSnapshot(doc.id, item.snapshotId)
})

test('missing managed-file services reject deletion before touching the record', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const managed = await artifact(f.app, doc)
  const external = await artifact(f.app, doc, join(f.dir, 'external.txt'))
  const originalGet = f.app.ctx.get.bind(f.app.ctx)
  f.app.ctx.get = name => name === 'ivoraige.resources' ? undefined : originalGet(name)
  try {
    await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
      artifactId: managed.id, fileAction: 'delete-owned' }), { code: 'COMPONENT_MISSING' })
    assert.ok(f.app.records.listArtifacts(doc.id).some(item => item.id === managed.id))
    assert.deepEqual(f.app.records.listArtifactCleanup(doc.id), [])
    assert.equal((await stat(managed.path)).isFile(), true)
    const removed = await f.app.operations.invoke('deleteArtifact', { docId: doc.id, artifactId: external.id })
    assert.equal(removed.recordDeleted, true)
    assert.equal((await stat(external.path)).isFile(), true)
  } finally { f.app.ctx.get = originalGet }
})

test('minimal Records composition rejects owned deletion before writes and permits record-only deletion', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-minimal-records-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(dir, 'store.sqlite') })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(Records)
  await ctx.get('ivoraige.records').ready
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(Operations)
  await ctx.plugin(CoreOperations)
  const records = ctx.get('ivoraige.records'), ops = ctx.get('ivoraige.operations')
  const doc = (await records.persistParsed({}, { language: 'en', origin: 'cli' }, {
    format: 'txt', title: 'Minimal', availableOutputs: [], sourceBinding: { adapterId: 'txt' },
    sourceAdapterId: 'txt', sourceAdapterVersion: 'unversioned', bindingSchemaVersion: 1,
    units: [{ order: 0, kind: 'body', sourceText: 'minimal', locator: { paragraph: 1 }, translatable: true }],
    chapters: [], resources: [],
  })).document
  const snapshot = await records.createSnapshot(doc.id, { contentMode: 'source' })
  const path = join(dir, 'managed.txt')
  await writeFile(path, 'managed bytes')
  const item = await records.addArtifact(doc.id, { snapshotId: snapshot.id, format: 'md', path,
    managedFile: true, fileDigest: createHash('sha256').update('managed bytes').digest('hex') })
  await assert.rejects(ops.invoke('deleteArtifact', { docId: doc.id, artifactId: item.id,
    fileAction: 'delete-owned' }), { code: 'COMPONENT_MISSING' })
  assert.ok(records.listArtifacts(doc.id).some(value => value.id === item.id))
  assert.deepEqual(records.listArtifactCleanup(doc.id), [])
  assert.equal((await stat(path)).isFile(), true)
  assert.equal((await ops.invoke('deleteArtifact', { docId: doc.id, artifactId: item.id })).recordDeleted, true)
  assert.equal((await stat(path)).isFile(), true)
})

test('managed directory identity and shared references follow aliases without admitting outside paths', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc)
  const root = f.app.exporter.root
  const alias = join(f.dir, 'export-alias')
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const aliasPath = join(alias, basename(item.path))
  assert.equal(await sameDirectory(alias, root), true)
  assert.equal(managedPathKey(aliasPath), managedPathKey(item.path))
  if (process.platform === 'win32') {
    assert.equal(await sameDirectory(root.toUpperCase(), root), true)
    assert.equal(managedPathKey(item.path.toUpperCase()), managedPathKey(item.path))
  }
  const upper = join(f.dir, 'CaseSensitive')
  const lower = join(f.dir, 'casesensitive')
  await mkdir(upper)
  try { await mkdir(lower) } catch (error) { if (error.code !== 'EEXIST') throw error }
  if ((await stat(upper)).ino !== (await stat(lower)).ino) {
    assert.equal(await sameDirectory(upper, lower), false)
    assert.notEqual(managedPathKey(join(upper, 'sample.md')),
      managedPathKey(join(lower, 'sample.md')))
  }
  const other = await document(f.app, 'alias-shared')
  const snapshot = await f.app.records.createSnapshot(other.id, { contentMode: 'source' })
  const shared = await f.app.records.addArtifact(other.id, { snapshotId: snapshot.id,
    format: 'md', path: aliasPath })
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  await f.app.records.deleteArtifact(other.id, shared.id)
  const outside = join(f.dir, 'outside.md')
  const bytes = await readFile(item.path)
  await writeFile(outside, bytes)
  await assert.rejects(f.app.operations.removeOwnedFile(outside,
    createHash('sha256').update(bytes).digest('hex')), { code: 'PRECONDITION_FAILED' })
  f.app.exporter.root = alias
  assert.equal((await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })).fileDeleted, true)
  assert.equal((await readFile(outside)).equals(bytes), true)
})

test('a file symlink in another directory shares its canonical target identity', async t => {
  const f = await fixture(t)
  const owner = await document(f.app, 'file-symlink-owner')
  const item = await artifact(f.app, owner)
  const aliasDir = join(f.dir, 'separate-alias-dir')
  await mkdir(aliasDir)
  const aliasPath = join(aliasDir, 'different-name.md')
  try { await symlink(item.path, aliasPath, 'file') }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows sandbox denies file symlink creation (EPERM)')
      return
    }
    throw error
  }
  assert.equal(managedPathKey(aliasPath), managedPathKey(item.path))
  const sameDocument = await f.app.records.addArtifact(owner.id, { snapshotId: item.snapshotId,
    format: 'md', path: aliasPath })
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  assert.equal((await f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: sameDocument.id })).fileDeleted, false)
  const other = await document(f.app, 'file-symlink-reference')
  const snapshot = await f.app.records.createSnapshot(other.id, { contentMode: 'source' })
  const shared = await f.app.records.addArtifact(other.id, { snapshotId: snapshot.id,
    format: 'md', path: aliasPath })
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  assert.match(await readFile(aliasPath, 'utf8'), /Original text\./)
  assert.equal((await f.app.operations.invoke('deleteArtifact', { docId: other.id,
    artifactId: shared.id })).fileDeleted, false)
  assert.match(await readFile(aliasPath, 'utf8'), /Original text\./)
  assert.equal((await f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: item.id, fileAction: 'delete-owned' })).fileDeleted, true)
  assert.throws(() => managedPathKey(aliasPath), { code: 'PRECONDITION_FAILED' })
})

test('ordinary file identity preserves case-sensitive distinctions and insensitive aliases', async t => {
  const f = await fixture(t)
  const upper = join(f.dir, 'CaseSensitive')
  const lower = join(f.dir, 'casesensitive')
  await mkdir(upper)
  try { await mkdir(lower) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const target = join(upper, 'Sample.md')
  await writeFile(target, 'synthetic')
  assert.equal(managedPathKey(target), managedPathKey(join(upper, '.', 'Sample.md')))
  const alias = target.toUpperCase()
  const aliasInfo = await stat(alias).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  const targetInfo = await stat(target)
  if (aliasInfo && aliasInfo.ino === targetInfo.ino && aliasInfo.dev === targetInfo.dev)
    assert.equal(managedPathKey(alias), managedPathKey(target))
  if ((await stat(upper)).ino !== (await stat(lower)).ino)
    assert.notEqual(managedPathKey(join(upper, 'Sample.md')), managedPathKey(join(lower, 'Sample.md')))
})

test('missing managed exporter rejects physical deletion before a tombstone but permits record deletion', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc)
  const ctx = f.app.operations.ctx
  const originalGet = ctx.get
  ctx.get = function (name) { return name === 'ivoraige.export' ? undefined : originalGet.call(this, name) }
  try {
    await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
      artifactId: item.id, fileAction: 'delete-owned' }), { code: 'COMPONENT_MISSING' })
    assert.equal(f.app.records.listArtifacts(doc.id).length, 1)
    assert.deepEqual(f.app.records.listArtifactCleanup(doc.id), [])
    assert.equal((await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
      artifactId: item.id })).fileDeleted, false)
  } finally { ctx.get = originalGet }
  assert.match(await readFile(item.path, 'utf8'), /Original text\./)
})

test('record-only deletion needs no filesystem identity lookup', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc, join(f.dir, 'external.md'))
  const original = f.app.records.pathKey
  f.app.records.pathKey = () => { throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' }) }
  try {
    const removed = await f.app.operations.invoke('deleteArtifact', { docId: doc.id, artifactId: item.id })
    assert.equal(removed.recordDeleted, true)
    assert.equal(removed.fileDeleted, false)
    assert.equal(removed.retainedPath, item.path)
  } finally { f.app.records.pathKey = original }
  assert.match(await readFile(item.path, 'utf8'), /Original text\./)
})

test('record-only deletion retains metadata semantics when the file is missing', async t => {
  const f = await fixture(t)
  const doc = await document(f.app, 'missing-retain')
  const out = join(f.dir, 'missing-external.md')
  const item = await artifact(f.app, doc, out)
  await rm(out)
  const removed = await f.app.operations.invoke('deleteArtifact', { docId: doc.id, artifactId: item.id })
  assert.equal(removed.recordDeleted, true)
  assert.equal(removed.fileDeleted, false)
  assert.equal(removed.retainedPath, out)
  assert.deepEqual(f.app.records.listArtifacts(doc.id), [])
})

test('artifact read lease and shared path block owned-file deletion; external and legacy files stay protected', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc)
  const reader = f.app.operations.artifact(item.id, { retain: true })
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  reader.release()
  const other = await document(f.app, 'other')
  const otherSnapshot = await f.app.records.createSnapshot(other.id, { contentMode: 'source' })
  const shared = await f.app.records.addArtifact(other.id, { snapshotId: otherSnapshot.id,
    format: 'md', path: item.path })
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  await f.app.records.deleteArtifact(other.id, shared.id)
  const external = await artifact(f.app, doc, join(f.dir, 'external.txt'))
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: external.id, fileAction: 'delete-owned' }), { code: 'PRECONDITION_FAILED' })
  const deleted = await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })
  assert.equal(deleted.fileDeleted, true)
  assert.match(await readFile(external.path, 'utf8'), /Original text\./)
})

test('owned deletion reservation blocks new snapshot lease and same-path artifact through durable write', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc)
  let releaseGate
  let entered
  const enteredGate = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { releaseGate = resolve })
  const original = f.app.operations.removeOwnedFile.bind(f.app.operations)
  f.app.operations.removeOwnedFile = async (path, digest) => { entered(); await gate; return original(path, digest) }
  const deletion = f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })
  await enteredGate
  assert.equal(f.app.records.listArtifactCleanup(doc.id)[0].state, 'pending')
  assert.throws(() => f.app.records.retainSnapshot(doc.id, item.snapshotId), { code: 'CONFLICT' })
  await assert.rejects(f.app.records.addArtifact(doc.id, { snapshotId: item.snapshotId,
    format: 'md', path: item.path }), { code: 'CONFLICT' })
  releaseGate()
  assert.equal((await deletion).fileDeleted, true)
})

test('an earlier artifact backend write blocks owned deletion before the new shared ref is visible', async t => {
  const f = await fixture(t)
  const owner = await document(f.app)
  const item = await artifact(f.app, owner)
  const other = await document(f.app, 'pending-shared')
  const snapshot = await f.app.records.createSnapshot(other.id, { contentMode: 'source' })
  const unit = f.app.records.table.host.unit
  const original = unit.putRecord.bind(unit)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  unit.putRecord = async (table, key, value) => {
    if (key === other.id && value.artifacts?.some(candidate => candidate.path === item.path)) {
      enter(); await gate
    }
    return original(table, key, value)
  }
  const adding = f.app.records.addArtifact(other.id, { snapshotId: snapshot.id, format: 'md', path: item.path })
  await entered
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  release()
  const shared = await adding
  unit.putRecord = original
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: item.id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  await f.app.records.deleteArtifact(other.id, shared.id)
  assert.equal((await f.app.operations.invoke('deleteArtifact', { docId: owner.id,
    artifactId: item.id, fileAction: 'delete-owned' })).fileDeleted, true)
})

test('two artifacts on one snapshot cannot race away the snapshot deletion reservation', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const { artifacts, snapshotId } = await f.app.exporter.exportDocument(doc.id, { contentMode: 'source',
    outputs: [{ format: 'md' }, { format: 'json' }] })
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const original = f.app.operations.removeOwnedFile.bind(f.app.operations)
  f.app.operations.removeOwnedFile = async (path, digest) => {
    if (path === artifacts[0].path) { enter(); await gate }
    return original(path, digest)
  }
  const first = f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: artifacts[0].id, fileAction: 'delete-owned' })
  await entered
  await assert.rejects(f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: artifacts[1].id, fileAction: 'delete-owned' }), { code: 'CONFLICT' })
  assert.throws(() => f.app.records.retainSnapshot(doc.id, snapshotId), { code: 'CONFLICT' })
  release()
  assert.equal((await first).fileDeleted, true)
  const second = await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: artifacts[1].id, fileAction: 'delete-owned' })
  assert.equal(second.fileDeleted, true)
  await f.app.records.deleteSnapshot(doc.id, snapshotId)
})

test('active task, snapshot lease, and embedded task artifact checkpoints protect bytes', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const snapshot = await f.app.records.createSnapshot(doc.id, { contentMode: 'source' })
  const task = await f.app.records.createOperationTask(doc.id, { kind: 'export', snapshotId: snapshot.id,
    outputs: [{ format: 'md' }] })
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'running' }))
  const path = join(f.dir, 'exports', 'checkpoint.md')
  await (await import('node:fs/promises')).mkdir(join(f.dir, 'exports'))
  await writeFile(path, 'checkpoint')
  const item = await f.app.records.addArtifact(doc.id, { snapshotId: snapshot.id, format: 'md', path,
    taskId: task.id, outputIndex: 0, managedFile: true,
    fileDigest: createHash('sha256').update('checkpoint').digest('hex') })
  assert.equal(f.app.records.getTask(task.id).artifacts[0].id, item.id)
  await assert.rejects(f.app.records.deleteArtifact(doc.id, item.id), { code: 'CONFLICT' })
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'succeeded' }))
  const release = f.app.records.retainSnapshot(doc.id, snapshot.id)
  await assert.rejects(f.app.records.deleteArtifact(doc.id, item.id), { code: 'CONFLICT' })
  release()
  await f.app.records.deleteArtifact(doc.id, item.id)
  assert.deepEqual(f.app.records.getTask(task.id).artifacts, [])
  assert.equal(await readFile(path, 'utf8'), 'checkpoint')
  await f.app.records.deleteSnapshot(doc.id, snapshot.id)
})

test('snapshot deletion reserves before backend commit and rejects a late lease or export task', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const snapshot = await f.app.records.createSnapshot(doc.id, { contentMode: 'source' })
  const unit = f.app.records.table.host.unit
  const original = unit.putRecord.bind(unit)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  unit.putRecord = async (table, key, value) => {
    if (key === doc.id && !value.snapshots?.some(candidate => candidate.id === snapshot.id)) {
      enter(); await gate
    }
    return original(table, key, value)
  }
  const deletion = f.app.records.deleteSnapshot(doc.id, snapshot.id)
  await entered
  assert.throws(() => f.app.records.retainSnapshot(doc.id, snapshot.id), { code: 'CONFLICT' })
  const lateTask = f.app.records.createOperationTask(doc.id, { kind: 'export', snapshotId: snapshot.id,
    outputs: [{ format: 'md' }] })
  release()
  await deletion
  await assert.rejects(lateTask)
  unit.putRecord = original
  assert.equal(f.app.records.listSnapshots(doc.id).length, 0)
})

test('schema 3 is opt-in per document and unknown future versions reject writes', async t => {
  const f = await fixture(t)
  const first = await document(f.app)
  const second = await document(f.app, 'untouched')
  assert.equal(f.app.records.record(first.id).schemaVersion, 2)
  assert.equal(f.app.records.record(second.id).schemaVersion, 2)
  const item = await artifact(f.app, first)
  assert.equal(f.app.records.record(first.id).schemaVersion, 3)
  assert.equal(f.app.records.record(second.id).schemaVersion, 2)
  const record = f.app.records.record(second.id)
  await f.app.records.table.put(second.id, { ...record, schemaVersion: 4 })
  await assert.rejects(f.app.records.createSnapshot(second.id, { contentMode: 'source' }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal((await readFile(item.path, 'utf8')).includes('Original text.'), true)
})

test('first Q02 write upgrades a v1 record directly to schema 3 without losing legacy source IR', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const snapshot = await f.app.records.createSnapshot(doc.id, { contentMode: 'source' })
  const task = await f.app.records.createOperationTask(doc.id, { kind: 'export', snapshotId: snapshot.id,
    outputs: [{ format: 'md' }] })
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'failed',
    error: { stage: 'export', message: 'synthetic failure' } }))
  const { sourceIR, ...legacy } = f.app.records.record(doc.id)
  await f.app.records.table.put(doc.id, { ...legacy, schemaVersion: 1 })
  await f.app.tasks.abandon(task.id)
  const upgraded = f.app.records.record(doc.id)
  assert.equal(upgraded.schemaVersion, 3)
  assert.equal(upgraded.sourceIR.version, 1)
  assert.equal(upgraded.sourceIR.legacy, true)
  await f.restart()
  assert.equal(f.app.records.getTask(task.id).state, 'abandoned')
})

test('replaced managed bytes are retained with a retryable cleanup record', async t => {
  const f = await fixture(t)
  const doc = await document(f.app)
  const item = await artifact(f.app, doc)
  await writeFile(item.path, 'replacement bytes')
  const result = await f.app.operations.invoke('deleteArtifact', { docId: doc.id,
    artifactId: item.id, fileAction: 'delete-owned' })
  assert.equal(result.cleanupPending, true)
  assert.match(result.cleanupError, /bytes changed/)
  assert.equal(await readFile(item.path, 'utf8'), 'replacement bytes')
  await assert.rejects(f.app.records.deleteSnapshot(doc.id, item.snapshotId), { code: 'CONFLICT' })
  assert.equal(f.app.records.listArtifactCleanup(doc.id)[0].artifactId, item.id)
})

test('relocated export root clears absent owned files but never deletes a still-present old-root file', async t => {
  for (const missing of ['file', 'parent', null]) {
    const dir = await mkdtemp(join(tmpdir(), 'ivoraige-q02-relocation-'))
    const store = join(dir, 'store.sqlite')
    const oldRoot = join(dir, 'exports-1')
    const newRoot = join(dir, 'exports-2')
    let app
    try {
      app = await createApp({ store, exportDir: oldRoot })
      const doc = await document(app)
      const item = await artifact(app, doc)
      app.operations.removeOwnedFile = async () => { throw new Error('synthetic cleanup interruption') }
      const interrupted = await app.operations.invoke('deleteArtifact', { docId: doc.id,
        artifactId: item.id, fileAction: 'delete-owned' })
      assert.equal(interrupted.cleanupPending, true)
      await app.dispose(); app = undefined
      if (missing === 'file') await rm(item.path)
      if (missing === 'parent') await rm(oldRoot, { recursive: true })
      app = await createApp({ store, exportDir: newRoot })
      const result = await app.operations.invoke('deleteArtifact', { docId: doc.id,
        artifactId: item.id, fileAction: 'delete-owned' })
      if (missing) {
        assert.equal(result.fileDeleted, true, `absent ${missing} must clear cleanup`)
        assert.deepEqual(app.records.listArtifactCleanup(doc.id), [])
        await app.records.deleteSnapshot(doc.id, item.snapshotId)
      } else {
        assert.equal(result.cleanupPending, true)
        assert.equal((await stat(item.path)).isFile(), true)
        await assert.rejects(app.records.deleteSnapshot(doc.id, item.snapshotId), { code: 'CONFLICT' })
      }
    } finally {
      await app?.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test('HTTP, CLI and MCP expose the same explicit retention and abandon operations', async t => {
  const f = await fixture(t)
  const server = await serve(f.app, { port: 0 })
  const client = new Client({ name: 'q02-test', version: '1.0.0' })
  t.after(async () => { await client.close(); await server.close() })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)))
  const doc = await document(f.app)
  const [httpArtifact, cliArtifact, cliOwned, mcpArtifact] = await Promise.all([
    artifact(f.app, doc), artifact(f.app, doc), artifact(f.app, doc), artifact(f.app, doc),
  ])
  const http = await fetch(`${server.url}/api/documents/${doc.id}/artifacts/${httpArtifact.id}?fileAction=delete-owned`,
    { method: 'DELETE' })
  assert.equal(http.status, 200)
  assert.equal((await http.json()).fileDeleted, true)
  let output = ''
  const cli = await runCli(['--url', server.url, '--json', 'artifacts', doc.id, 'delete', cliArtifact.id],
    { stdout: { write(chunk) { output += chunk } }, stderr: { write() {} } })
  assert.equal(cli, 0)
  assert.equal(JSON.parse(output).fileDeleted, false)
  assert.equal((await stat(cliArtifact.path)).isFile(), true)
  output = ''
  assert.equal(await runCli(['--url', server.url, '--json', 'artifacts', doc.id, 'delete', cliOwned.id,
    '--file-action', 'delete-owned'],
  { stdout: { write(chunk) { output += chunk } }, stderr: { write() {} } }), 0)
  assert.equal(JSON.parse(output).fileDeleted, true)
  await assert.rejects(stat(cliOwned.path), { code: 'ENOENT' })
  const mcp = await client.callTool({ name: 'ivoraige_artifact_delete', arguments: {
    docId: doc.id, artifactId: mcpArtifact.id, fileAction: 'delete-owned',
  } })
  assert.equal(mcp.isError, undefined)
  assert.equal(mcp.structuredContent.fileDeleted, true)
  const failed = async () => {
    const task = await f.app.records.createImportTask('synthetic failure')
    await f.app.records.updateTask(task.id, current => ({ ...current, state: 'failed',
      error: { stage: 'import', message: 'synthetic failure' } }))
    return task.id
  }
  const httpTask = await failed()
  const httpAbandon = await fetch(`${server.url}/api/tasks/${httpTask}/abandon`, { method: 'POST' })
  assert.equal((await httpAbandon.json()).task.state, 'abandoned')
  const cliTask = await failed()
  output = ''
  assert.equal(await runCli(['--url', server.url, '--json', 'abandon', cliTask],
    { stdout: { write(chunk) { output += chunk } }, stderr: { write() {} } }), 0)
  assert.equal(JSON.parse(output).task.state, 'abandoned')
  const mcpTask = await failed()
  const mcpAbandon = await client.callTool({ name: 'ivoraige_task_abandon', arguments: { taskId: mcpTask } })
  assert.equal(mcpAbandon.isError, undefined)
  assert.equal(mcpAbandon.structuredContent.task.state, 'abandoned')
})

for (const step of ['stat', 'readFile', 'unlink']) for (const missing of ['file', 'directory']) {
  test(`managed cleanup completes when ${missing} disappears at ${step}`, async t => {
    const f = await fixture(t)
    const doc = await document(f.app)
    const item = await artifact(f.app, doc)
    const original = fs[step]
    let raced = false
    fs[step] = async (path, ...args) => {
      if (path === (step === 'stat' ? f.app.exporter.root : item.path) && !raced) {
        raced = true
        if (missing === 'file') await rm(item.path)
        else {
          await rm(f.app.exporter.root, { recursive: true })
          await writeFile(f.app.exporter.root, 'directory replaced')
        }
      }
      return original(path, ...args)
    }
    syncBuiltinESMExports()
    let removed
    try {
      removed = await f.app.operations.invoke('deleteArtifact', {
        docId: doc.id, artifactId: item.id, fileAction: 'delete-owned',
      })
    } finally { fs[step] = original; syncBuiltinESMExports() }
    assert.equal(raced, true)
    assert.equal(removed.fileDeleted, true)
    assert.deepEqual(f.app.records.listArtifactCleanup(doc.id), [])
    await f.app.records.deleteSnapshot(doc.id, item.snapshotId)
  })
}

for (const step of ['readFile', 'unlink']) {
  test(`managed cleanup retains pending marker on ${step} permission failure`, async t => {
    const f = await fixture(t)
    const doc = await document(f.app)
    const item = await artifact(f.app, doc)
    const original = fs[step]
    fs[step] = async (path, ...args) => {
      if (path === item.path) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return original(path, ...args)
    }
    syncBuiltinESMExports()
    let removed
    try {
      removed = await f.app.operations.invoke('deleteArtifact', {
        docId: doc.id, artifactId: item.id, fileAction: 'delete-owned',
      })
    } finally { fs[step] = original; syncBuiltinESMExports() }
    assert.equal(removed.cleanupPending, true)
    assert.equal(removed.fileDeleted, false)
    assert.equal(f.app.records.listArtifactCleanup(doc.id)[0].state, 'failed')
    assert.match(await readFile(item.path, 'utf8'), /Original text/)
    await assert.rejects(f.app.records.deleteSnapshot(doc.id, item.snapshotId), { code: 'CONFLICT' })
  })
}
