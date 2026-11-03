import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { placeholderTokens } from '../src/adapters/pdf-text.mjs'
import { marked } from 'marked'
import { JSDOM } from 'jsdom'

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
    if (index >= texts.length) break
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

test('PDF Markdown expresses captured headings and keeps literal formula and identifier text visible', async t => {
  const f = await fixture(t, 'markdown-structure')
  const doc = await imported(f)
  const units = f.app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  assert.deepEqual(units.map(unit => unit.kind), ['heading', 'body', 'caption', 'formula'])
  const source = await exported(f.app, doc.id, { contentMode: 'source', outputs: [{ format: 'md' }] })
  const sourceBody = new JSDOM(marked.parse(await readFile(source.artifacts.md.path, 'utf8'))).window.document.body
  assert.equal(sourceBody.querySelector('h2')?.textContent, 'Results_2026 a<b')
  assert.equal(sourceBody.querySelector('p')?.textContent, '1. Metric_Total = x\\alpha & 5 < 7; <b2> &lt; 1.')
  await accept(f.app, doc.id, ['Summary_2026 <b1>', '1. Metric_Total = x\\alpha & 5 < 7; <b2> &lt; 1.'])
  const result = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs })
  const md = await readFile(result.artifacts.md.path, 'utf8')
  const json = JSON.parse(await readFile(result.artifacts.json.path, 'utf8'))
  const body = new JSDOM(marked.parse(md)).window.document.body
  assert.equal(body.querySelector('h2')?.textContent, 'Summary_2026 a<b')
  assert.equal(body.querySelector('ol'), null)
  assert.deepEqual([...body.querySelectorAll('p')].map(node => node.textContent),
    ['1. Metric_Total = x\\alpha & 5 < 7; <b2> &lt; 1.', 'Figure_1: *literal* caption.', 'α_x_1 < y end'])
  assert.deepEqual(json.units.map(unit => unit.text),
    ['Summary_2026 a<b', '1. Metric_Total = x\\alpha & 5 < 7; <b2> &lt; 1.',
      'Figure_1: *literal* caption.', 'α_x_1 < y end'])
  assert.ok(result.task.artifacts.every(item => item.snapshotId === result.snapshotId))
  assert.equal(result.task.stats.llmCalls, 0)
  const revision = await f.app.records.writeRevision(units[0].id, { targetLang: 'zh-CN',
    text: 'Later <b1>', baseRevisionId: f.app.records.getUnit(units[0].id,
      { targetLang: 'zh-CN' }).accepted.id })
  await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId:
    f.app.records.getUnit(units[0].id, { targetLang: 'zh-CN' }).accepted.id })
  const replay = await exported(f.app, doc.id, { targetLang: 'zh-CN', snapshotId: result.snapshotId, outputs })
  for (const format of ['md', 'json', 'pdf']) {
    assert.deepEqual(await readFile(replay.artifacts[format].path), await readFile(result.artifacts[format].path))
  }
})

test('PDF coverage summary persists in Cordis records and frozen JSON after restart', async t => {
  const f = await fixture(t, 'coverage-summary')
  const doc = await imported(f)
  const summary = { unitCount: 3, callbackCount: 2, uncalledCount: 1,
    auditOnlyLineCount: 1, emptyUnitCount: 0 }
  assert.deepEqual(doc.sourceCoverage.summary, summary)
  assert.equal(doc.sourceCoverage.uncalled[0].sourceUnicode, 'Invented audit line')
  await f.restart()
  assert.deepEqual(f.app.records.getDocument(doc.id).sourceCoverage.summary, summary)
  const result = await exported(f.app, doc.id,
    { contentMode: 'source', outputs: [{ format: 'json' }] })
  const frozen = f.app.records.resolveSnapshot(doc.id, result.snapshotId)
  assert.deepEqual(frozen.document.sourceCoverage.summary, summary)
  const json = JSON.parse(await readFile(result.artifacts.json.path, 'utf8'))
  assert.deepEqual(json.document.sourceCoverage, { summary })
  assert.equal(json.units[2].sourceText, 'Invented audit line')
})

