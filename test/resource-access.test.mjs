import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-p04-resource-'))
  const app = await createApp({ store: join(dir, 'store.sqlite'), ...options })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Synthetic opaque identity.' }, { language: 'en' })
  return { app, dir, document }
}

test('resource ownership uses stored opaque unit, revision, task and artifact identity', async t => {
  const { app, document } = await fixture(t)
  const docId = document.id
  const unitId = 'unit-opaque-without-owner', revisionId = 'revision:opaque', taskId = 'import.not-an-import', artifactId = 'artifact:opaque'
  await app.records.update(docId, row => ({ ...row, units: row.units.map(unit => ({ ...unit, id: unitId })) }))
  assert.equal((await app.operations.invoke('getUnit', { unitId, docId, targetLang: 'zh' })).unit.docId, docId)
  await assert.rejects(app.operations.invoke('getUnit', { unitId, docId: 'different-document', targetLang: 'zh' }), { code: 'NOT_FOUND' })
  const saved = await app.records.writeRevision(unitId, { targetLang: 'zh', text: '合成测试', baseRevisionId: null })
  await app.records.update(docId, row => ({ ...row, revisions: row.revisions.map(revision => ({ ...revision, id: revisionId })),
    latest: Object.fromEntries(Object.entries(row.latest).map(([key, value]) => [key, value === saved.id ? revisionId : value])) }))
  await app.operations.invoke('acceptRevision', { revisionId, expectedAcceptedRevisionId: null })
  const task = await app.records.createTranslationTask(docId, { targetLang: 'zh', mode: 'fast' })
  await app.records.update(docId, row => ({ ...row, tasks: row.tasks.map(item => ({ ...item, id: taskId })) }))
  assert.equal(app.records.getTask(taskId).id, taskId)
  await app.records.updateTask(taskId, current => ({ ...current, state: 'paused' }))
  assert.equal(app.records.getTask(taskId).state, 'paused')
  const exported = await app.exporter.exportDocument(docId, { contentMode: 'source', outputs: [{ format: 'md' }] })
  await app.records.update(docId, row => ({ ...row, artifacts: row.artifacts.map(item => ({ ...item, id: artifactId })) }))
  assert.equal((await app.resources.readArtifact(artifactId)).bytes.toString(), await readFile(exported.artifacts[0].path, 'utf8'))
  const unitResource = app.mcp.resources.get('Unit')
  const good = await unitResource.read(new URL('ivoraige://docs/' + docId + '/units/' + unitId + '?targetLang=zh'), { docId, unitId, targetLang: 'zh' })
  assert.match(good.contents[0].text, /unit-opaque-without-owner/)
  await assert.rejects(unitResource.read(new URL('ivoraige://docs/wrong/units/' + unitId + '?targetLang=zh'), { docId: 'wrong', unitId, targetLang: 'zh' }), { code: 'NOT_FOUND' })
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  const download = await fetch(server.url + '/api/artifacts/' + encodeURIComponent(artifactId) + '/download')
  assert.equal(download.status, 200)
  assert.equal(await download.text(), (await app.resources.readArtifact(artifactId)).bytes.toString())
  assert.equal(app.records.artifactLeases.size, 0)
  assert.equal(task.docId, docId)
})

test('HTTP and MCP share artifact read size policy and release leases on failure', async t => {
  const { app, document } = await fixture(t, { maxArtifactBytes: 1 })
  const exported = await app.exporter.exportDocument(document.id, { contentMode: 'source', outputs: [{ format: 'md' }] })
  const artifactId = exported.artifacts[0].id
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  const response = await fetch(server.url + '/api/artifacts/' + artifactId + '/download')
  assert.equal(response.status, 412)
  assert.equal((await response.json()).error.code, 'PRECONDITION_FAILED')
  await assert.rejects(app.mcp.resources.get('Artifact').read(new URL('ivoraige://artifacts/' + artifactId), { artifactId }), { code: 'PRECONDITION_FAILED' })
  assert.equal(app.records.artifactLeases.size, 0)
  assert.equal(app.resources.opened.size, 0)
})

