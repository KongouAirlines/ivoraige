import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-operations-'))
  let app = await createApp({ store: join(root, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
  return { get app() { return app }, async restart() {
    await app.dispose(); app = await createApp({ store: join(root, 'records.sqlite') })
  } }
}
const upload = content => ({ contentBase64: Buffer.from(content).toString('base64'), format: 'txt', language: 'en' })

test('capabilities and export use installed outputs, and deferred profile input is rejected', async t => {
  const f = await fixture(t)
  const unregister = f.app.outputs.register({ id: 'plain', supports: () => true, rebuild: data => data.units[0].text })
  const ops = f.app.operations
  assert.ok((await ops.invoke('capabilities')).outputFormats.includes('plain'))
  const { document } = await ops.invoke('importDocument', upload('Custom output.'))
  await assert.rejects(ops.invoke('translate', { docId: document.id, targetLang: 'zh', profileId: 'unused' }),
    { code: 'INVALID_ARGUMENT' })
  const { taskId } = await ops.invoke('exportDocument', { docId: document.id, targetLang: 'zh',
    onMissingAccepted: 'skip', outputs: [{ format: 'plain' }] })
  const task = await f.app.tasks.wait(taskId)
  assert.equal(task.state, 'succeeded')
  assert.equal(await readFile(task.artifacts[0].path, 'utf8'), 'Custom output.')
  unregister()
  assert.ok(!(await ops.invoke('capabilities')).outputFormats.includes('plain'))
})

test('model changes and translation admission serialize, and active tasks block configuration changes', async t => {
  const f = await fixture(t)
  const ops = f.app.operations
  const { document } = await ops.invoke('importDocument', upload('Admission ordering.'))
  f.app.tasks.scheduling = true // Keep the queue observable without invoking a provider.
  let release
  const gate = new Promise(resolve => { release = resolve })
  const updating = ops.changeModel(() => gate)
  const admission = ops.invoke('translate', { docId: document.id, targetLang: 'zh' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.app.records.listTasks().filter(task => task.kind === 'translate').length, 0)
  release()
  await updating
  const { taskId } = await admission
  await assert.rejects(ops.invoke('updateSettings', { provider: 'other', model: 'other' }), { code: 'CONFLICT' })
  await assert.rejects(ops.invoke('setCredential', { ref: 'test', value: 'secret' }), { code: 'CONFLICT' })
  await ops.invoke('cancelTask', { taskId })
  assert.equal(await ops.changeModel(() => 'safe'), 'safe')
})

test('shared operations validate input and persist import/export tasks without a model', async t => {
  const f = await fixture(t)
  const invoke = (name, params) => f.app.operations.invoke(name, params)
  await assert.rejects(invoke('importDocument', { contentBase64: 'bad!!!', language: 'en' }), { code: 'INVALID_ARGUMENT' })
  const imported = await invoke('importDocument', upload('A sample.'))
  assert.equal(imported.apiVersion, '2.0')
  assert.equal((await invoke('getTask', { taskId: imported.taskId })).task.kind, 'import')
  const { items: [unit] } = await invoke('listUnits', { docId: imported.document.id, targetLang: 'zh' })
  const { revision } = await invoke('writeRevision', { unitId: unit.id, targetLang: 'zh', baseRevisionId: null, text: '一个样本。' })
  await invoke('acceptRevision', { revisionId: revision.id, expectedAcceptedRevisionId: null })
  const output = await invoke('exportDocument', { docId: imported.document.id, targetLang: 'zh',
    outputs: [{ format: 'md' }, { format: 'json' }] })
  const done = await f.app.tasks.wait(output.taskId)
  assert.equal(done.kind, 'export')
  assert.equal(done.state, 'succeeded', JSON.stringify(done.error))
  assert.equal(done.cursor, 2)
  assert.equal(done.artifacts.length, 2)
  assert.ok(done.artifacts.every(artifact => artifact.snapshotId === output.snapshotId))
  const path = f.app.operations.artifact(done.artifacts[1].id).path
  assert.equal(JSON.parse(await readFile(path, 'utf8')).units[0].text, '一个样本。')
  await f.restart()
  assert.equal((await invoke('getTask', { taskId: output.taskId })).task.artifacts.length, 2)
  assert.equal((await invoke('listTasks', { limit: 1 })).items.length, 1)
  assert.ok((await invoke('listTasks', { limit: 1 })).nextCursor)
})

test('queued export freezes acceptance before later editing and retains the snapshot', async t => {
  const f = await fixture(t)
  const r = f.app.records
  const { document } = await f.app.operations.invoke('importDocument', upload('Original.'))
  const [unit] = r.listUnits(document.id, { targetLang: 'zh' })
  const revision = await r.writeRevision(unit.id, { targetLang: 'zh', baseRevisionId: null, text: '旧译文。' })
  await r.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  // Hold dispatch to inspect the admitted, durable frozen task.
  const schedule = f.app.tasks.schedule
  f.app.tasks.schedule = () => {}
  const output = await f.app.tasks.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'json' }] })
  await assert.rejects(r.deleteSnapshot(document.id, output.snapshotId), { code: 'CONFLICT' })
  const edited = await r.writeRevision(unit.id, { targetLang: 'zh', baseRevisionId: revision.id, text: '新译文。' })
  await r.acceptRevision(edited.id, { expectedAcceptedRevisionId: revision.id })
  f.app.tasks.schedule = schedule
  schedule.call(f.app.tasks)
  const done = await f.app.tasks.wait(output.taskId)
  assert.equal(done.state, 'succeeded')
  assert.equal(JSON.parse(await readFile(done.artifacts[0].path, 'utf8')).units[0].text, '旧译文。')
})

test('Markdown persistence and export preserve code and math while translating prose', async t => {
  const f = await fixture(t)
  const source = '# Title\n\nA sentence.\n\n```py\nx = 2\n```\n\n$$\nx^2\n$$\n'
  const { document } = await f.app.operations.invoke('importDocument', { ...upload(source), format: 'md' })
  for (const unit of f.app.records.listUnits(document.id, { targetLang: 'zh' }).filter(unit => unit.translatable)) {
    const revision = await f.app.records.writeRevision(unit.id, { targetLang: 'zh', baseRevisionId: null, text: '译文' })
    await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  const submitted = await f.app.tasks.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'md' }] })
  const done = await f.app.tasks.wait(submitted.taskId)
  assert.equal(done.state, 'succeeded', JSON.stringify(done.error))
  const text = await readFile(done.artifacts[0].path, 'utf8')
  assert.match(text, /^# 译文/)
  assert.ok(text.includes('```py\nx = 2\n```'))
  assert.ok(text.includes('$$\nx^2\n$$'))
})
