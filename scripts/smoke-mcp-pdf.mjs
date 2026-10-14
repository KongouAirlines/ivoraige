// Explicit, zero-model MCP + real PDF acceptance. Source is read-only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { readPdfConfig } from '../src/cli.mjs'
import { assertArtifactFormats, closeBestEffort, createRunDirectory, errorSummary, PDF_EXPORT_FORMATS, writeAcceptanceReport } from './smoke-mcp-pdf-helpers.mjs'

const [sourceArg, configArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !configArg) throw Error('Usage: node scripts/smoke-mcp-pdf.mjs SOURCE.pdf PDF_CONFIG.json [OUTPUT_DIR]')
const root = await createRunDirectory(outputArg ?? 'evaluation/runs/mcp-pdf-0.1.0')
const reportPath = join(root, 'report.json')
console.log(`Acceptance output: ${root}`)
let data = join(root, 'data'), app, server, client, calls = 0
const report = { createdAt: new Date().toISOString(), source: resolve(sourceArg), modelCalls: 0, passed: false }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const execFileAsync = promisify(execFile)
const outputs = PDF_EXPORT_FORMATS.map(format => ({ format }))
async function rasterDigests(pdfBytes) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-raster-'))
  try {
    const pdfPath = join(directory, 'source.pdf')
    const prefix = join(directory, 'page')
    await writeFile(pdfPath, pdfBytes)
    await execFileAsync(process.env.PDFTOPPM_PATH || 'pdftoppm',
      ['-scale-to', '1200', pdfPath, prefix], { windowsHide: true, timeout: 120_000 })
    const pages = (await readdir(directory)).filter(name => /^page-\d+\.ppm$/.test(name)).sort((a, b) =>
      Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    assert.ok(pages.length > 0, 'PDF rendered no pages')
    return await Promise.all(pages.map(async name => hash(await readFile(join(directory, name)))))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
async function open() {
  await mkdir(data, { recursive: true })
  app = await createApp({ store: join(data, 'store.sqlite'), pdf: await readPdfConfig(resolve(configArg)) })
  app.ctx.on('llm/stream', () => { calls++; throw Error('Model calls forbidden in PDF replay acceptance') })
  server = await serve(app, { port: 0 })
  client = new Client({ name: 'ivoraige-pdf-acceptance', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)))
}
async function close() {
  const currentClient = client, currentServer = server, currentApp = app
  client = server = app = undefined
  const errors = await closeBestEffort([
    ['client', () => currentClient?.close()],
    ['server', () => currentServer?.close()],
    ['app', () => currentApp?.dispose()],
  ])
  if (errors.length) throw new AggregateError(errors.map(item => item.error),
    `Cleanup failed: ${errors.map(item => item.name).join(', ')}`)
}
async function tool(name, args = {}) {
  const result = await client.callTool({ name: `ivoraige_${name}`, arguments: args }, { timeout: 120_000 })
  assert.ok(!result.isError, JSON.stringify(result))
  return result.structuredContent ?? JSON.parse(result.content[0].text)
}
async function wait(taskId) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const { task } = await tool('task_status', { taskId, waitSeconds: 5 })
    if (task.state === 'succeeded') return task
    assert.ok(!['failed', 'canceled', 'paused'].includes(task.state), JSON.stringify(task))
  }
  throw Error('Task did not finish within 10 minutes')
}
async function bytes(artifact) {
  const result = await client.readResource({ uri: `ivoraige://artifacts/${artifact.id}` })
  return Buffer.from(result.contents[0].blob, 'base64')
}
let failure
try {
  await open()
  const imported = await tool('import', { path: resolve(sourceArg), format: 'pdf', language: 'en', origin: 'mcp' })
  const importedTask = await wait(imported.taskId)
  const docId = importedTask.result.document.id
  const { items } = await tool('units_list', { docId, targetLang: 'zh' })
  for (const unit of items.filter(item => item.translatable)) {
    const { revision } = await tool('unit_update', { unitId: unit.id, targetLang: 'zh', text: unit.sourceText, baseRevisionId: null })
    await tool('revision_accept', { revisionId: revision.id, expectedAcceptedRevisionId: null })
  }
  process.stdout.write(`Imported ${items.length} PDF units via MCP\n`)
  const first = await tool('export', { docId, targetLang: 'zh', outputs })
  const task = await wait(first.taskId)
  assertArtifactFormats(task.artifacts)
  assert.ok(task.artifacts.every(artifact => artifact.snapshotId === first.snapshotId))
  const initial = new Map()
  for (const artifact of task.artifacts) initial.set(artifact.format, await bytes(artifact))
  const initialPdfPages = await rasterDigests(initial.get('pdf'))
  await close()
  const relocated = join(root, 'data-relocated')
  if (!data.startsWith(root + sep) || !relocated.startsWith(root + sep)) throw Error('Unexpected acceptance directory')
  await rename(data, relocated); data = relocated
  await open()
  const current = (await tool('units_list', { docId, targetLang: 'zh' })).items.find(item => item.translatable)
  assert.ok(current, 'PDF has no translatable unit to change after restart')
  const changed = await tool('unit_update', { unitId: current.id, targetLang: 'zh', text: current.sourceText + ' MCP accepted edit.', baseRevisionId: current.latestRevisionId ?? current.acceptedRevisionId })
  await tool('revision_accept', { revisionId: changed.revision.id, expectedAcceptedRevisionId: current.acceptedRevisionId })
  const repeated = await tool('export', { docId, targetLang: 'zh', snapshotId: first.snapshotId, outputs })
  const replay = await wait(repeated.taskId)
  assert.equal(repeated.snapshotId, first.snapshotId)
  assertArtifactFormats(replay.artifacts)
  report.artifacts = []
  for (const artifact of replay.artifacts) {
    assert.equal(artifact.snapshotId, first.snapshotId)
    const content = await bytes(artifact)
    if (artifact.format !== 'pdf') assert.deepEqual(content, initial.get(artifact.format))
    else assert.deepEqual(await rasterDigests(content), initialPdfPages, 'Frozen PDF page rasters changed')
    report.artifacts.push({ format: artifact.format, bytes: content.length, sha256: hash(content), initialSha256: hash(initial.get(artifact.format)) })
  }
  assert.equal(calls, 0)
  Object.assign(report, { docId, snapshotId: first.snapshotId, units: items.length, relocated: true,
    acceptedRevisionId: changed.revision.id, pdfPageRasterSha256: initialPdfPages })
} catch (error) {
  failure = error
  report.error = errorSummary(error)
} finally {
  try { await close() } catch (error) {
    report.cleanupError = errorSummary(error)
    if (!failure) { failure = error; report.error = errorSummary(error) }
  }
  report.modelCalls = calls
  report.passed = !failure && calls === 0
  failure = await writeAcceptanceReport(report, reportPath, failure)
  console.log(`Acceptance report: ${reportPath}`)
  console.log(JSON.stringify(report))
}
if (failure) throw failure
