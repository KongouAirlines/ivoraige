// Explicit, zero-model MCP + real PDF acceptance. Source is read-only.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { readPdfConfig } from '../src/cli.mjs'

const [sourceArg, configArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !configArg) throw Error('Usage: node scripts/smoke-mcp-pdf.mjs SOURCE.pdf PDF_CONFIG.json [OUTPUT_DIR]')
const root = resolve(outputArg ?? 'evaluation/runs/mcp-pdf-0.1.0')
await mkdir(root, { recursive: true })
let data = join(root, 'data'), app, server, client, calls = 0
const report = { createdAt: new Date().toISOString(), source: resolve(sourceArg), modelCalls: 0, passed: false }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function open() {
  await mkdir(data, { recursive: true })
  app = await createApp({ store: join(data, 'store.sqlite'), pdf: await readPdfConfig(resolve(configArg)) })
  app.ctx.on('llm/stream', () => { calls++; throw Error('Model calls forbidden in PDF replay acceptance') })
  server = await serve(app, { port: 0 })
  client = new Client({ name: 'ivoraige-pdf-acceptance', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)))
}
async function close() { await client?.close(); client = undefined; await server?.close(); server = undefined; await app?.dispose(); app = undefined }
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
  const first = await tool('export', { docId, targetLang: 'zh', outputs: ['pdf', 'md', 'json'].map(format => ({ format })) })
  const task = await wait(first.taskId)
  const initial = new Map()
  for (const artifact of task.artifacts) initial.set(artifact.format, await bytes(artifact))
  await close()
  const relocated = join(root, 'data-relocated')
  if (!data.startsWith(root + sep) || !relocated.startsWith(root + sep)) throw Error('Unexpected acceptance directory')
  await rename(data, relocated); data = relocated
  await open()
  const current = (await tool('units_list', { docId, targetLang: 'zh' })).items.find(item => item.translatable)
  await tool('unit_update', { unitId: current.id, targetLang: 'zh', text: current.sourceText + ' MCP edited draft.', baseRevisionId: current.latestRevisionId ?? current.acceptedRevisionId })
  const repeated = await tool('export', { docId, targetLang: 'zh', snapshotId: first.snapshotId, outputs: ['pdf', 'md', 'json'].map(format => ({ format })) })
  const replay = await wait(repeated.taskId)
  report.artifacts = []
  for (const artifact of replay.artifacts) {
    assert.equal(artifact.snapshotId, first.snapshotId)
    const content = await bytes(artifact)
    if (artifact.format !== 'pdf') assert.deepEqual(content, initial.get(artifact.format))
    else assert.equal(content.subarray(0, 5).toString(), '%PDF-')
    report.artifacts.push({ format: artifact.format, bytes: content.length, sha256: hash(content), initialSha256: hash(initial.get(artifact.format)) })
  }
  assert.equal(calls, 0)
  Object.assign(report, { passed: true, docId, snapshotId: first.snapshotId, units: items.length, relocated: true })
} finally {
  await close()
  report.modelCalls = calls
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
