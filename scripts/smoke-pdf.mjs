// Explicit live PDF acceptance. Usage: node scripts/smoke-pdf.mjs PDF_CONFIG [RUN_DIRECTORY]
// The run directory keeps a durable count before every model request (maximum 30).
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { readPdfConfig } from '../src/cli.mjs'

if (!process.argv[2]) throw new Error('Specify the PDF component JSON configuration')
const pdf = await readPdfConfig(process.argv[2])
const root = resolve(process.argv[3] ?? 'evaluation/runs/pdf-acceptance')
await mkdir(root, { recursive: true })
const ledgerPath = join(root, 'model-budget.json')
let ledger
try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
  ledger = { used: 0, limit: 30 }
}
const translation = JSON.parse(await readFile(new URL('../examples/translation-deepseek.json', import.meta.url), 'utf8'))
const report = { startedAt: new Date().toISOString(), model: translation.model, passed: false }
const store = join(root, 'records.sqlite')
let app
async function open() {
  app = await createApp({ store, pdf, translation, exportDir: join(root, 'exports') })
  app.ctx.on('llm/stream', async function* (_options, next) {
    if (ledger.used >= 30) throw new Error('PDF acceptance model request budget exhausted')
    ledger.used++
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
    yield* next()
  })
}
async function exportTask(docId, snapshotId) {
  const before = ledger.used
  const submitted = await app.tasks.exportDocument(docId, { targetLang: 'zh-CN',
    ...(snapshotId ? { snapshotId } : {}), outputs: [{ format: 'pdf' }, { format: 'md' }, { format: 'json' }] })
  const task = await app.tasks.wait(submitted.taskId)
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error))
  assert.equal(ledger.used, before, 'Exports must not invoke a model')
  assert.ok(task.artifacts.every(item => item.snapshotId === submitted.snapshotId))
  return { ...submitted, task }
}
try {
  await open()
  const imported = await app.operations.invoke('importDocument', { path: join(root, 'original.pdf'),
    format: 'pdf', sourceId: 'pdf-acceptance:original:v1', language: 'en', title: 'Original PDF acceptance' })
  const importTask = await app.tasks.wait(imported.taskId)
  assert.equal(importTask.state, 'succeeded', JSON.stringify(importTask.error))
  const doc = importTask.result.document
  report.document = doc
  console.log(`Captured ${doc.unitCount} units (${doc.translatableCount} translatable)`)
  const translated = await app.tasks.submit(doc.id, { targetLang: 'zh-CN', mode: 'fast' })
  report.translation = await app.tasks.wait(translated.taskId)
  assert.equal(report.translation.state, 'succeeded', JSON.stringify(report.translation.error))
  console.log(`Translation complete; budget ${ledger.used}/30`)
  report.initial = await exportTask(doc.id)
  const units = app.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  const repeated = units.filter(unit => unit.sourceText.includes('reference sample remained stable'))
  assert.equal(repeated.length, 2, 'Fixture must preserve repeated text in two locations')
  const originalRevision = app.records.getUnit(repeated[0].id, { targetLang: 'zh-CN' }).accepted
  const revision = await app.records.writeRevision(repeated[0].id, { targetLang: 'zh-CN',
    text: '参考样品在本次测量期间保持稳定。', baseRevisionId: originalRevision.id })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: originalRevision.id })
  report.editedUnitId = repeated[0].id
  report.edited = await exportTask(doc.id)
  await app.dispose(); app = undefined
  await open()
  report.replayed = await exportTask(doc.id, report.initial.snapshotId)
  const initialJson = report.initial.task.artifacts.find(item => item.format === 'json')
  const replayedJson = report.replayed.task.artifacts.find(item => item.format === 'json')
  assert.equal(await readFile(initialJson.path, 'utf8'), await readFile(replayedJson.path, 'utf8'))
  const before = ledger.used
  const reused = await app.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  report.reuse = await app.tasks.wait(reused.taskId)
  assert.equal(report.reuse.state, 'succeeded')
  assert.equal(report.reuse.stats.llmCalls, 0)
  assert.equal(ledger.used, before)
  report.passed = true
} finally {
  if (app) await app.dispose()
  report.modelRequests = ledger.used
  report.exportModelRequests = 0
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, modelRequests: ledger.used, report: join(root, 'report.json') }))
}
