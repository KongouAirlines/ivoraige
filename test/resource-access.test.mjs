import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'

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
