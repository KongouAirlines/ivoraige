import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as tar from 'tar'
import { JobsLocal } from '../dist/dsh.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { Components } from '../src/components.mjs'
import { downloadAsset, extractVerifiedArchive, inside, validateManifest } from '../src/component-package.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(directory) {
  const source = join(directory, 'source')
  await mkdir(source)
  await writeFile(join(source, 'babeldoc-sidecar.exe'), 'mock sidecar')
  await writeFile(join(source, 'component.json'), JSON.stringify({ id: 'babeldoc', version: '0.6.4',
    platform: process.platform, arch: process.arch, protocolVersion: 1,
    command: 'babeldoc-sidecar.exe', args: [], modelDirs: { babeldoc: 'assets' } }))
  const archive = join(directory, 'babeldoc.tar.gz')
  await tar.c({ gzip: true, file: archive, cwd: source }, ['component.json', 'babeldoc-sidecar.exe'])
  const bytes = await readFile(archive)
  const descriptor = { name: 'babeldoc.tar.gz', size: bytes.length, sha256: hash(bytes) }
  const manifest = { schemaVersion: 1, components: [{ id: 'babeldoc', version: '0.6.4',
    platform: process.platform, arch: process.arch, protocolVersion: 1, package: descriptor }] }
  const manifestPath = join(directory, 'components-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  return { archive, bytes, manifestPath, manifest }
}

async function testDirectory(name) {
  const root = join(process.cwd(), 'evaluation', 'runs')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, `components-0.1.0-${name}-`))
}

async function boot(directory, fetcher) {
  const profile = await bootModelSettings({ directory: join(directory, 'settings') })
  await profile.ctx.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
  await profile.ctx.plugin(Components, { directory: join(directory, 'components'),
    repository: 'KongouAirlines/ivaraige', releaseTag: 'v0.1.0-dev.0', fetcher })
  return { ...profile, components: profile.ctx.get('ivoraige.components') }
}

test('interrupted asset body reports actionable download guidance without raw network details', async t => {
  const directory = await testDirectory('interrupted-download')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fetcher = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('terminated: private signed URL')) },
  }))
  await assert.rejects(downloadAsset(fetcher, 'owner/repo', { id: 1 }, 'test-token',
    join(directory, 'archive.tar.gz')), error => {
    assert.equal(error.code, 'UPSTREAM_FAILURE')
    assert.match(error.message, /代理/)
    assert.doesNotMatch(error.message, /private signed URL|test-token/)
    return true
  })
})

