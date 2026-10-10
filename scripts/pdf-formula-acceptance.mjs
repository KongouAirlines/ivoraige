// Real BabelDOC regression: manually accepted text, no translation provider.
// node scripts/pdf-formula-acceptance.mjs ORIGINAL.pdf PYTHON WORK_DIRECTORY
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.mjs'

const [input, python, output, sidecar] = process.argv.slice(2)
assert.ok(input && python && output, 'Provide PDF, Python executable and an empty work directory')
const work = resolve(output)
await mkdir(work, { recursive: true })
const config = { store: join(work, 'records.sqlite'), pdf: {
  command: /[\\/]/.test(python) ? resolve(python) : python,
  args: [sidecar ? resolve(sidecar) : fileURLToPath(new URL('../sidecars/babeldoc/server.py', import.meta.url))],
  options: { workDir: join(work, 'engine') }, timeoutMs: 600_000,
} }
let app = await createApp(config)
const report = { platform: process.platform, node: process.version, modelRequests: 0, exports: [] }
const formats = ['pdf', 'md', 'json']
async function exportSnapshot(docId, options, label) {
  const submitted = await app.tasks.exportDocument(docId,
    { targetLang: 'zh-CN', outputs: formats.map(format => ({ format })), ...options })
  const task = await app.tasks.wait(submitted.taskId)
  assert.equal(task.state, 'succeeded', task.error?.message)
  assert.equal(task.stats.llmCalls, 0)
  assert.ok(task.artifacts.every(a => a.snapshotId === submitted.snapshotId))
  const bytes = {}
  for (const artifact of task.artifacts) {
    bytes[artifact.format] = await readFile(artifact.path)
    await writeFile(join(work, `${label}.${artifact.format}`), bytes[artifact.format])
  }
  report.exports.push({ label, snapshotId: submitted.snapshotId, modelRequests: task.stats.llmCalls,
    warnings: task.warnings ?? [] })
  return { snapshotId: submitted.snapshotId, bytes }
}
try {
  assert.equal(app.records.listDocuments().length, 0, 'Use a fresh work directory')
  const { document } = await app.tasks.importDocument({ format: 'pdf', path: resolve(input) },
    { sourceId: 'original:formula-regression-0.1.0', language: 'en' })
  const units = app.records.listUnits(document.id, { targetLang: 'zh-CN' })
  const skip = await exportSnapshot(document.id, { onMissingAccepted: 'skip' }, 'skip')
  const captured = app.records.resolveSnapshot(document.id, skip.snapshotId).sourceBinding
  await writeFile(join(work, 'captured.json'), JSON.stringify(captured, null, 2))
  const formulas = captured.records.filter(record => record.placeholderPayloads?.some(p => p.type === 'formula'))
  assert.ok(formulas.length, 'Real engine must capture formula payloads')
  assert.ok(captured.records.every(record => (record.placeholders ?? []).every(p => typeof p.text === 'string')))
  const repeated = units.filter(unit => unit.sourceText === 'The applied field changes the magnetization direction.')
  assert.ok(repeated.length >= 4, 'Both same-page repetition and two-column instances must survive capture')
  assert.equal(new Set(repeated.map(unit => unit.locator.key)).size, repeated.length)
  const accepted = []
  for (const unit of units.filter(unit => unit.translatable)) {
    let text = unit.sourceText
    if (repeated.some(item => item.id === unit.id)) text = `位置${unit.order + 1}：外加磁场改变磁化方向。`
    else if (text.startsWith('A punctuation control follows:')) text = '标点核对：.................... 核对结束。'
    else if (text.includes('deliberately longer')) text = '这是一段特意写得更长的人工审校译文，用来检查冻结快照回放时的自动换行和段落布局。译文需要保持完整、清晰，并且不得遮挡相邻内容。这里没有调用翻译模型。'
    else if (text.startsWith('Formula and')) text = '公式与标点核对'
    else if (text.startsWith('Two columns')) text = '双栏与重复公式'
    const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh-CN', text, baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
    accepted.push({ unitId: unit.id, order: unit.order, text, locator: unit.locator })
  }
  const first = await exportSnapshot(document.id, {}, 'accepted')
  const json = JSON.parse(first.bytes.json)
  assert.ok(json.units.some(unit => unit.text.includes('....................')))
  assert.ok(first.bytes.md.toString().includes('....................'))
  const beforeRestart = app.records.resolveSnapshot(document.id, first.snapshotId)
  await app.dispose()
  app = await createApp(config)
  const restarted = app.records.resolveSnapshot(document.id, first.snapshotId)
  assert.deepEqual(restarted.sourceBinding, beforeRestart.sourceBinding)
  assert.deepEqual(restarted.snapshot, beforeRestart.snapshot)
  const decisions = frozen => frozen.units.map(({ unit, text, decision }) =>
    ({ id: unit.id, sourceText: unit.sourceText, locator: unit.locator, text, decision }))
  assert.deepEqual(decisions(restarted), decisions(beforeRestart))
  const unit = units.find(unit => unit.translatable)
  const view = app.records.getUnit(unit.id, { targetLang: 'zh-CN' })
  const edit = await app.records.writeRevision(unit.id, { targetLang: 'zh-CN', text: '后来的人工编辑', baseRevisionId: view.accepted.id })
  await app.records.acceptRevision(edit.id, { expectedAcceptedRevisionId: view.accepted.id })
  const replay = await exportSnapshot(document.id, { snapshotId: first.snapshotId }, 'replay')
  for (const format of ['md', 'json']) assert.deepEqual(replay.bytes[format], first.bytes[format])
  // PDF metadata can differ between engine runs; compare its rendered/text output separately.
  report.units = units.length
  report.formulaRecords = formulas.length
  report.repeatedLocations = repeated.map(unit => unit.locator)
  report.accepted = accepted
  report.frozenBindingPersisted = true
  await writeFile(join(work, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ units: units.length, formulaRecords: formulas.length, modelRequests: 0, work }))
} finally { await app.dispose() }
