// SPDX-License-Identifier: MIT
// Opt-in, original synthetic PDF replay check; does not install models or call a translator.
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createApp } from '../src/app.mjs'
import MinerUSource from '../plugins/mineru/index.mjs'

if (process.argv.length !== 3) throw new Error('usage: node scripts/mineru-render-live.mjs RUN_DIR')
const root = resolve(process.argv[2])
const work = join(root, 'render-acceptance')
const store = join(work, 'store.sqlite')
const python = join(root, 'venv', 'bin', 'python')
try { await access(store); throw new Error('Use a new run directory for this acceptance check') }
catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(work, { recursive: true })
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const selected = [
  ['Synthetic Research Note: Water-Saving Crops', '合成研究笔记：节水作物'],
  ['Abstract', '摘要'],
]
const output = []
let app = await createApp({ store, exportDir: join(work, 'exports'), mcp: false, events: false })
try {
  await app.ctx.plugin(MinerUSource, { directory: join(work, 'data'), command: python,
    tier: 'flash', ocrMode: 'auto', timeoutMs: 900_000 })
  for (const name of ['mixed', 'scan']) {
    const input = await readFile(join(root, 'samples', `${name}.pdf`))
    const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
      contentBase64: input.toString('base64'), language: 'en', sourceId: `renderer-${name}` })
    const task = await app.tasks.wait(admitted.taskId)
    if (task.state !== 'succeeded') throw new Error(`${name} import failed`)
    const docId = task.result.document.id
    const units = app.records.listUnits(docId, { targetLang: 'zh' })
    for (const [sourceText, text] of selected) {
      const matches = units.filter(unit => unit.sourceText === sourceText && unit.translatable)
      if (matches.length !== 1) throw new Error(`${name} did not provide one confirmed source unit`)
      const revision = await app.records.writeRevision(matches[0].id,
        { targetLang: 'zh', text, baseRevisionId: null })
      await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
    }
    const original = await app.exporter.exportDocument(docId, { contentMode: 'source',
      outputs: [{ format: 'pdf' }] })
    if (!input.equals(await readFile(original.artifacts[0].path)))
      throw new Error('Source PDF was not replayed byte-for-byte')
    const result = await app.exporter.exportDocument(docId, { targetLang: 'zh',
      onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }, { format: 'md' }, { format: 'json' }] })
    if (result.artifacts.length !== 3 || result.artifacts.some(item => item.snapshotId !== result.snapshotId))
      throw new Error('Frozen output artifacts are incomplete')
    const pdf = result.artifacts.find(item => item.format === 'pdf')
    if (pdf.adapterId !== 'mineru-pdf') throw new Error('Wrong PDF renderer')
    const bytes = await readFile(pdf.path)
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('Renderer did not produce PDF bytes')
    output.push({ name, docId, pdfPath: pdf.path, snapshotId: result.snapshotId,
      sha256: sha256(bytes), size: bytes.length })
  }
} finally { await app.dispose() }

app = await createApp({ store, exportDir: join(work, 'exports'), mcp: false, events: false })
try {
  await app.ctx.plugin(MinerUSource, { directory: join(work, 'data'), command: python,
    tier: 'flash', ocrMode: 'auto', timeoutMs: 900_000 })
  if (app.records.listTasks().some(task => task.kind === 'translate'))
    throw new Error('A translation task was created')
  for (const row of output) {
    const replay = await app.exporter.exportDocument(row.docId,
      { targetLang: 'zh', snapshotId: row.snapshotId, outputs: [{ format: 'pdf' }] })
    if (sha256(await readFile(replay.artifacts[0].path)) !== row.sha256)
      throw new Error('Frozen PDF changed after restart')
  }
  const first = output[0]
  const title = app.records.listUnits(first.docId, { targetLang: 'zh' })
    .find(unit => unit.sourceText === selected[0][0])
  const old = app.records.getUnit(title.id, { targetLang: 'zh' }).accepted?.id
  if (!old) throw new Error('Accepted title revision is missing')
  const newer = await app.records.writeRevision(title.id, { targetLang: 'zh',
    text: '第二版合成研究标题', baseRevisionId: old })
  await app.records.acceptRevision(newer.id, { expectedAcceptedRevisionId: old })
  const replay = await app.exporter.exportDocument(first.docId,
    { targetLang: 'zh', snapshotId: first.snapshotId, outputs: [{ format: 'pdf' }] })
  if (sha256(await readFile(replay.artifacts[0].path)) !== first.sha256)
    throw new Error('A later edit changed the frozen PDF')
  const current = await app.exporter.exportDocument(first.docId,
    { targetLang: 'zh', onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] })
  if (sha256(await readFile(current.artifacts[0].path)) === first.sha256)
    throw new Error('A new snapshot did not reflect the new accepted title')
  output[0].newPdfPath = current.artifacts[0].path
} finally { await app.dispose() }
await writeFile(join(work, 'report.json'), JSON.stringify(output, null, 2))
console.log('MinerU frozen source and accepted PDF replay passed for two synthetic PDFs')
