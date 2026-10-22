import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSupportedNode, SUPPORTED_NODE_RANGE } from '../src/runtime.mjs'
import packageInfo from '../package.json' with { type: 'json' }
import lockInfo from '../package-lock.json' with { type: 'json' }

test('the runtime policy excludes unpatched and unvalidated Node release lines', () => {
  assert.equal(SUPPORTED_NODE_RANGE, '>=24.22.1 <25 || >=26.12.1 <27')
  assert.equal(lockInfo.packages[''].engines.node, packageInfo.engines.node)
  for (const version of ['24.22.1', '24.23.0', '26.12.1', '26.13.0']) {
    assert.doesNotThrow(() => assertSupportedNode(version), version)
  }
  for (const version of ['22.23.4', '24.22.0', '25.0.0', '26.7.0', '26.12.0',
    '27.0.0', '26.13.0-rc.1', 'invalid']) {
    assert.throws(() => assertSupportedNode(version), { code: 'ERR_UNSUPPORTED_NODE_VERSION' }, version)
  }
})

function rejectedEntry(args, directory) {
  // Simulate only the reported version on a patched executable. No old binary
  // or vulnerability payload is needed to verify the startup boundary.
  const preload = 'data:text/javascript,' + encodeURIComponent(
    "Object.defineProperty(process.versions, 'node', { value: '26.7.0' })")
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', preload, ...args], {
      cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IVORAIGE_DATA_DIR: join(directory, 'data') },
    })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Unsupported runtime entry did not exit: ${stderr}`))
    }, 10_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

test('CLI, remote CLI, MCP, launcher and API reject an unpatched runtime before I/O', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-runtime-policy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let requests = 0
  const server = createServer((_req, res) => {
    requests++
    res.end('{}')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const url = `http://127.0.0.1:${server.address().port}`
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))
  const launcher = fileURLToPath(new URL('../src/launch.mjs', import.meta.url))
  const app = new URL('../src/app.mjs', import.meta.url).href
  const entries = [
    ['CLI', [cli, 'serve', '--store', join(directory, 'local', 'store.sqlite')]],
    ['remote CLI', [cli, '--url', url, 'documents']],
    ['MCP', [cli, 'mcp', '--stdio', '--store', join(directory, 'mcp', 'store.sqlite')]],
    ['launcher', [launcher, '--no-open', '--data-dir', join(directory, 'launcher')]],
    ['API', ['--input-type=module', '--eval',
      `import { createApp } from ${JSON.stringify(app)}; await createApp({ store: ${JSON.stringify(join(directory, 'api', 'store.sqlite'))} })`]],
  ]
  for (const [name, args] of entries) {
    const result = await rejectedEntry(args, directory)
    assert.notEqual(result.code, 0, name)
    assert.equal(result.signal, null, name)
    assert.equal(result.stdout, '', `${name} must keep protocol stdout empty`)
    assert.match(result.stderr, /Unsupported Node\.js 26\.7\.0/, name)
    assert.match(result.stderr, /ERR_UNSUPPORTED_NODE_VERSION/, name)
  }
  assert.equal(requests, 0, 'No remote request may precede the runtime check')
  assert.deepEqual(await readdir(directory), [], 'No data directory or store may precede the runtime check')
})
