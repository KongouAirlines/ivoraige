import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as tar from 'tar'
import { JobsLocal } from '../dist/dsh.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { Components } from '../src/components.mjs'
import { downloadAsset, extractVerifiedArchive, fetchRelease, inside, validateManifest } from '../src/component-package.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(directory, version = '0.6.4') {
  const source = join(directory, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'babeldoc-sidecar.exe'), 'mock sidecar')
  await writeFile(join(source, 'component.json'), JSON.stringify({ id: 'babeldoc', version,
    platform: process.platform, arch: process.arch, protocolVersion: 1,
    command: 'babeldoc-sidecar.exe', args: [], modelDirs: { babeldoc: 'assets' } }))
  const archive = join(directory, 'babeldoc.tar.gz')
  await tar.c({ gzip: true, file: archive, cwd: source }, ['component.json', 'babeldoc-sidecar.exe'])
  const bytes = await readFile(archive)
  const descriptor = { name: 'babeldoc.tar.gz', size: bytes.length, sha256: hash(bytes) }
  const manifest = { schemaVersion: 1, components: [{ id: 'babeldoc', version,
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

test('component metadata and verified asset downloads consume valid Brotli responses locally', async t => {
  const directory = await testDirectory('brotli-response')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from('A valid component download fixture.')
  const release = { assets: [{ id: 1, name: 'fixture.tar.gz', size: bytes.length }] }
  const requested = []
  const server = createServer((req, res) => {
    requested.push(req.url)
    const metadata = req.url.includes('/releases/tags/')
    const body = metadata ? Buffer.from(JSON.stringify(release)) : bytes
    res.writeHead(200, { 'content-type': metadata ? 'application/json' : 'application/octet-stream',
      'content-encoding': 'br' })
    res.end(brotliCompressSync(body))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => {
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  // Keep the production GitHub URL checks; only the injected transport routes
  // these requests to a loopback fixture. No GitHub credentials are needed.
  const fetcher = (url, options) => fetch(new URL(new URL(url).pathname, base), options)
  assert.deepEqual(await fetchRelease(fetcher, 'owner/repo', 'v0.1.0'), release)
  const destination = join(directory, 'fixture.tar.gz')
  const expected = { size: bytes.length, sha256: hash(bytes) }
  assert.deepEqual(await downloadAsset(fetcher, 'owner/repo', release.assets[0], undefined,
    destination, undefined, expected), expected)
  assert.deepEqual(await readFile(destination), bytes)
  assert.deepEqual(requested, ['/repos/owner/repo/releases/tags/v0.1.0', '/repos/owner/repo/releases/assets/1'])
})

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

test('local and release installs reject semver downgrades and retain the active selection', async t => {
  for (const source of ['local', 'release']) await t.test(source, async t => {
    const directory = await testDirectory(`versions-${source}`)
    let candidate = await fixture(directory, '0.6.9-rc.2')
    let archiveRequests = 0
    const fetcher = async url => {
      const manifestBytes = Buffer.from(JSON.stringify(candidate.manifest))
      if (url.includes('/releases/tags/')) return new Response(JSON.stringify({ assets: [
        { id: 1, name: 'components-manifest.json', size: manifestBytes.length },
        { id: 2, name: 'babeldoc.tar.gz', size: candidate.bytes.length },
      ] }))
      if (url.endsWith('/1')) return new Response(manifestBytes)
      archiveRequests++
      return new Response(candidate.bytes)
    }
    let app = await boot(directory, fetcher)
    t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
    await app.components.setToken('test-install-token')
    async function install() {
      const { taskId } = source === 'local' ? app.components.installLocal({ manifestPath: candidate.manifestPath }) : app.components.install()
      await app.components.jobs.wait(taskId, 30_000)
      return app.components.getTask(taskId)
    }
    for (const version of ['0.6.9-rc.2', '0.6.9', '0.6.10', '0.6.10']) {
      candidate = await fixture(directory, version)
      const result = await install()
      assert.equal(result.state, 'completed', result.error)
    }
    const installed = await app.components.getInstalledPdf()
    const before = archiveRequests
    for (const version of ['0.6.9', '0.6.10-rc.1']) {
      candidate = await fixture(directory, version)
      const result = await install()
      assert.equal(result.state, 'failed')
      assert.match(result.error, /Cannot downgrade/)
      assert.equal((await app.components.getInstalledPdf()).root, installed.root)
    }
    assert.equal(archiveRequests, before, 'Reject downgrade before downloading archives')
    assert.equal(await readFile(installed.command, 'utf8'), 'mock sidecar')
    assert.deepEqual((await readdir(join(directory, 'components'))).filter(name => name.startsWith('.install-')), [])
    await app.dispose()
    app = await boot(directory, fetcher)
    assert.equal((await app.components.getInstalledPdf()).version, '0.6.10')
  })
})

test('manifest requires strict semver and one version per component platform', () => {
  const row = { id: 'babeldoc', version: '0.6.4', platform: 'win32', arch: 'x64', protocolVersion: 1,
    package: { name: 'babeldoc.tar.gz', size: 1, sha256: '0'.repeat(64) } }
  for (const version of ['latest', 'v0.6.4', '0.6', '01.6.4', '0.6.4-01']) {
    assert.throws(() => validateManifest({ schemaVersion: 1, components: [{ ...row, version }] }), /semver/)
  }
  assert.equal(validateManifest({ schemaVersion: 1, components: [{ ...row, version: '0.6.4-rc.1+build.2' }] }).components.length, 1)
  for (const version of ['0.6.4', '0.6.5']) {
    assert.throws(() => validateManifest({ schemaVersion: 1, components: [row, { ...row, version }] }), /Only one component version/)
  }
  assert.equal(validateManifest({ schemaVersion: 1, components: [row, { ...row, platform: 'linux' }] }).components.length, 2)
})

test('catalog and both installation sources reject a multi-version manifest before archive download', async t => {
  const directory = await testDirectory('ambiguous-catalog')
  const { manifest, manifestPath } = await fixture(directory)
  manifest.components.push({ ...manifest.components[0], version: '0.6.5' })
  const bytes = Buffer.from(JSON.stringify(manifest))
  await writeFile(manifestPath, bytes)
  const fetcher = async url => {
    if (url.includes('/releases/tags/')) return new Response(JSON.stringify({ assets: [
      { id: 1, name: 'components-manifest.json', size: bytes.length },
    ] }))
    assert.ok(url.endsWith('/1'), 'No package asset may be requested')
    return new Response(bytes)
  }
  const app = await boot(directory, fetcher)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  await app.components.setToken('test-catalog-token')
  await assert.rejects(app.components.catalog(), /Only one component version/)
  for (const source of ['local', 'release']) {
    const { taskId } = source === 'local' ? app.components.installLocal({ manifestPath }) : app.components.install()
    await app.components.jobs.wait(taskId, 30_000)
    const task = app.components.getTask(taskId)
    assert.equal(task.state, 'failed')
    assert.match(task.error, /Only one component version/)
  }
  assert.equal(await app.components.getInstalledPdf(), null)
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

test('anonymous catalog and installation omit Authorization on every request', async t => {
  const directory = await testDirectory('anonymous-release')
  const { bytes, manifest } = await fixture(directory)
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const requests = []
  const fetcher = async (url, options) => {
    requests.push({ url, headers: options.headers, redirect: options.redirect })
    if (url.includes('/releases/tags/')) return new Response(JSON.stringify({ assets: [
      { id: 1, name: 'components-manifest.json', size: manifestBytes.length },
      { id: 2, name: 'babeldoc.tar.gz', size: bytes.length },
    ] }))
    if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 302,
      headers: { location: `https://objects.githubusercontent.com/${url.split('/').at(-1)}` } })
    return new Response(url.endsWith('/1') ? manifestBytes : bytes)
  }
  const app = await boot(directory, fetcher)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  assert.equal((await app.components.status()).credentialConfigured, false)
  assert.equal((await app.components.catalog()).components[0].id, 'babeldoc')
  const { taskId } = app.components.install()
  await app.components.jobs.wait(taskId, 30_000)
  assert.equal(app.components.getTask(taskId).state, 'completed', app.components.getTask(taskId).error)
  assert.ok(requests.some(row => row.url.startsWith('https://objects.githubusercontent.com/')))
  assert.ok(requests.every(row => !Object.hasOwn(row.headers, 'Authorization') && row.redirect === 'manual'))
  assert.equal((await app.components.status()).credentialConfigured, false)
})

test('explicitly clearing an invalid saved token restores anonymous installation after restart', async t => {
  const directory = await testDirectory('clear-credential')
  const { bytes, manifest } = await fixture(directory)
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const authorizations = []
  const fetcher = async (url, options) => {
    authorizations.push(options.headers?.Authorization)
    if (options.headers?.Authorization) return new Response(null, { status: 401 })
    if (url.includes('/releases/tags/')) return new Response(JSON.stringify({ assets: [
      { id: 1, name: 'components-manifest.json', size: manifestBytes.length },
      { id: 2, name: 'babeldoc.tar.gz', size: bytes.length },
    ] }))
    return new Response(url.endsWith('/1') ? manifestBytes : bytes)
  }
  let app = await boot(directory, fetcher)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  await app.components.setToken('expired-test-token')
  await assert.rejects(app.components.catalog(), /HTTP 401.*invalid or expired/)
  assert.deepEqual(authorizations, ['Bearer expired-test-token'])
  const cleared = await app.components.clearToken()
  assert.equal(cleared.configured, false)
  assert.equal((await app.components.status()).credentialConfigured, false)
  await app.dispose()
  app = await boot(directory, fetcher)
  assert.equal((await app.components.status()).credentialConfigured, false)
  assert.equal((await app.components.catalog()).components[0].id, 'babeldoc')
  const { taskId } = app.components.install()
  await app.components.jobs.wait(taskId, 30_000)
  assert.equal(app.components.getTask(taskId).state, 'completed', app.components.getTask(taskId).error)
  assert.ok(authorizations.slice(1).every(value => value === undefined))
})

test('release and asset HTTP failures give safe, actionable status guidance', async () => {
  const cases = [
    { status: 401, token: 'test-token', match: /invalid or expired/ },
    { status: 401, token: null, match: /requires authorization/ },
    { status: 404, token: null, match: /repository and release version/ },
    { status: 403, token: 'test-token', match: /denied access/ },
    { status: 403, token: null, headers: { 'x-ratelimit-remaining': '0' }, match: /rate limit reached/ },
    { status: 403, token: null, body: { message: 'You have exceeded a secondary rate limit' }, match: /rate limit reached/ },
    { status: 429, token: null, match: /rate limit reached/ },
  ]
  for (const { status, token, headers, body, match } of cases) {
    const response = () => new Response(JSON.stringify(body ?? { message: 'secret URL and token must stay hidden' }),
      { status, headers })
    for (const request of ['release', 'asset']) {
      const run = request === 'release' ?
        fetchRelease(async () => response(), 'owner/repo', 'v0.1.0', token) :
        downloadAsset(async () => response(), 'owner/repo', { id: 1 }, token, '/unused')
      await assert.rejects(run, error => {
        assert.equal(error.code, 'UPSTREAM_FAILURE')
        assert.match(error.message, match)
        assert.doesNotMatch(error.message, /secret URL|test-token/)
        return true
      })
    }
  }
})

test('network failures do not expose a token or a signed download URL', async () => {
  const fetcher = async () => { throw new Error('private-token https://signed.example/?signature=secret') }
  await assert.rejects(fetchRelease(fetcher, 'owner/repo', 'v0.1.0', 'private-token'), error => {
    assert.equal(error.code, 'UPSTREAM_FAILURE')
    assert.match(error.message, /network or proxy/)
    assert.doesNotMatch(error.message, /private-token|signature=secret/)
    return true
  })
})

test('a signed asset host failure gives safe link guidance without blaming the GitHub token', async () => {
  const signedUrl = 'https://objects.githubusercontent.com/private?signature=private-secret'
  const headers = []
  const fetcher = async (_url, options) => {
    headers.push(options.headers)
    return headers.length === 1 ? new Response(null, { status: 302, headers: { location: signedUrl } }) :
      new Response(JSON.stringify({ message: 'private-secret' }), { status: 403 })
  }
  await assert.rejects(downloadAsset(fetcher, 'owner/repo', { id: 1 }, 'test-token', '/unused'), error => {
    assert.equal(error.code, 'UPSTREAM_FAILURE')
    assert.match(error.message, /fresh link or install the package locally/)
    assert.doesNotMatch(error.message, /saved token|test-token|private-secret|signature=/)
    return true
  })
  assert.equal(headers[0].Authorization, 'Bearer test-token')
  assert.equal(headers[1].Authorization, undefined)
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

test('DSH job saturation maps to CONFLICT without starting an installation', async t => {
  const directory = await testDirectory('job-limit')
  const app = await boot(directory)
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const jobs = app.components.jobs
  const taskId = jobs.start({ kind: 'other-work', label: 'Hold the owner slot',
    run: () => ({ done, cancel: () => finish({ status: 'completed' }) }) })
  t.after(async () => {
    finish({ status: 'completed' })
    await jobs.wait(taskId, 30_000)
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  assert.throws(() => app.components.install(), error => {
    assert.equal(error.code, 'CONFLICT')
    assert.match(error.message, /Wait for the active task/)
    return true
  })
  assert.equal((await app.components.status()).task, null)
})
