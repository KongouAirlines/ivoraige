import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'

const engine = fileURLToPath(new URL('./fixtures/pdf-engine.mjs', import.meta.url))
const originalBytes = '%PDF-FAKE-ORIGINAL\nA test source, not a real PDF.\n'

async function fixture(t, mode = 'normal') {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-'))
  const store = join(directory, 'records.sqlite')
  const original = join(directory, 'original.pdf')
  const marker = join(directory, 'rebuild-entered')
  const pdf = { command: process.execPath, args: [engine, mode, marker], timeoutMs: 2000 }
  await writeFile(original, originalBytes)
  let app = await createApp({ store, pdf })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, original, marker, pdf, get app() { return app },
    async restart() { await app.dispose(); app = await createApp({ store, pdf }); return app } }
}

async function imported(f) {
  const { document } = await f.app.tasks.importDocument({ format: 'pdf', path: f.original },
    { sourceId: 'paper:pdf-fixture', language: 'en' })
  return document
}

async function accept(app, docId, texts) {
  const units = app.records.listUnits(docId, { targetLang: 'zh-CN' })
  const revisions = []
  for (const [index, unit] of units.entries()) {
    const revision = await app.records.writeRevision(unit.id, {
      targetLang: 'zh-CN', text: texts[index], baseRevisionId: unit.draftRevisionId ?? unit.acceptedRevisionId ?? null,
    })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: unit.acceptedRevisionId ?? null })
    revisions.push(revision)
  }
  return revisions
}

async function exported(app, docId, options) {
  const submitted = await app.tasks.exportDocument(docId, options)
  const task = await app.tasks.wait(submitted.taskId)
  assert.equal(task.state, 'succeeded', task.error?.message)
  return { ...submitted, task, artifacts: Object.fromEntries(task.artifacts.map(item => [item.format, item])) }
}

const outputs = [{ format: 'pdf' }, { format: 'md' }, { format: 'json' }]

test('PDF bindings persist; PDF, Markdown and JSON share frozen revisions', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  assert.equal(doc.format, 'pdf')
  assert.deepEqual(doc.availableOutputs, ['pdf', 'md', 'json'])
  const units = f.app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  assert.equal(units.length, 2)
  assert.equal(units[0].sourceText, units[1].sourceText)
  assert.notDeepEqual(units[0].locator, units[1].locator)
  assert.notEqual(units[0].id, units[1].id)
  await f.restart()
  const persisted = f.app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  assert.deepEqual(persisted.map(unit => unit.locator), units.map(unit => unit.locator))

  await accept(f.app, doc.id, ['结果 <b1> 可重复。', '另一页的 <b1> 也可重复。'])
  const first = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs })
  assert.equal(first.task.artifacts.length, 3)
  assert.ok(first.task.artifacts.every(item => item.snapshotId === first.snapshotId))
  const pdfBody = JSON.parse((await readFile(first.artifacts.pdf.path, 'utf8')).split('\n')[1])
  const md = await readFile(first.artifacts.md.path, 'utf8')
  const json = JSON.parse(await readFile(first.artifacts.json.path, 'utf8'))
  assert.equal(pdfBody.snapshotId, first.snapshotId)
  assert.deepEqual(pdfBody.units.map(unit => unit.page), [1, 2])
  assert.deepEqual(pdfBody.units.map(unit => unit.text), ['结果 <b1> 可重复。', '另一页的 <b1> 也可重复。'])
  assert.match(md, /结果 E = mc² 可重复。/)
  assert.match(md, /另一页的 E = mc² 也可重复。/)
  assert.equal(json.snapshotId, first.snapshotId)
  assert.deepEqual(json.units.map(unit => unit.text),
    ['结果 E = mc² 可重复。', '另一页的 E = mc² 也可重复。'])

  const before = await Promise.all(outputs.map(({ format }) => readFile(first.artifacts[format].path)))
  const current = f.app.records.getUnit(units[0].id, { targetLang: 'zh-CN' })
  const edit = await f.app.records.writeRevision(units[0].id, {
    targetLang: 'zh-CN', text: '修改后的 <b1> 结果。', baseRevisionId: current.accepted.id,
  })
  await f.app.records.acceptRevision(edit.id, { expectedAcceptedRevisionId: current.accepted.id })
  const repeated = await exported(f.app, doc.id, { targetLang: 'zh-CN', snapshotId: first.snapshotId, outputs })
  for (const [index, { format }] of outputs.entries()) {
    assert.deepEqual(await readFile(repeated.artifacts[format].path), before[index])
  }
  const changed = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs: [{ format: 'md' }] })
  assert.notEqual(changed.snapshotId, first.snapshotId)
  assert.match(await readFile(changed.artifacts.md.path, 'utf8'), /修改后的 E = mc² 结果。/)
})

