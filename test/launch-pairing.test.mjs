import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBrowserPairingPage, openBrowser } from '../src/launch.mjs'

test('browser opener receives only a private file URL, never the pairing secret', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-pairing-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const secret = 'secret-for-this-test'
  const page = await createBrowserPairingPage(dataDir, 'http://127.0.0.1:4321', secret)
  t.after(() => page.cleanup())
  assert.ok(page.url.startsWith('file://'))
  assert.ok(!page.url.includes(secret))
  assert.ok(!page.url.includes('owner='))
  const path = fileURLToPath(page.url)
  const html = await readFile(path, 'utf8')
  assert.ok(html.includes(`http://127.0.0.1:4321/#owner=${secret}`))
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal((await stat(join(dataDir, '.browser-pairing'))).mode & 0o777, 0o700)
  }
  await page.cleanup()
  await assert.rejects(readFile(path), { code: 'ENOENT' })
})

test('default browser opener rejects a spawn failure', { skip: process.platform === 'win32' }, async () => {
  const previous = process.env.PATH
  process.env.PATH = ''
  try {
    await assert.rejects(openBrowser('file:///does-not-exist.html'), /Could not open the browser/)
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
})

test('pairing cleanup timer does not keep a completed launcher process alive', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-pairing-exit-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const moduleUrl = new URL('../src/launch.mjs', import.meta.url).href
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `import { createBrowserPairingPage } from ${JSON.stringify(moduleUrl)};
     const page = await createBrowserPairingPage(${JSON.stringify(dataDir)}, 'http://127.0.0.1:4321', 'test-secret');
     console.log(page.url);`], { timeout: 5000 })
  // Leaving the file is intentional: an asynchronous browser can still load it.
  assert.match(await readFile(fileURLToPath(stdout.trim()), 'utf8'), /test-secret/)
})
