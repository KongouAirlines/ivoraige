// Artifact-isolation acceptance for the portable Windows distribution.
// Usage: node scripts/smoke-distribution.mjs PACKAGE_DIRECTORY FRESH_WORK_DIRECTORY [COMPONENT_MANIFEST [ORIGINAL_PDF]]
// This uses only the packaged runtime and HTTP entry. It is not clean-VM acceptance.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

if (process.platform !== 'win32') throw new Error('Distribution smoke requires Windows')
if (process.argv.length < 4 || process.argv.length > 6) {
  throw new Error('Usage: node scripts/smoke-distribution.mjs PACKAGE_DIRECTORY FRESH_WORK_DIRECTORY [COMPONENT_MANIFEST [ORIGINAL_PDF]]')
}
const packageDirectory = resolve(process.argv[2])
const workDirectory = resolve(process.argv[3])
if (workDirectory === packageDirectory || workDirectory.startsWith(`${packageDirectory}${sep}`)) {
  throw new Error('Work directory must be outside the package directory')
}
const componentManifest = process.argv[4] ? resolve(process.argv[4]) : undefined
const originalPDF = process.argv[5] ? resolve(process.argv[5]) : undefined
if (originalPDF && !componentManifest) throw new Error('An original PDF requires a component manifest')
if (await stat(workDirectory).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))) {
  throw new Error(`Work directory must be fresh; refusing to overwrite ${workDirectory}`)
}
let activePackageDirectory = packageDirectory
const runtime = join(packageDirectory, 'runtime', 'node.exe')
const launcher = join(packageDirectory, 'app', 'src', 'launch.mjs')
for (const path of [runtime, launcher, join(packageDirectory, 'app', 'dist', 'web', 'index.html')]) {
  if (!(await stat(path).catch(() => null))?.isFile()) throw new Error(`Packaged file is missing: ${path}`)
}
if (componentManifest && !(await stat(componentManifest).catch(() => null))?.isFile()) {
  throw new Error(`Component manifest is missing: ${componentManifest}`)
}
if (originalPDF && !(await stat(originalPDF).catch(() => null))?.isFile()) {
  throw new Error(`Original PDF is missing: ${originalPDF}`)
}
await mkdir(workDirectory, { recursive: true })
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
const profile = join(workDirectory, 'profile')
const dataDirectory = join(workDirectory, 'data')
const temp = join(workDirectory, 'temp')
for (const path of [profile, temp, join(profile, 'AppData', 'Local'), join(profile, 'AppData', 'Roaming')]) {
  await mkdir(path, { recursive: true })
}
const env = {
  SystemRoot: systemRoot,
  WINDIR: process.env.WINDIR ?? systemRoot,
  COMSPEC: join(systemRoot, 'System32', 'cmd.exe'),
  PATH: join(systemRoot, 'System32'),
  USERPROFILE: profile,
  HOME: profile,
  LOCALAPPDATA: join(profile, 'AppData', 'Local'),
  APPDATA: join(profile, 'AppData', 'Roaming'),
  TEMP: temp,
  TMP: temp,
  IVORAIGE_DATA_DIR: dataDirectory,
  IVORAIGE_APP_ROOT: join(packageDirectory, 'app'),
}
const args = [launcher, '--no-open', '--data-dir', dataDirectory, '--port', '0']
const evidence = {
  startedAt: new Date().toISOString(), passed: false, kind: 'artifact-isolation-smoke',
  cleanVmAcceptance: false, packageDirectory, workDirectory,
  runtime: 'runtime/node.exe', entry: 'app/src/launch.mjs',
  environment: { path: 'Windows System32 only', isolatedHome: true,
    cleared: ['PYTHONPATH', 'PYTHONHOME', 'NODE_PATH', 'NODE_OPTIONS'] },
  checks: [], launches: [], documents: {}, modelCalls: null,
}
let server

async function makePdfFixture(path) {
  const stream = 'BT /F1 18 Tf 72 720 Td (The sample remained stable.) Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await writeFile(path, pdf)
}

