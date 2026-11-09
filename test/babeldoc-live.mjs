// Opt-in real-runtime acceptance. This is not a fixture or part of npm test.
// Run beneath the documented Linux child seccomp network-denial harness.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.mjs'
import { managePlugins } from '../src/plugin-install.mjs'
import BabelDOCSource from '../plugins/babeldoc/index.mjs'
import MinerUSource from '../plugins/mineru/index.mjs'

const [run, sample, babelPython, babelAssets, babelServer, mineruPython] = process.argv.slice(2).map(value => resolve(value))
assert.ok(run && sample && babelPython && babelAssets && babelServer && mineruPython,
  'Usage: node test/babeldoc-live.mjs RUN SAMPLE BABEL_PYTHON ASSETS SERVER MINERU_PYTHON')
await mkdir(run)
const store = join(run, 'store.sqlite'), directory = join(run, 'profile')
const bytes = await readFile(sample)
const sha = value => createHash('sha256').update(value).digest('hex')
const expectedSha = 'e0b949bc0c1f9532d1cfca41c1e235ff0a0b0db3894eb4239b5ee1360e575d1f'
assert.equal(sha(bytes), expectedSha, 'Use the original mixed synthetic research-note PDF')
const babel = command => ({ directory: join(run, 'pdf'), command, args: [babelServer],
  modelDirs: { babeldoc: babelAssets }, options: { workDir: join(run, 'babel-work') }, timeoutMs: 600_000 })