test('local manifest and SHA-256 verified PDF install persist through DSH settings', async t => {
  const directory = await testDirectory('local')
  const { manifestPath } = await fixture(directory)
  let app = await boot(directory)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  assert.equal((await app.components.status()).installed, null)
  const { taskId } = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(taskId, 30_000)
  const task = app.components.getTask(taskId)
  assert.equal(task.state, 'completed', task.error)
  assert.equal(task.result.restartRequired, true)
  assert.equal((await app.components.status()).installed.version, '0.6.4')
  assert.equal((await app.components.getInstalledPdf()).command.endsWith('babeldoc-sidecar.exe'), true)
  await app.dispose()
  app = await boot(directory)
  assert.equal((await app.components.status()).installed.version, '0.6.4')
  assert.equal((await app.components.status()).restartRequired, false)
  const root = (await app.components.status()).installed.root
  const configPath = join(root, 'component.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  await writeFile(configPath, JSON.stringify({ ...config, platform: 'incompatible' }))
  assert.equal((await app.components.status()).installed, null)
  assert.match((await app.components.status()).unavailable, /missing or invalid/)
})

test('bad local digest does not select or retain a component', async t => {
  const directory = await testDirectory('bad')
  const { manifestPath, manifest } = await fixture(directory)
  manifest.components[0].package.sha256 = '0'.repeat(64)
  await writeFile(manifestPath, JSON.stringify(manifest))
  const app = await boot(directory)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { taskId } = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(taskId, 30_000)
  assert.equal(app.components.getTask(taskId).state, 'failed')
  assert.match(app.components.getTask(taskId).error, /SHA-256/)
  assert.equal((await app.components.status()).installed, null)
})

test('a failed upgrade preserves the active PDF selection', async t => {
  const directory = await testDirectory('upgrade')
  const { manifestPath, manifest } = await fixture(directory)
  const app = await boot(directory)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const first = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(first.taskId, 30_000)
  assert.equal(app.components.getTask(first.taskId).state, 'completed')
  manifest.components[0].version = '0.6.5'
  manifest.components[0].package.sha256 = '0'.repeat(64)
  await writeFile(manifestPath, JSON.stringify(manifest))
  const next = app.components.installLocal({ manifestPath, version: '0.6.5' })
  await app.components.jobs.wait(next.taskId, 30_000)
  assert.equal(app.components.getTask(next.taskId).state, 'failed')
  assert.equal((await app.components.status()).installed.version, '0.6.4')
})

test('local installation extracts the verified staged bytes when the source changes', async t => {
  const directory = await testDirectory('stage-copy')
  const { manifestPath, archive } = await fixture(directory)
  const app = await boot(directory)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const stageLocal = app.components.stageLocal
  app.components.stageLocal = async (...args) => {
    const staged = await stageLocal(...args)
    await writeFile(archive, 'changed after verification')
    return staged
  }
  const { taskId } = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(taskId, 30_000)
  assert.equal(app.components.getTask(taskId).state, 'completed', app.components.getTask(taskId).error)
  assert.equal((await app.components.status()).installed.version, '0.6.4')
})

test('same-version repair restores missing files and rolls back after activation failure', async t => {
  const directory = await testDirectory('repair')
  const { manifestPath } = await fixture(directory)
  const app = await boot(directory)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const first = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(first.taskId, 30_000)
  assert.equal(app.components.getTask(first.taskId).state, 'completed')
  const root = (await app.components.status()).installed.root
  await unlink(join(root, 'babeldoc-sidecar.exe'))
  assert.equal((await app.components.status()).installed, null)
  const repaired = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(repaired.taskId, 30_000)
  assert.equal(app.components.getTask(repaired.taskId).state, 'completed', app.components.getTask(repaired.taskId).error)
  assert.equal((await app.components.status()).installed.version, '0.6.4')

  const settings = app.ctx.settings
  const mutate = settings.mutate
  settings.mutate = async () => { throw new Error('forced settings failure') }
  const failed = app.components.installLocal({ manifestPath })
  await app.components.jobs.wait(failed.taskId, 30_000)
  settings.mutate = mutate
  assert.equal(app.components.getTask(failed.taskId).state, 'failed')
  assert.equal((await app.components.status()).installed.version, '0.6.4')
  assert.equal((await readFile(join(root, 'babeldoc-sidecar.exe'), 'utf8')), 'mock sidecar')
  assert.equal((await readdir(join(directory, 'components', 'versions', 'babeldoc', '0.6.4')))
    .filter(name => name.includes('.replaced-')).length, 0)
})

test('cancellation is rejected once activation starts and shutdown waits for commit', async t => {
  const directory = await testDirectory('commit')
  const { manifestPath } = await fixture(directory)
  const app = await boot(directory)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const settings = app.ctx.settings
  const mutate = settings.mutate
  let entered, release
  const reached = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  settings.mutate = async (...args) => { entered(); await gate; return mutate.apply(settings, args) }
  const { taskId } = app.components.installLocal({ manifestPath })
  await reached
  assert.throws(() => app.components.cancel(taskId), { code: 'CONFLICT' })
  let closed = false
  const closing = app.components.close().then(() => { closed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed, false)
  release()
  await closing
  settings.mutate = mutate
  assert.equal(app.components.getTask(taskId).state, 'completed', app.components.getTask(taskId).error)
  assert.equal((await app.components.status()).installed.version, '0.6.4')
})

test('private release download uses token only on GitHub API request', async t => {
  const directory = await testDirectory('release')
  const { bytes, manifest } = await fixture(directory)
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const requests = []
  const asset = id => id === '1' ? manifestBytes : bytes
  const fetcher = async (url, options) => {
    requests.push({ url, authorization: options.headers?.Authorization })
    if (url.includes('/releases/tags/')) return new Response(JSON.stringify({ assets: [
      { id: 1, name: 'components-manifest.json', size: manifestBytes.length },
      { id: 2, name: 'babeldoc.tar.gz', size: bytes.length },
    ] }), { status: 200 })
    if (url.startsWith('https://api.github.com/') && url.includes('/releases/assets/')) {
      return new Response(null, { status: 302,
        headers: { location: `https://objects.githubusercontent.com/${url.split('/').at(-1)}` } })
    }
    return new Response(asset(url.split('/').at(-1)), { status: 200 })
  }
  const app = await boot(directory, fetcher)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  await app.components.setToken('private-example-token')
  assert.equal((await app.components.status()).credentialConfigured, true)
  assert.equal((await app.components.catalog()).components[0].id, 'babeldoc')
  const { taskId } = app.components.install()
  await app.components.jobs.wait(taskId, 30_000)
  assert.equal(app.components.getTask(taskId).state, 'completed', app.components.getTask(taskId).error)
  assert.equal(requests.every(row => row.url.startsWith('https://api.github.com/') ?
    row.authorization === 'Bearer private-example-token' : row.authorization === undefined), true)
  assert.doesNotMatch(JSON.stringify(await app.components.status()), /private-example-token/)
})

test('manifest and archive paths reject unsafe inputs', () => {
  assert.throws(() => inside('C:/root', '../escape'))
  assert.throws(() => inside('C:/root', 'a\\b'))
  assert.throws(() => validateManifest({ schemaVersion: 1, components: [{ id: 'babeldoc',
    version: '0.6.4', platform: 'win32', arch: 'x64', protocolVersion: 1,
    package: { name: '../bad.tar.gz', size: 1, sha256: '0'.repeat(64) } }] }))
})

test('archive traversal cannot write outside the extraction directory', async t => {
  const directory = await testDirectory('traversal')
  t.after(async () => rm(directory, { recursive: true, force: true }))
  const header = Buffer.alloc(512)
  header.write('../escape', 0, 'utf8')
  header.write('0000644\0', 100, 'ascii')
  header.write('0000000\0', 108, 'ascii')
  header.write('0000000\0', 116, 'ascii')
  header.write('00000000001\0', 124, 'ascii')
  header.write('00000000000\0', 136, 'ascii')
  header.fill(32, 148, 156)
  header.write('0', 156, 'ascii')
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  const payload = Buffer.concat([header, Buffer.from('x'), Buffer.alloc(511), Buffer.alloc(1024)])
  const archive = join(directory, 'traversal.tar.gz')
  await writeFile(archive, gzipSync(payload))
  await assert.rejects(extractVerifiedArchive(archive, join(directory, 'root')))
  await assert.rejects(readFile(join(directory, 'escape')))
})

test('canceling a remote install stops the DSH job without changing selection', async t => {
  const directory = await testDirectory('cancel')
  const fetcher = (_url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error('Canceled'))
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Canceled')), { once: true })
  })
  const app = await boot(directory, fetcher)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  await app.components.setToken('private-example-token')
  const { taskId } = app.components.install()
  app.components.cancel(taskId)
  await app.components.jobs.wait(taskId, 30_000)
  assert.equal(app.components.getTask(taskId).state, 'killed')
  assert.equal((await app.components.status()).installed, null)
})
