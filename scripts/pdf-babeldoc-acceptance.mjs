// Original synthetic PDFs only. Accept manual text, freeze, edit, then replay.
// node scripts/pdf-babeldoc-acceptance.mjs PDF PYTHON ASSETS WORK [mixed|formula|scan]
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.mjs'
const [input, python, assets, directory, mode = 'mixed'] = process.argv.slice(2)
assert.ok(input && python && assets && directory)
const work = resolve(directory)
await mkdir(work, { recursive: true })
const config = { store: join(work, 'records.sqlite'), pdf: {
  command: resolve(python), args: [fileURLToPath(new URL('../sidecars/babeldoc/server.py', import.meta.url))],
  modelDirs: { babeldoc: resolve(assets) }, options: { workDir: join(work, 'engine') }, timeoutMs: 600_000,
} }
let app = await createApp(config)
const report = { engine: '0.7.1+ivoraige.1', modelRequests: 0, mode, exports: [] }
const started = performance.now()
try {
  assert.equal(app.records.listDocuments().length, 0, 'Use a fresh work directory')
  let imported
  try {
    imported = mode === 'scan'
      ? await app.parse.parse({ format: 'pdf', path: resolve(input), language: 'en' })
      : await app.tasks.importDocument({ format: 'pdf', path: resolve(input) },
        { sourceId: `original:babeldoc-0.7.1-${mode}`, language: 'en' })
  } catch (error) {
    if (mode !== 'scan') throw error
    assert.match(error.message, /no translation requests|no paragraphs/i)
    report.scanUnsupported = true
    report.error = error.message
    await writeFile(join(work, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
  if (mode === 'scan') assert.equal(imported, undefined, 'Image-only scan must not be reported as parsed without OCR')
  if (mode !== 'scan') {
    const document = imported.document
    const units = app.records.listUnits(document.id, { targetLang: 'zh' })
    const mapping = new Map([
      ['Synthetic Research Note: Water-Saving Crops', '合成研究笔记：节水作物'],
      ['Abstract', '摘要'],
    ])
    const accepted = []
    let repeated = 0
    for (const unit of units.filter(unit => unit.translatable)) {
      if (mode === 'mixed' && !mapping.has(unit.sourceText)) {
        accepted.push({ unitId: unit.id, order: unit.order, sourceText: unit.sourceText,
          text: unit.sourceText, decision: 'skip', locator: unit.locator })
        continue
      }
      let text = mapping.get(unit.sourceText) ?? unit.sourceText
      if (mode === 'formula' && unit.sourceText === 'The applied field changes the magnetization direction.') {
        text = `位置${unit.order + 1}：外加磁场改变磁化方向。`
        repeated++
      }
      const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh', text, baseRevisionId: null })
      await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
      accepted.push({ unitId: unit.id, order: unit.order, sourceText: unit.sourceText, text, decision: 'revision', locator: unit.locator })
    }
    if (mode === 'mixed') assert.equal(accepted.filter(x => mapping.has(x.sourceText)).length, 2)
    if (mode === 'formula') assert.ok(repeated >= 4, 'Distinct repeated source locations must survive')
    async function render(label, options = {}) {
      const submitted = await app.tasks.exportDocument(document.id, { targetLang: 'zh',
        outputs: ['pdf', 'md', 'json'].map(format => ({ format })),
        ...(mode === 'mixed' && !options.snapshotId ? { onMissingAccepted: 'skip' } : {}), ...options })
      const task = await app.tasks.wait(submitted.taskId)
      assert.equal(task.state, 'succeeded', task.error?.message)
      assert.equal(task.stats.llmCalls, 0)
      const bytes = {}
      for (const artifact of task.artifacts) {
        assert.equal(artifact.snapshotId, submitted.snapshotId)
        bytes[artifact.format] = await readFile(artifact.path)
        await writeFile(join(work, `${label}.${artifact.format}`), bytes[artifact.format])
      }
      report.exports.push({ label, snapshotId: submitted.snapshotId, modelRequests: task.stats.llmCalls, warnings: task.warnings })
      return { snapshotId: submitted.snapshotId, bytes }
    }
    const first = await render('accepted')
    const frozen = app.records.resolveSnapshot(document.id, first.snapshotId)
    await writeFile(join(work, 'snapshot.json'), JSON.stringify(frozen, null, 2))
    await app.dispose()
    app = await createApp(config)
    const recovered = app.records.resolveSnapshot(document.id, first.snapshotId)
    assert.deepEqual(recovered.sourceBinding, frozen.sourceBinding)
    assert.deepEqual(recovered.snapshot, frozen.snapshot)
    const decisions = value => value.units.map(({ unit, text, decision }) => ({ id: unit.id, sourceText: unit.sourceText, locator: unit.locator, text, decision }))
    assert.deepEqual(decisions(recovered), decisions(frozen))
    const unit = units.find(x => x.translatable)
    const before = app.records.getUnit(unit.id, { targetLang: 'zh' })
    const edit = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: '后来的编辑不进入冻结输出', baseRevisionId: before.accepted.id })
    await app.records.acceptRevision(edit.id, { expectedAcceptedRevisionId: before.accepted.id })
    const replay = await render('replay', { snapshotId: first.snapshotId })
    for (const format of ['md', 'json']) assert.deepEqual(first.bytes[format], replay.bytes[format])
    report.units = units.length
    report.accepted = accepted
    report.repeatedLocations = repeated
    report.frozenBindingPersisted = true
    report.seconds = (performance.now() - started) / 1000
    await writeFile(join(work, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ units: units.length, repeated, seconds: report.seconds, modelRequests: 0 }))
  }
} finally { await app.dispose() }