test('download disconnect while resource acquisition awaits cannot strand a real Records lease', async t => {
  const { app, document } = await fixture(t)
  const item = (await app.exporter.exportDocument(document.id, { contentMode: 'source', outputs: [{ format: 'md' }] })).artifacts[0]
  let release, entered, disconnected, cleaned
  const enteredPromise = new Promise(r => { entered = r }), disconnectedPromise = new Promise(r => { disconnected = r })
  const gate = new Promise(r => { release = r }), cleanedPromise = new Promise(r => { cleaned = r })
  const open = app.resources.openArtifact.bind(app.resources)
  app.resources.openArtifact = async (id, options) => {
    const resource = await open(id, options)
    const close = resource.close
    resource.close = async () => { await close(); cleaned() }
    options.signal.addEventListener('abort', disconnected, { once: true })
    entered(); await gate; return resource
  }
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  const controller = new AbortController()
  const response = fetch(server.url + '/api/artifacts/' + item.id + '/download', { signal: controller.signal })
  await enteredPromise
  assert.equal(app.records.artifactLeases.size, 1)
  controller.abort()
  await assert.rejects(response, { name: 'AbortError' })
  await disconnectedPromise
  release()
  await cleanedPromise
  assert.equal(app.records.artifactLeases.size, 0)
  await app.operations.invoke('deleteArtifact', { docId: document.id, artifactId: item.id })
})

test('the shared resource file-stat await releases its lease after a real download disconnect', { timeout: 5000 }, async t => {
  const { app, document } = await fixture(t)
  const item = (await app.exporter.exportDocument(document.id, { contentMode: 'source', outputs: [{ format: 'md' }] })).artifacts[0]
  const gate = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
  const entered = gate(), resume = gate(), aborted = gate(), released = gate()
  let releases = 0
  const retain = app.records.retainArtifact.bind(app.records)
  app.records.retainArtifact = (...args) => {
    const release = retain(...args)
    return () => { releases++; release(); released.resolve() }
  }
  const openResource = app.resources.openArtifact.bind(app.resources)
  app.resources.openArtifact = (id, options) => {
    options.signal.addEventListener('abort', aborted.resolve, { once: true })
    return openResource(id, options)
  }
  const originalOpen = fs.promises.open
  fs.promises.open = async (...args) => {
    const file = await originalOpen(...args)
    if (args[0] === item.path) {
      const originalStat = file.stat.bind(file)
      file.stat = async () => { entered.resolve(); await resume.promise; return originalStat() }
    }
    return file
  }
  syncBuiltinESMExports()
  t.after(() => { fs.promises.open = originalOpen; syncBuiltinESMExports(); resume.resolve() })
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  const controller = new AbortController()
  const request = fetch(server.url + '/api/artifacts/' + item.id + '/download', { signal: controller.signal })
  await entered.promise
  controller.abort(); await assert.rejects(request, { name: 'AbortError' })
  await aborted.promise; resume.resolve(); await released.promise
  assert.equal(releases, 1)
  assert.equal(app.records.artifactLeases.size, 0)
  assert.equal(app.resources.opened.size, 0)
  await app.operations.invoke('deleteArtifact', { docId: document.id, artifactId: item.id })
})

test('shutdown keeps storage owned when a resource file-stat acquisition misses its drain deadline', { timeout: 5000 }, async t => {
  const { app, dir, document } = await fixture(t)
  const item = (await app.exporter.exportDocument(document.id, { contentMode: 'source', outputs: [{ format: 'md' }] })).artifacts[0]
  let enter, resume
  const entered = new Promise(r => { enter = r }), blocked = new Promise(r => { resume = r })
  const originalOpen = fs.promises.open
  fs.promises.open = async (...args) => {
    const file = await originalOpen(...args)
    if (args[0] === item.path) {
      const stat = file.stat.bind(file)
      file.stat = async () => { enter(); await blocked; return stat() }
    }
    return file
  }
  syncBuiltinESMExports()
  t.after(() => { fs.promises.open = originalOpen; syncBuiltinESMExports(); resume() })
  const pending = app.resources.openArtifact(item.id).catch(error => error)
  await entered
  app.resources.drainTimeoutMs = 10
  await assert.rejects(app.dispose(), /Resource reads did not drain/)
  assert.ok(app.ctx.get('ivoraige.records'))
  await assert.rejects(createApp({ store: join(dir, 'store.sqlite') }), { code: 'CONFLICT' })
  resume()
  assert.equal((await pending).code, 'PRECONDITION_FAILED')
  await app.dispose()
  assert.equal(app.resources.pending.size, 0)
  assert.equal(app.records.artifactLeases.size, 0)
})