test('textless PDF structure survives import and all frozen exports without losing body text', async t => {
  const f = await fixture(t, 'empty-structure')
  const doc = await imported(f)
  const units = f.app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  assert.equal(units.length, 3)
  assert.equal(units[2].sourceText, '')
  assert.equal(units[2].translatable, false)
  for (const unit of units.filter(unit => unit.translatable)) {
    const revision = await f.app.records.writeRevision(unit.id,
      { targetLang: 'zh-CN', text: '正文 <b1> 保留。', baseRevisionId: null })
    await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  const result = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs })
  const json = JSON.parse(await readFile(result.artifacts.json.path, 'utf8'))
  assert.equal(json.units.length, 3)
  assert.equal(json.units[0].text, '正文 E = mc² 保留。')
  assert.equal(json.units[2].text, '')
  const frozen = f.app.records.resolveSnapshot(doc.id, result.snapshotId)
  assert.equal(frozen.sourceBinding.records[2].rawSourceUnicode, null)
  assert.equal(frozen.units[2].unit.locator.key, 'empty-layout')
})

test('invalid PDF text produces a structured error rather than a null match crash', () => {
  assert.throws(() => placeholderTokens(null), { code: 'PRECONDITION_FAILED' })
  assert.deepEqual(placeholderTokens('Body <b1> text </b1>'), ['<b1>', '</b1>'])
})

test('mock PDF source snapshot copies verified managed bytes without rebuild or translation', async t => {
  const f = await fixture(t, 'hang-once-rebuild')
  const document = await imported(f)
  const source = await exported(f.app, document.id,
    { contentMode: 'source', outputs: [{ format: 'pdf' }, { format: 'md' }, { format: 'json' }] })
  assert.deepEqual(await readFile(source.artifacts.pdf.path), Buffer.from(originalBytes))
  const json = JSON.parse(await readFile(source.artifacts.json.path, 'utf8'))
  assert.equal(json.contentMode, 'source')
  assert.equal(json.document.targetLang, undefined)
  assert.deepEqual(json.units.map(unit => unit.decision.type), ['source', 'source'])
  assert.equal(source.task.stats.llmCalls, 0)
  assert.equal(f.app.records.record(document.id).revisions.length, 0)
  await assert.rejects(readFile(f.marker), { code: 'ENOENT' })
})

test('PDF source-language admission rejects unsupported selected imports before task or sidecar work', async t => {
  const f = await fixture(t)
  for (const language of ['fr', 'zh-TW']) {
    await assert.rejects(f.app.tasks.importDocument({ format: 'pdf', path: f.original },
      { sourceId: `paper:${language}`, language }, { wait: false }),
    { code: 'PRECONDITION_FAILED', message: /PDF source capture supports only/ })
  }
  await assert.rejects(f.app.parse.parse({ format: 'pdf', path: f.original, language: 'zh-TW' }),
    { code: 'PRECONDITION_FAILED', message: /PDF source capture supports only/ })
  assert.deepEqual(f.app.records.listTasks(), [])
  assert.deepEqual(f.app.records.listDocuments(), [])
  const doc = await imported(f)
  assert.equal(doc.language, 'en')
})