const mineru = command => ({ directory: join(run, 'mineru-data'), command, tier: 'flash', ocrMode: 'auto', timeoutMs: 900_000 })
const appOptions = () => ({ store, settingsDir: directory, exportDir: join(run, 'exports'), mcp: false, events: false })
const manage = options => managePlugins({ directory, storePath: store, ...options })
const B = '@ivoraige/babeldoc-source', M = '@ivoraige/mineru-source'
const report = { inputSha256: expectedSha, engines: {}, phases: [], childRelease: [], installation: [] }
for (const [folder, config] of [['babeldoc', babel(babelPython)], ['mineru', mineru(mineruPython)]]) {
  const result = await manage({ action: 'install', packageDirectory: fileURLToPath(new URL(`../plugins/${folder}`, import.meta.url)), config })
  assert.equal(result.application, 'restart-required')
  report.installation.push(result)
}
async function close(app) {
  assert.equal(app.records.listTasks().filter(task => task.kind === 'translate').length, 0)
  await app.dispose()
  // /proc may use host TIDs while process.pid is PID-namespace relative.
  const tids = await readdir('/proc/self/task')
  const children = (await Promise.all(tids.map(tid =>
    readFile(`/proc/self/task/${tid}/children`, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '' // A libuv thread can exit between reads.
      throw error
    })))).join(' ').trim()
  assert.equal(children, '', 'All subprocesses must be released after host close')
  report.childRelease.push('no child processes after close')
}
function pagePixels(path) {
  const result = spawnSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '1000', '-png', path],
    { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr?.toString())
  assert.deepEqual(result.stdout.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return sha(result.stdout)
}
const mapping = new Map([
  ['Synthetic Research Note: Water-Saving Crops', '合成研究笔记：节水作物'],
  ['Abstract', '摘要'],
])
async function importPdf(app, adapterId) {
  const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId,
    contentBase64: bytes.toString('base64'), language: 'en', sourceId: `dual-${adapterId}` })
  const task = await app.tasks.wait(admitted.taskId)
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error))
  const document = task.result.document
  assert.equal(document.sourceAdapterId, adapterId)
  assert.equal(app.records.record(document.id).sourceBinding.adapterId, adapterId)
  return document
}
async function acceptTwo(app, doc) {
  const units = app.records.listUnits(doc.id, { targetLang: 'zh' })
  for (const [sourceText, text] of mapping) {
    const matches = units.filter(unit => unit.translatable && unit.sourceText === sourceText)
    assert.equal(matches.length, 1, `${doc.sourceAdapterId}: ${sourceText}`)
    const revision = await app.records.writeRevision(matches[0].id,
      { targetLang: 'zh', text, baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  return units
}
async function frozenExport(app, doc) {
  const source = await app.exporter.exportDocument(doc.id, { contentMode: 'source', outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(source.artifacts[0].path), bytes)
  const expectedAdapter = doc.sourceAdapterId === 'mineru' ? 'mineru-pdf' : 'pdf'
  assert.equal(source.artifacts[0].adapterId, expectedAdapter)
  const wrongAdapter = doc.sourceAdapterId === 'mineru' ? 'pdf' : 'mineru-pdf'
  await assert.rejects(app.exporter.exportDocument(doc.id, { contentMode: 'source',
    outputs: [{ format: 'pdf', adapterId: wrongAdapter }] }), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(app.exporter.exportDocument(doc.id, { targetLang: 'zh',
    onMissingAccepted: 'skip', outputs: [{ format: 'pdf', adapterId: wrongAdapter }] }),
  { code: 'PRECONDITION_FAILED' })
  const exported = await app.exporter.exportDocument(doc.id, { targetLang: 'zh',
    onMissingAccepted: 'skip', outputs: ['pdf', 'md', 'json'].map(format => ({ format })) })
  assert.equal(exported.artifacts.length, 3)
  assert.ok(exported.artifacts.every(artifact => artifact.snapshotId === exported.snapshotId))
  assert.equal(exported.artifacts.find(item => item.format === 'pdf').adapterId, expectedAdapter)
  const inventory = JSON.parse(await readFile(exported.artifacts.find(item => item.format === 'json').path))
  const counts = Object.groupBy(inventory.units, unit => unit.decision.type)
  assert.equal(counts.revision?.length, 2)
  assert.ok(counts.skip?.length > 0)
  const pdf = await readFile(exported.artifacts.find(item => item.format === 'pdf').path)
  assert.ok(pdf.subarray(0, 1024).includes(Buffer.from('%PDF-')))
  return { snapshotId: exported.snapshotId, pdfSha256: sha(pdf), adapterId: expectedAdapter,
    ...(expectedAdapter === 'pdf' ? { pdfPixelSha256: pagePixels(exported.artifacts.find(item => item.format === 'pdf').path) } : {}),
    units: inventory.units.length, decisions: Object.fromEntries(Object.entries(counts).map(([key, rows]) => [key, rows.length])) }
}
async function replay(app, id, snapshotId, expected) {
  const result = await app.exporter.exportDocument(id, { targetLang: 'zh', snapshotId,
    outputs: [{ format: 'pdf' }] })
  assert.equal(result.artifacts[0].adapterId, expected.adapterId)
  if (expected.adapterId === 'pdf') assert.equal(pagePixels(result.artifacts[0].path), expected.pdfPixelSha256)
  else assert.equal(sha(await readFile(result.artifacts[0].path)), expected.pdfSha256)
}
async function txt(app) {
  const existing = app.records.listDocuments().find(doc => doc.sourceId === 'dual-txt')
  const doc = existing ?? (await app.records.importDocument({ format: 'txt', content: 'Synthetic standalone text.' },
    { sourceId: 'dual-txt', language: 'en' })).document
  const exported = await app.exporter.exportDocument(doc.id, { contentMode: 'source',
    outputs: [{ format: 'json' }] })
  assert.ok((await readFile(exported.artifacts[0].path, 'utf8')).includes('Synthetic standalone text.'))
}
async function missing(app, id, snapshotId) {
  await assert.rejects(app.exporter.exportDocument(id, { targetLang: 'zh', snapshotId,
    outputs: [{ format: 'pdf' }] }), error => ['COMPONENT_MISSING', 'PRECONDITION_FAILED'].includes(error.code))
}
let app = await createApp(appOptions())
try {
  const babelDoc = await importPdf(app, 'babeldoc')
  const mineruDoc = await importPdf(app, 'mineru')
  const babelUnits = await acceptTwo(app, babelDoc)
  const mineruUnits = await acceptTwo(app, mineruDoc)
  report.engines.babeldoc = { docId: babelDoc.id, binding: app.records.record(babelDoc.id).sourceBinding.adapterId,
    sourceUnits: babelUnits.length, ...await frozenExport(app, babelDoc) }
  report.engines.mineru = { docId: mineruDoc.id, binding: app.records.record(mineruDoc.id).sourceBinding.adapterId,
    sourceUnits: mineruUnits.length, ...await frozenExport(app, mineruDoc) }
  await txt(app)
  report.phases.push('both independently installed packages selected explicitly; bound PDF routes; wrong-engine refusal; TXT export')
} finally { await close(app) }
const b = report.engines.babeldoc, m = report.engines.mineru
await manage({ action: 'disable', name: B })
app = await createApp(appOptions())
try {
  await replay(app, m.docId, m.snapshotId, m)
  await missing(app, b.docId, b.snapshotId)
  await txt(app)
  report.phases.push('Babel package disabled/restarted: MinerU frozen replay and TXT available')
} finally { await close(app) }
await manage({ action: 'enable', name: B })
await manage({ action: 'disable', name: M })
app = await createApp(appOptions())
try {
  await replay(app, b.docId, b.snapshotId, b)
  await missing(app, m.docId, m.snapshotId)
  await txt(app)
  report.phases.push('MinerU package disabled/restarted: Babel frozen replay and TXT available')
} finally { await close(app) }
app = await createApp(appOptions())
try {
  await app.ctx.plugin(MinerUSource, mineru('/missing/mineru/python'))
  await missing(app, m.docId, m.snapshotId)
  await replay(app, b.docId, b.snapshotId, b)
  await txt(app)
  report.phases.push('MinerU runtime missing: installed Babel replay and TXT available')
} finally { await close(app) }
await manage({ action: 'disable', name: B })
await manage({ action: 'enable', name: M })
app = await createApp(appOptions())
try {
  await app.ctx.plugin(BabelDOCSource, babel('/missing/babel/python'))
  await missing(app, b.docId, b.snapshotId)
  await replay(app, m.docId, m.snapshotId, m)
  await txt(app)
  report.phases.push('Babel runtime missing: installed MinerU replay and TXT available')
} finally { await close(app) }
await manage({ action: 'remove', name: B })
await manage({ action: 'remove', name: M })
app = await createApp(appOptions())
try {
  assert.equal(app.records.getDocument(b.docId).sourceAdapterId, 'babeldoc')
  assert.equal(app.records.getDocument(m.docId).sourceAdapterId, 'mineru')
  assert.deepEqual(await readFile(app.records.record(b.docId).sourceBinding.sourcePath), bytes)
  assert.deepEqual(await readFile(app.records.record(m.docId).sourceBinding.sourcePath), bytes)
  await txt(app)
  report.phases.push('both packages removed/restarted: saved records and managed originals retained; TXT available')
} finally { await close(app) }
report.translationTaskCount = 0
await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