function check(name, details = {}) {
  evidence.checks.push({ name, ...details })
  console.log(JSON.stringify({ event: 'check', name, ...details }))
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function delay(ms) { return new Promise(done => setTimeout(done, ms)) }
function command() {
  const child = spawn(join(activePackageDirectory, 'runtime', 'node.exe'),
    [join(activePackageDirectory, 'app', 'src', 'launch.mjs'), ...args.slice(1)],
    { cwd: workDirectory, env, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  return { child, get stdout() { return stdout }, get stderr() { return stderr } }
}
async function startServer() {
  const started = Date.now()
  const process = command()
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Packaged launcher timed out: ${process.stderr}`)), 30_000)
    const inspect = () => {
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(process.stdout)
      if (match) { clearTimeout(timer); done(match[0]) }
    }
    process.child.stdout.on('data', inspect)
    process.child.once('error', error => { clearTimeout(timer); fail(error) })
    process.child.once('exit', code => { clearTimeout(timer); fail(new Error(`Packaged launcher exited ${code}: ${process.stderr}`)) })
    inspect()
  }).catch(error => { process.child.kill('SIGTERM'); throw error })
  const ready = await fetch(new URL('/api/instance', url), { signal: AbortSignal.timeout(10_000) })
  assert.equal(ready.status, 200, 'Packaged launcher HTTP readiness')
  const startupMs = Date.now() - started
  evidence.launches.push({ packageDirectory: activePackageDirectory, startupMs })
  evidence.startupMs ??= startupMs
  console.log(JSON.stringify({ event: 'launcher-ready', packageDirectory: activePackageDirectory, startupMs }))
  return { child: process.child, url, get stderr() { return process.stderr }, async close() {
    if (process.child.exitCode !== null) return
    await new Promise((done, fail) => {
      const timer = setTimeout(() => {
        process.child.kill('SIGKILL')
        fail(new Error(`Launcher did not stop: ${process.stderr}`))
      }, 15_000)
      process.child.once('exit', () => { clearTimeout(timer); done() })
      process.child.kill('SIGTERM')
    })
  } }
}
async function invoke(base, method, path, body) {
  const response = await fetch(new URL(path, base), {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  })
  const value = await response.json()
  assert.equal(value.apiVersion, '2.0', `${method} ${path} API version`)
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(value)}`)
  return value
}
async function waitTask(base, taskId, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const { task } = await invoke(base, 'GET', `/api/tasks/${encodeURIComponent(taskId)}?waitSeconds=2`)
    if (task.state === 'succeeded') return task
    if (['failed', 'canceled', 'paused'].includes(task.state)) {
      throw new Error(`Task ${taskId} ended ${task.state}: ${JSON.stringify(task.error)}`)
    }
  }
  throw new Error(`Task ${taskId} timed out`)
}
async function waitComponent(base, taskId) {
  const until = Date.now() + 10 * 60_000
  while (Date.now() < until) {
    const { task } = await invoke(base, 'GET', `/api/components/tasks/${encodeURIComponent(taskId)}`)
    if (task.state === 'completed') return task
    if (['failed', 'killed'].includes(task.state)) {
      throw new Error(`Component installation ${taskId} ended ${task.state}: ${JSON.stringify(task.error)}`)
    }
    await delay(500)
  }
  throw new Error(`Component installation ${taskId} timed out`)
}
async function page(base, path) {
  const items = []
  let cursor
  do {
    const result = await invoke(base, 'GET', path + (cursor ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''))
    items.push(...result.items)
    cursor = result.nextCursor
  } while (cursor)
  return items
}
let downloadIndex = 0
async function download(base, artifact) {
  const response = await fetch(new URL(`/api/artifacts/${encodeURIComponent(artifact.id)}/download`, base),
    { signal: AbortSignal.timeout(120_000) })
  assert.equal(response.status, 200, `Download ${artifact.id}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.length > 0, `Artifact ${artifact.id} is empty`)
  const file = `${++downloadIndex}.${artifact.format}`
  await mkdir(join(workDirectory, 'downloads'), { recursive: true })
  await writeFile(join(workDirectory, 'downloads', file), bytes)
  return { id: artifact.id, format: artifact.format, bytes: bytes.length, sha256: digest(bytes),
    file,
    pdfHeader: artifact.format === 'pdf' ? bytes.subarray(0, 5).toString('ascii') : undefined,
    content: artifact.format === 'pdf' ? undefined : bytes.toString('utf8') }
}
async function exportFormats(base, docId, formats, snapshotId) {
  const submitted = await invoke(base, 'POST', `/api/documents/${encodeURIComponent(docId)}/export`, {
    targetLang: 'zh-CN', outputs: formats.map(format => ({ format })),
    ...(snapshotId ? { snapshotId } : {}),
  })
  const task = await waitTask(base, submitted.taskId, 10 * 60_000)
  assert.equal(task.artifacts.length, formats.length)
  assert.ok(task.artifacts.every(item => item.snapshotId === submitted.snapshotId))
  const artifacts = []
  for (const artifact of task.artifacts) artifacts.push(await download(base, artifact))
  return { taskId: submitted.taskId, snapshotId: submitted.snapshotId, artifacts }
}
function evidenceExport(result) {
  return { ...result, artifacts: result.artifacts.map(({ content, ...summary }) => summary) }
}
function compareFrozen(first, replay, formats = first.artifacts.map(item => item.format)) {
  assert.equal(replay.snapshotId, first.snapshotId)
  for (const original of first.artifacts.filter(item => formats.includes(item.format))) {
    const repeated = replay.artifacts.find(item => item.format === original.format)
    assert.ok(repeated, `Replayed ${original.format} missing`)
    assert.equal(repeated.sha256, original.sha256, `Frozen ${original.format} changed`)
  }
}
async function humanAcceptAll(base, docId) {
  const units = await page(base, `/api/documents/${encodeURIComponent(docId)}/units?targetLang=zh-CN&limit=500`)
  const translatable = units.filter(unit => unit.translatable)
  assert.ok(translatable.length > 0, 'Document has no translatable units')
  const accepted = []
  for (const unit of translatable) {
    // Keep the complete source string so every PDF placeholder remains intact.
    const text = `译文：${unit.sourceText}`
    const { revision } = await invoke(base, 'PATCH', `/api/units/${encodeURIComponent(unit.id)}`, {
      targetLang: 'zh-CN', baseRevisionId: null, text,
    })
    await invoke(base, 'POST', `/api/revisions/${encodeURIComponent(revision.id)}/accept`,
      { expectedAcceptedRevisionId: null })
    accepted.push({ unitId: unit.id, revisionId: revision.id, sourceText: unit.sourceText })
  }
  return accepted
}
async function editAccepted(base, accepted) {
  const first = accepted[0]
  const { revision } = await invoke(base, 'PATCH', `/api/units/${encodeURIComponent(first.unitId)}`, {
    targetLang: 'zh-CN', baseRevisionId: first.revisionId, text: `修订：${first.sourceText}`,
  })
  await invoke(base, 'POST', `/api/revisions/${encodeURIComponent(revision.id)}/accept`,
    { expectedAcceptedRevisionId: first.revisionId })
  return revision.id
}
async function assertNoModelCalls(base) {
  const settings = await invoke(base, 'GET', '/api/settings/modelconfig')
  assert.equal(settings.settings.selected, null, 'Smoke must run without a model')
  const tasks = await page(base, '/api/tasks?limit=500')
  const calls = tasks.reduce((sum, task) => sum + (task.stats?.llmCalls ?? 0), 0)
  assert.equal(calls, 0, 'Model calls must remain zero')
  evidence.modelCalls = calls
  check('no-model-calls', { taskCount: tasks.length, modelCalls: calls })
}

try {
  server = await startServer()
  const firstUrl = server.url
  const initial = await invoke(firstUrl, 'GET', '/api/capabilities')
  assert.ok(initial.inputFormats.includes('txt') && initial.inputFormats.includes('md'))
  assert.ok(initial.outputFormats.includes('md') && initial.outputFormats.includes('json'))
  assert.ok(!initial.inputFormats.includes('pdf') && !initial.outputFormats.includes('pdf'))
  const componentStatus = await invoke(firstUrl, 'GET', '/api/components')
  assert.equal(componentStatus.installed, null)
  check('initial-text-only-capabilities', { inputFormats: initial.inputFormats, outputFormats: initial.outputFormats })
  const index = await fetch(new URL('/', firstUrl), { signal: AbortSignal.timeout(10_000) })
  assert.equal(index.status, 200)
  assert.match(index.headers.get('content-type'), /text\/html/)
  assert.match(await index.text(), /<html/i)
  check('packaged-static-ui')

  const second = command()
  const reuse = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Instance reuse timed out')), 15_000)
    second.child.once('error', error => { clearTimeout(timer); fail(error) })
    second.child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) done(second.stdout.trim())
      else fail(new Error(`Second launch failed ${code}: ${second.stderr}`))
    })
  })
  assert.equal(reuse, firstUrl)
  check('instance-reuse', { url: firstUrl })

  const imported = await invoke(firstUrl, 'POST', '/api/documents/import', {
    contentBase64: Buffer.from('The sample remained stable.\n\nA second paragraph records the result.').toString('base64'),
    format: 'txt', language: 'en', sourceId: 'distribution:txt', title: 'Distribution smoke text',
  })
  await waitTask(firstUrl, imported.taskId)
  const textDocId = imported.document.id
  const acceptedText = await humanAcceptAll(firstUrl, textDocId)
  const firstText = await exportFormats(firstUrl, textDocId, ['md', 'json'])
  assert.match(firstText.artifacts.find(item => item.format === 'md').content, /译文/)
  evidence.documents.text = { docId: textDocId, unitCount: acceptedText.length, initial: evidenceExport(firstText) }
  check('text-import-human-accept-and-export', { docId: textDocId, snapshotId: firstText.snapshotId })

  await server.close(); server = undefined
  const replacement = join(workDirectory, 'replacement-app')
  await cp(packageDirectory, replacement, { recursive: true, force: false, errorOnExist: true })
  activePackageDirectory = replacement
  env.IVORAIGE_APP_ROOT = join(replacement, 'app')
  server = await startServer()
  check('same-version-program-directory-replacement', { replacement,
    preservedDataDirectory: dataDirectory, sameVersionOnly: true })
  const textDoc = await invoke(server.url, 'GET', `/api/documents/${encodeURIComponent(textDocId)}`)
  assert.equal(textDoc.document.sourceId, 'distribution:txt')
  assert.equal((await invoke(server.url, 'GET', '/api/settings/modelconfig')).settings.selected, null)
  await editAccepted(server.url, acceptedText)
  const textReplay = await exportFormats(server.url, textDocId, ['md', 'json'], firstText.snapshotId)
  compareFrozen(firstText, textReplay)
  evidence.documents.text.replayed = evidenceExport(textReplay)
  check('text-restart-and-frozen-replay', { snapshotId: firstText.snapshotId })

  if (componentManifest) {
    const requested = await invoke(server.url, 'POST', '/api/components/local', { path: componentManifest })
    console.log(JSON.stringify({ event: 'component-install-started', taskId: requested.taskId }))
    const installation = await waitComponent(server.url, requested.taskId)
    check('local-pdf-install', { taskId: requested.taskId, state: installation.state,
      manifest: basename(componentManifest) })
    await server.close(); server = undefined
    server = await startServer()
    const enabled = await invoke(server.url, 'GET', '/api/capabilities')
    assert.ok(enabled.inputFormats.includes('pdf') && enabled.outputFormats.includes('pdf'))
    const installed = await invoke(server.url, 'GET', '/api/components')
    assert.ok(installed.installed, 'PDF component was not retained after restart')
    check('pdf-capabilities-after-restart', { installed: installed.installed.version })

    {
      const pdfPath = originalPDF ?? join(workDirectory, 'fixture.pdf')
      if (!originalPDF) await makePdfFixture(pdfPath)
      const pdfImport = await invoke(server.url, 'POST', '/api/documents/import', {
        path: pdfPath, format: 'pdf', language: 'en', sourceId: 'distribution:pdf',
        title: 'Distribution smoke PDF',
      })
      console.log(JSON.stringify({ event: 'pdf-import-started', taskId: pdfImport.taskId }))
      const pdfTask = await waitTask(server.url, pdfImport.taskId, 10 * 60_000)
      const pdfDocId = pdfTask.result.document.id
      const acceptedPdf = await humanAcceptAll(server.url, pdfDocId)
      const firstPdf = await exportFormats(server.url, pdfDocId, ['pdf', 'md', 'json'])
      const pdfBytes = firstPdf.artifacts.find(item => item.format === 'pdf')
      assert.ok(pdfBytes.bytes > 100 && pdfBytes.sha256)
      assert.equal(pdfBytes.pdfHeader, '%PDF-')
      await server.close(); server = undefined
      server = await startServer()
      const retained = await invoke(server.url, 'GET', `/api/documents/${encodeURIComponent(pdfDocId)}/snapshots/${encodeURIComponent(firstPdf.snapshotId)}`)
      assert.equal(retained.snapshot.id, firstPdf.snapshotId)
      const stillInstalled = await invoke(server.url, 'GET', '/api/components')
      assert.ok(stillInstalled.installed)
      check('pdf-snapshot-and-component-survive-restart', { snapshotId: firstPdf.snapshotId })
      await editAccepted(server.url, acceptedPdf)
      const pdfReplay = await exportFormats(server.url, pdfDocId, ['pdf', 'md', 'json'], firstPdf.snapshotId)
      assert.equal(pdfReplay.artifacts.find(item => item.format === 'pdf').pdfHeader, '%PDF-')
      compareFrozen(firstPdf, pdfReplay, ['md', 'json'])
      evidence.documents.pdf = { docId: pdfDocId, unitCount: acceptedPdf.length,
        fixture: originalPDF ? basename(originalPDF) : 'generated one-page PDF',
        initial: evidenceExport(firstPdf), replayed: evidenceExport(pdfReplay) }
      check('pdf-human-accept-and-frozen-replay', { docId: pdfDocId, snapshotId: firstPdf.snapshotId,
        byteIdenticalFormats: ['md', 'json'], pdfBytesValidated: true })
    }
  }
  await assertNoModelCalls(server.url)
  evidence.passed = true
} catch (error) {
  evidence.error = { name: error.name, message: error.message, stack: error.stack }
  if (server?.stderr) evidence.launcherStderr = server.stderr
  throw error
} finally {
  if (server) {
    try { await server.close() }
    catch (error) { evidence.closeError = error.message; evidence.passed = false }
  }
  evidence.finishedAt = new Date().toISOString()
  await writeFile(join(workDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ passed: evidence.passed, evidence: join(workDirectory, 'evidence.json'),
    checks: evidence.checks.map(item => item.name), modelCalls: evidence.modelCalls }))
}
