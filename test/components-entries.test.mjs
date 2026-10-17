import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as tar from 'tar'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { runCli } from '../src/cli.mjs'

async function directory(label) {
  const root = join(process.cwd(), 'evaluation', 'runs')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, `components-entries-0.1.0-${label}-`))
}

async function packageFixture(root, { wrongDigest = false } = {}) {
  const source = join(root, 'package-source')
  await mkdir(source)
  await writeFile(join(source, 'babeldoc-sidecar.exe'), 'inert test sidecar')
  await writeFile(join(source, 'component.json'), JSON.stringify({
    id: 'babeldoc', version: '0.6.4', platform: process.platform, arch: process.arch,
    protocolVersion: 1, command: 'babeldoc-sidecar.exe', args: [], modelDirs: { babeldoc: 'assets' },
  }))
  const archive = join(root, 'babeldoc.tar.gz')
  await tar.c({ file: archive, gzip: true, cwd: source }, ['component.json', 'babeldoc-sidecar.exe'])
  const bytes = await readFile(archive)
  const manifestPath = join(root, 'components-manifest.json')
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, components: [{
    id: 'babeldoc', version: '0.6.4', platform: process.platform, arch: process.arch,
    protocolVersion: 1, package: { name: 'babeldoc.tar.gz', size: bytes.length,
      sha256: wrongDigest ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex') },
  }] }))
  return manifestPath
}

const sink = () => {
  const stdout = [], stderr = []
  return { stdout: { write: value => stdout.push(value) }, stderr: { write: value => stderr.push(value) },
    lines: () => stdout.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    errors: () => stderr.join('') }
}

test('HTTP component routes expose local install and task state without a token', async t => {
  const root = await directory('http')
  const manifestPath = await packageFixture(root)
  const app = await createApp({ store: join(root, 'records.sqlite'), settingsDir: join(root, 'settings'),
    components: { directory: join(root, 'components'), fetcher: async () => new Response(null, { status: 404 }) } })
  const server = await serve(app, { port: 0 })
  t.after(async () => { await server.close(); await app.dispose(); await rm(root, { recursive: true, force: true }) })

  const before = await (await fetch(`${server.url}/api/components`)).json()
  assert.equal(before.installed, null)
  assert.equal(before.credentialConfigured, false)
  const catalog = await fetch(`${server.url}/api/components/catalog`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(catalog.status, 502)
  const catalogError = (await catalog.json()).error
  assert.equal(catalogError.code, 'UPSTREAM_FAILURE')
  assert.match(catalogError.message, /HTTP 404.*repository and release version/)

  const started = await (await fetch(`${server.url}/api/components/local`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: manifestPath }) })).json()
  assert.ok(started.taskId)
  await app.components.jobs.wait(started.taskId, 30_000)
  const task = await (await fetch(`${server.url}/api/components/tasks/${started.taskId}`)).json()
  assert.equal(task.task.state, 'completed', task.task.error)
  assert.equal(task.task.restartRequired, true)
  const after = await (await fetch(`${server.url}/api/components`)).json()
  assert.equal(after.installed.version, '0.6.4')
  assert.equal(after.task.taskId, started.taskId)
  assert.equal(after.credentialConfigured, false)
  const canceled = await (await fetch(`${server.url}/api/components/tasks/${started.taskId}/cancel`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  assert.equal(canceled.task.state, 'completed')
  const credential = await fetch(`${server.url}/api/components/credential`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'private-test-token' }) })
  assert.equal(credential.status, 200)
  const configured = await (await fetch(`${server.url}/api/components`)).json()
  assert.equal(configured.credentialConfigured, true)
  assert.doesNotMatch(JSON.stringify(configured), /private-test-token/)
  const cleared = await fetch(`${server.url}/api/components/credential`, { method: 'DELETE' })
  assert.equal(cleared.status, 200)
  assert.equal((await cleared.json()).configured, false)
  assert.equal((await app.components.status()).credentialConfigured, false)
})

test('HTTP reports a missing installer plugin explicitly', async t => {
  const root = await directory('missing')
  const app = await createApp({ store: join(root, 'records.sqlite') })
  const server = await serve(app, { port: 0 })
  t.after(async () => { await server.close(); await app.dispose(); await rm(root, { recursive: true, force: true }) })
  for (const [method, path] of [['GET', '/api/components'], ['POST', '/api/components/local']]) {
    const response = await fetch(`${server.url}${path}`, { method,
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'manifest.json' }) } : {}) })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'COMPONENT_MISSING')
  }
})

test('local CLI waits for installer success and exits 4 on verified package failure', async t => {
  const good = await directory('cli-good')
  const bad = await directory('cli-bad')
  t.after(async () => { await rm(good, { recursive: true, force: true }); await rm(bad, { recursive: true, force: true }) })
  const goodPath = await packageFixture(good)
  const goodOutput = sink()
  const goodExit = await runCli(['--store', join(good, 'records.sqlite'), 'components', 'local',
    '--path', goodPath], goodOutput)
  assert.equal(goodExit, 0, goodOutput.errors())
  assert.equal(goodOutput.lines().length, 2)
  assert.equal(goodOutput.lines()[1].task.state, 'completed')
  assert.equal(goodOutput.lines()[1].task.restartRequired, true)
  const clearOutput = sink()
  assert.equal(await runCli(['--store', join(good, 'records.sqlite'), 'components', 'credential-clear'],
    clearOutput), 0, clearOutput.errors())
  assert.equal(clearOutput.lines()[0].configured, false)

  const badPath = await packageFixture(bad, { wrongDigest: true })
  const badOutput = sink()
  const badExit = await runCli(['--store', join(bad, 'records.sqlite'), 'components', 'local',
    '--path', badPath], badOutput)
  assert.equal(badExit, 4, badOutput.errors())
  assert.equal(badOutput.lines().length, 2)
  assert.equal(badOutput.lines()[1].task.state, 'failed')
  assert.match(badOutput.lines()[1].task.error, /SHA-256/)
})

test('app shutdown cancels an in-flight component download before disposing DSH', async t => {
  const root = await directory('shutdown')
  let started
  const requested = new Promise(resolve => { started = resolve })
  let aborted = false
  const fetcher = (_url, { signal }) => new Promise((resolve, reject) => {
    started()
    if (signal.aborted) { aborted = true; reject(signal.reason ?? new Error('Canceled')); return }
    signal.addEventListener('abort', () => {
      aborted = true
      reject(signal.reason ?? new Error('Canceled'))
    }, { once: true })
  })
  const config = { store: join(root, 'records.sqlite'), settingsDir: join(root, 'settings'),
    components: { directory: join(root, 'components'), fetcher } }
  let app = await createApp(config)
  t.after(async () => { if (app) await app.dispose(); await rm(root, { recursive: true, force: true }) })
  await app.components.setToken('private-test-token')
  app.components.install()
  await requested
  await app.dispose()
  app = null
  assert.equal(aborted, true)
  const reopened = await createApp({ ...config, components: { directory: config.components.directory } })
  app = reopened
  assert.equal((await reopened.components.status()).installed, null)
  assert.equal((await reopened.components.status()).task, null)
})
