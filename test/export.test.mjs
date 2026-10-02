import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t, content = 'Measured twice.') {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-export-'))
  const store = join(directory, 'records.sqlite')
  const app = await createApp({ store, exportDir: join(directory, 'out') })
  const apps = [app]
  t.after(async () => {
    for (const opened of apps.toReversed()) await opened.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const { document } = await app.records.importDocument({ format: 'txt', content, title: 'Original sample' },
    { sourceId: 'test:sample', language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh' })[0]
  const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: '测量了两次。', baseRevisionId: null })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  return { app, apps, document, unit, revision, directory, store }
}

test('MD and JSON use the same snapshot; replay is byte-stable after edits and restart', async t => {
  const { app, apps, document, unit, revision, store } = await fixture(t)
  const first = await app.exporter.exportDocument(document.id, {
    targetLang: 'zh', outputs: [{ format: 'md' }, { format: 'json' }],
  })
  assert.deepEqual(new Set(first.artifacts.map(a => a.snapshotId)), new Set([first.snapshotId]))
  assert.equal(first.artifacts[0].revisionSetHash, first.artifacts[1].revisionSetHash)
  const oldMd = await readFile(first.artifacts[0].path, 'utf8')
  const oldJson = await readFile(first.artifacts[1].path, 'utf8')
  assert.match(oldMd, /测量了两次。/)
  assert.equal(JSON.parse(oldJson).units[0].decision.revisionId, revision.id)
  const newer = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: '进行了两次测量。', baseRevisionId: revision.id })
  await app.records.acceptRevision(newer.id, { expectedAcceptedRevisionId: revision.id })
  await app.dispose()
  const reopened = await createApp({ store })
  apps.push(reopened)
  const replay = await reopened.exporter.exportDocument(document.id, {
    targetLang: 'zh', snapshotId: first.snapshotId, outputs: [{ format: 'md' }, { format: 'json' }],
  })
  assert.equal(await readFile(replay.artifacts[0].path, 'utf8'), oldMd)
  assert.equal(await readFile(replay.artifacts[1].path, 'utf8'), oldJson)
  const current = await reopened.exporter.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'json' }] })
  assert.equal(JSON.parse(await readFile(current.artifacts[0].path, 'utf8')).units[0].text, '进行了两次测量。')
  assert.equal(reopened.records.listArtifacts(document.id).length, 5)
  assert.equal(reopened.ctx.get('llm'), undefined)
})

test('in-flight export is pinned while edits proceed; renderers receive only frozen data', async t => {
  const { app, document, unit, revision } = await fixture(t)
  let signalStarted, finish
  const started = new Promise(resolve => { signalStarted = resolve })
  const gate = new Promise(resolve => { finish = resolve })
  t.after(() => finish())
  app.outputs.register({ id: 'slow', supports: binding => binding.adapterId === 'txt',
    async rebuild(data, options) {
      assert.equal(this, undefined)
      assert.deepEqual(Object.keys(options), ['format'])
      assert.throws(() => { data.units[0].text = 'overwritten' }, TypeError)
      signalStarted(data.snapshot.id)
      await gate
      return data.units[0].text
    },
  })
  const exporting = app.exporter.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'slow' }, { format: 'json' }] })
  const snapshotId = await started
  await assert.rejects(app.records.deleteSnapshot(document.id, snapshotId), error =>
    error.code === 'CONFLICT' && error.details.inUse)
  const newer = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: '新的译文。', baseRevisionId: revision.id })
  await app.records.acceptRevision(newer.id, { expectedAcceptedRevisionId: revision.id })
  finish()
  const result = await exporting
  assert.equal(await readFile(result.artifacts[0].path, 'utf8'), '测量了两次。')
  assert.equal(JSON.parse(await readFile(result.artifacts[1].path, 'utf8')).units[0].text, '测量了两次。')
  await assert.rejects(app.records.deleteSnapshot(document.id, snapshotId), error =>
    error.code === 'CONFLICT' && error.details.artifactIds.length === 2)
})

test('missing accepted text is explicit; skip preserves original and snapshot language cannot change', async t => {
  const { app, document } = await fixture(t, 'Measured twice.\n\nAnother paragraph.')
  await assert.rejects(app.exporter.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'json' }] }),
    { code: 'PRECONDITION_FAILED' })
  const result = await app.exporter.exportDocument(document.id, {
    targetLang: 'zh', outputs: [{ format: 'json' }], onMissingAccepted: 'skip',
  })
  const data = JSON.parse(await readFile(result.artifacts[0].path, 'utf8'))
  assert.equal(data.units[1].text, 'Another paragraph.')
  assert.equal(data.units[1].decision.type, 'skip')
  await assert.rejects(app.exporter.exportDocument(document.id, {
    targetLang: 'de', snapshotId: result.snapshotId, outputs: [{ format: 'md' }],
  }), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(app.exporter.exportDocument(document.id, {
    targetLang: 'zh', snapshotId: result.snapshotId, outputs: [{ format: 'md' }], onMissingAccepted: 'fail',
  }), { code: 'INVALID_ARGUMENT' })
})

test('output paths never overwrite prior bytes; failed formats release their lease', async t => {
  const { app, document, directory } = await fixture(t)
  const protectedPath = join(directory, 'existing.md')
  await writeFile(protectedPath, 'keep this')
  const snapshot = await app.records.createSnapshot(document.id, { targetLang: 'zh' })
  await assert.rejects(app.exporter.exportDocument(document.id, {
    targetLang: 'zh', snapshotId: snapshot.id, outputs: [{ format: 'md', out: protectedPath }],
  }), { code: 'CONFLICT' })
  assert.equal(await readFile(protectedPath, 'utf8'), 'keep this')
  assert.deepEqual(app.records.listArtifacts(document.id), [])
  await app.records.deleteSnapshot(document.id, snapshot.id)
  assert.deepEqual(app.records.listSnapshots(document.id), [])
})