test('partial acceptance and skip replay the same frozen PDF, Markdown and JSON', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  const [first, second] = f.app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  const revision = await f.app.records.writeRevision(first.id, {
    targetLang: 'zh-CN', text: '已接受 <b1> 结果。', baseRevisionId: null,
  })
  await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  const initial = await exported(f.app, doc.id, {
    targetLang: 'zh-CN', onMissingAccepted: 'skip', outputs,
  })
  assert.equal(initial.task.stats.llmCalls, 0)
  const pdf = JSON.parse((await readFile(initial.artifacts.pdf.path, 'utf8')).split('\n')[1])
  const md = await readFile(initial.artifacts.md.path, 'utf8')
  const json = JSON.parse(await readFile(initial.artifacts.json.path, 'utf8'))
  assert.deepEqual(pdf.units.map(item => item.text), ['已接受 <b1> 结果。', second.sourceText])
  assert.match(md, /已接受 E = mc² 结果。/)
  assert.match(md, /The result E = mc² is reproducible\./)
  assert.deepEqual(json.units.map(item => item.decision.type), ['revision', 'skip'])
  assert.deepEqual(json.units.map(item => item.text),
    ['已接受 E = mc² 结果。', 'The result E = mc² is reproducible.'])
  assert.ok(initial.task.artifacts.every(item => item.snapshotId === initial.snapshotId))
  const original = await Promise.all(outputs.map(({ format }) => readFile(initial.artifacts[format].path)))

  const later = await f.app.records.writeRevision(second.id, {
    targetLang: 'zh-CN', text: '后来接受 <b1> 结果。', baseRevisionId: null,
  })
  await f.app.records.acceptRevision(later.id, { expectedAcceptedRevisionId: null })
  const replay = await exported(f.app, doc.id, { targetLang: 'zh-CN', snapshotId: initial.snapshotId, outputs })
  assert.equal(replay.task.stats.llmCalls, 0)
  for (const [index, { format }] of outputs.entries()) {
    assert.deepEqual(await readFile(replay.artifacts[format].path), original[index])
  }
})

test('managed PDF survives original mutation and rejects managed-source tampering', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  await accept(f.app, doc.id, ['结果 <b1> 一。', '结果 <b1> 二。'])
  const snapshot = await f.app.records.createSnapshot(doc.id, { targetLang: 'zh-CN' })
  const frozen = f.app.records.resolveSnapshot(doc.id, snapshot.id)
  assert.notEqual(frozen.sourceBinding.sourcePath, f.original)
  await writeFile(f.original, '%PDF-MUTATED-USER-ORIGINAL\n')
  const fine = await exported(f.app, doc.id, { targetLang: 'zh-CN', snapshotId: snapshot.id,
    outputs: [{ format: 'pdf' }] })
  assert.equal(fine.task.state, 'succeeded')
  await writeFile(frozen.sourceBinding.sourcePath, '%PDF-TAMPERED-MANAGED-SOURCE-LONGER\n')
  const failed = await f.app.tasks.exportDocument(doc.id, { targetLang: 'zh-CN', snapshotId: snapshot.id,
    outputs: [{ format: 'pdf' }] })
  const task = await f.app.tasks.wait(failed.taskId)
  assert.equal(task.state, 'failed')
  assert.deepEqual(f.app.records.listArtifacts(doc.id).map(item => item.id), [fine.task.artifacts[0].id])
})

class InvalidPdfModel extends Service {
  constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
  async translate() { return { text: '漏掉公式占位符', modelId: 'fixture', promptVersion: 'v1',
    tokens: { input: null, output: null } } }
}

test('invalid PDF placeholders fail before human acceptance or model checkpoint', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  const [unit] = f.app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  await assert.rejects(f.app.records.writeRevision(unit.id, {
    targetLang: 'zh-CN', text: '公式丢失', baseRevisionId: null,
  }), { code: 'PRECONDITION_FAILED' })
  assert.deepEqual(f.app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }), [])
  await f.app.ctx.plugin(InvalidPdfModel)
  const submitted = await f.app.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  const task = await f.app.tasks.wait(submitted.taskId)
  assert.equal(task.state, 'failed')
  assert.equal(task.cursor, 0)
  assert.deepEqual(f.app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }), [])
})

test('text documents work without PDF configuration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-no-pdf-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Text only.' },
    { sourceId: 'text:without-pdf', language: 'en' })
  assert.equal(document.format, 'txt')
  assert.deepEqual(document.availableOutputs, ['md', 'json'])
  await assert.rejects(app.records.importDocument({ format: 'pdf', content: Buffer.from(originalBytes) },
    { sourceId: 'pdf:without-component', language: 'en' }), { code: 'INVALID_ARGUMENT' })
})

test('canceling an active PDF rebuild leaves no artifact and a new export works', async t => {
  const f = await fixture(t, 'hang-once-rebuild')
  const doc = await imported(f)
  await accept(f.app, doc.id, ['结果 <b1> 一。', '结果 <b1> 二。'])
  const submitted = await f.app.tasks.exportDocument(doc.id, { targetLang: 'zh-CN', outputs: [{ format: 'pdf' }] })
  const deadline = Date.now() + 3000
  while (true) {
    try { assert.equal(await readFile(f.marker, 'utf8'), 'entered'); break } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const canceled = await f.app.tasks.cancel(submitted.taskId)
  assert.equal(canceled.state, 'canceled')
  assert.deepEqual(f.app.records.listArtifacts(doc.id), [])
  const after = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs: [{ format: 'pdf' }] })
  assert.equal(after.task.artifacts.length, 1)
})