test('Chinese PDF capture preserves declared source and replays only to English', async t => {
  const f = await fixture(t)
  const { document: doc } = await f.app.tasks.importDocument({ format: 'pdf', path: f.original },
    { sourceId: 'paper:chinese', language: 'zh-CN' })
  assert.equal(doc.language, 'zh-CN')
  assert.equal(f.app.records.record(doc.id).sourceBinding.captureConfig.sourceLanguage, 'zh-CN')
  const units = f.app.records.listUnits(doc.id, { targetLang: 'en' })
  assert.match(units[0].sourceText, /中文/)
  for (const unit of units) {
    const revision = await f.app.records.writeRevision(unit.id,
      { targetLang: 'en', text: 'English <b1> result.', baseRevisionId: null })
    await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  await f.restart()
  assert.equal(f.app.records.record(doc.id).document.language, 'zh-CN')
  assert.equal(f.app.records.record(doc.id).sourceBinding.captureConfig.sourceLanguage, 'zh-CN')
  const original = await exported(f.app, doc.id, { contentMode: 'source', outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(original.artifacts.pdf.path), Buffer.from(originalBytes))
  const result = await exported(f.app, doc.id, { targetLang: 'en', outputs })
  const payload = JSON.parse((await readFile(result.artifacts.pdf.path, 'utf8')).split('\n')[1])
  assert.equal(payload.sourceLanguage, 'zh-CN')
  assert.equal(payload.captureLanguage, 'zh-CN')
  assert.equal(payload.targetLanguage, 'en')
  assert.match(await readFile(result.artifacts.md.path, 'utf8'), /English/)
  assert.equal(JSON.parse(await readFile(result.artifacts.json.path, 'utf8')).document.sourceLang, 'zh-CN')
  await assert.rejects(f.app.tasks.exportDocument(doc.id,
    { targetLang: 'zh', onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] }),
  { code: 'PRECONDITION_FAILED' })
  const record = f.app.records.record(doc.id)
  record.sourceBinding.captureConfig = {}
  const count = f.app.records.listSnapshots(doc.id).length
  const createSnapshot = f.app.records.createSnapshot
  let snapshotAttempts = 0
  f.app.records.createSnapshot = (...args) => { snapshotAttempts++; return createSnapshot(...args) }
  await assert.rejects(f.app.tasks.exportDocument(doc.id,
    { targetLang: 'en', outputs: [{ format: 'pdf' }] }),
  { code: 'PRECONDITION_FAILED', message: /capture source language differs/ })
  assert.equal(f.app.records.listSnapshots(doc.id).length, count)
  assert.equal(snapshotAttempts, 0)
  f.app.records.createSnapshot = createSnapshot
})

test('PDF export admission rejects unsupported replay targets before snapshots or tasks', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  assert.equal(f.app.outputs.get('pdf').id, 'pdf')
  assert.equal(f.app.outputs.get('pdf', { binding: f.app.records.record(doc.id).sourceBinding }).id, 'pdf')
  const createSnapshot = f.app.records.createSnapshot
  let snapshotAttempts = 0
  f.app.records.createSnapshot = (...args) => { snapshotAttempts++; return createSnapshot(...args) }
  for (const targetLang of ['en', 'fr', 'zh-TW']) {
    await assert.rejects(f.app.tasks.exportDocument(doc.id,
      { targetLang, onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] }),
    { code: 'PRECONDITION_FAILED', message: /Translated PDF replay supports only/ })
    await assert.rejects(f.app.exporter.exportDocument(doc.id,
      { targetLang, onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] }),
    { code: 'PRECONDITION_FAILED', message: /Translated PDF replay supports only/ })
  }
  await assert.rejects(f.app.tasks.exportDocument(doc.id,
    { targetLang: 'fr', onMissingAccepted: 'skip', outputs: [{ format: 'md' }, { format: 'pdf' }] }),
  { code: 'PRECONDITION_FAILED', message: /Translated PDF replay supports only/ })
  assert.deepEqual(f.app.records.listSnapshots(doc.id), [])
  assert.deepEqual(f.app.records.listTasks().filter(task => task.kind === 'export'), [])
  assert.deepEqual(f.app.records.listArtifacts(doc.id), [])
  assert.equal(snapshotAttempts, 0)
  f.app.records.createSnapshot = createSnapshot
  const text = await exported(f.app, doc.id,
    { targetLang: 'fr', onMissingAccepted: 'skip', outputs: [{ format: 'md' }] })
  assert.equal(text.task.state, 'succeeded')
  for (const targetLang of ['zh', 'zh-CN', 'zh-Hans']) {
    const result = await exported(f.app, doc.id,
      { targetLang, onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] })
    assert.equal(result.task.stats.llmCalls, 0)
  }
})

test('resuming a persisted unsupported PDF export leaves its task paused and output untouched', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  const snapshot = await f.app.records.createSnapshot(doc.id,
    { targetLang: 'fr', onMissingAccepted: 'skip' })
  const task = await f.app.records.createOperationTask(doc.id, { kind: 'export',
    targetLang: 'fr', snapshotId: snapshot.id,
    outputs: [{ format: 'pdf', adapterId: 'pdf', adapterVersion: '0.1.0' }] })
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'paused' }))
  await assert.rejects(f.app.tasks.resume(task.id),
    { code: 'PRECONDITION_FAILED', message: /Translated PDF replay supports only/ })
  assert.equal((await f.app.tasks.get(task.id)).state, 'paused')
  assert.equal((await f.app.tasks.get(task.id)).cursor, 0)
  assert.deepEqual(f.app.records.listArtifacts(doc.id), [])
  assert.equal(f.app.records.listSnapshots(doc.id).length, 1)
  await assert.rejects(readFile(f.marker), { code: 'ENOENT' })
})

test('HTTP rejects unsupported PDF language requests without queuing work', async t => {
  const f = await fixture(t)
  const doc = await imported(f)
  const server = await serve(f.app, { port: 0 })
  t.after(() => server.close())
  const post = (path, body) => fetch(`${server.url}/api${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const initialTasks = f.app.records.listTasks().length
  const importResponse = await post('/documents/import', { format: 'pdf', language: 'zh-TW',
    contentBase64: Buffer.from(originalBytes).toString('base64') })
  assert.equal(importResponse.status, 412)
  assert.equal((await importResponse.json()).error.code, 'PRECONDITION_FAILED')
  const exportResponse = await post(`/documents/${doc.id}/export`, { targetLang: 'fr',
    onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] })
  assert.equal(exportResponse.status, 412)
  assert.equal((await exportResponse.json()).error.code, 'PRECONDITION_FAILED')
  assert.equal(f.app.records.listTasks().length, initialTasks)
  assert.deepEqual(f.app.records.listSnapshots(doc.id), [])
})

test('unresolved PDF displays preserve tokens and allow import and all frozen outputs', async t => {
  const f = await fixture(t, 'unresolved-mapping')
  const doc = await imported(f)
  await accept(f.app, doc.id, ['结果 <b1> 一。', '结果 <b1> 二。'])
  const result = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs })
  assert.equal(result.task.stats.llmCalls, 0)
  assert.match(new JSDOM(marked.parse(await readFile(result.artifacts.md.path, 'utf8')))
    .window.document.body.textContent, /结果 <b1> 一。/)
  const json = JSON.parse(await readFile(result.artifacts.json.path, 'utf8'))
  assert.equal(json.units[0].text, '结果 <b1> 一。')
})

test('PDF rebuild warnings survive export checkpoints and restart', async t => {
  const f = await fixture(t, 'warning-rebuild')
  const doc = await imported(f)
  await accept(f.app, doc.id, ['结果 <b1> 一。', '结果 <b1> 二。'])
  const events = []
  const unsubscribe = f.app.tasks.subscribe(event => events.push(event))
  const result = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs })
  unsubscribe()
  const warning = 'PDF text extraction did not verify formula on page 1'
  assert.deepEqual(result.artifacts.pdf.warnings, [warning])
  assert.equal(result.artifacts.md.warnings, undefined)
  assert.deepEqual(result.task.warnings, [warning])
  assert.deepEqual(events.find(event => event.type === 'task.succeeded' &&
    event.data.taskId === result.task.id)?.data.warnings, [warning])
  assert.deepEqual((await f.app.operations.invoke('getTask', { taskId: result.task.id })).task.warnings, [warning])
  await f.restart()
  assert.deepEqual((await f.app.tasks.get(result.task.id)).warnings, [warning])
  assert.deepEqual(f.app.records.listArtifacts(doc.id).find(item => item.id === result.artifacts.pdf.id).warnings,
    [warning])
  assert.deepEqual((await f.app.operations.invoke('getTask', { taskId: result.task.id })).task.warnings, [warning])
})

test('a legacy unresolved mapping does not prevent translation and frozen export after restart', async t => {
  const f = await fixture(t)
  const adapter = f.app.parse.adapters.get('babeldoc')
  const original = adapter.import
  // Persist a pre-fix binding through the usual records path (including digests).
  adapter.import = (file, persist, referenced) => original(file, parsed => {
    parsed.sourceBinding.records[1].placeholders[0].text = null
    return persist(parsed)
  }, referenced)
  const doc = await imported(f)
  adapter.import = original
  await f.restart()
  let calls = 0
  class CompatibleModel extends Service {
    constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
    async translate() {
      calls++
      return { text: '兼容 <b1> 译文。', modelId: 'fixture', promptVersion: 'v1',
        tokens: { input: null, output: null } }
    }
  }
  await f.app.ctx.plugin(CompatibleModel)
  const submitted = await f.app.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  const task = await f.app.tasks.wait(submitted.taskId)
  assert.equal(task.state, 'succeeded', task.error?.message)
  assert.equal(calls, 2)
  const result = await exported(f.app, doc.id, { targetLang: 'zh-CN', outputs })
  assert.equal(result.task.stats.llmCalls, 0)
  assert.equal(calls, 2)
  assert.match(new JSDOM(marked.parse(await readFile(result.artifacts.md.path, 'utf8')))
    .window.document.body.textContent, /兼容 <b1> 译文。/)
})

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
