import './fixtures/host-test-env.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCli } from '../src/cli.mjs'

function capture() {
  const calls = []
  const app = { reused: true, cli: { invoke: async (operation, input) => {
    calls.push({ operation, input })
    return { apiVersion: '2.0', ok: true }
  } } }
  const stream = { write() {} }
  return { app, calls, stream }
}

test('CLI resolves owner-side filesystem arguments from caller cwd', async () => {
  const originalCwd = process.cwd()
  // chdir/getcwd resolves system aliases such as macOS /var -> /private/var.
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'ivoraige-cli-cwd-')))
  const { app, calls, stream } = capture()
  try {
    process.chdir(cwd)
    assert.notEqual(cwd, originalCwd)
    assert.equal(await runCli(['import', '--path', 'input.txt', '--source-lang', 'en'],
      { app, stdout: stream, stderr: stream }), 0)
    assert.equal(calls.at(-1).input.path, resolve(cwd, 'input.txt'))
    assert.equal(await runCli(['import', 'positional.txt', '--source-lang', 'en'],
      { app, stdout: stream, stderr: stream }), 0)
    assert.equal(calls.at(-1).input.path, resolve(cwd, 'positional.txt'))
    assert.equal(await runCli(['export', 'doc', '--format', 'md', '--target-lang', 'zh-CN', '--out', 'out.md'],
      { app, stdout: stream, stderr: stream }), 0)
    assert.equal(calls.at(-1).input.outputs[0].out, resolve(cwd, 'out.md'))
    assert.equal(await runCli(['components', 'local', '--path', 'manifest.json', '--no-wait'],
      { app, stdout: stream, stderr: stream }), 0)
    assert.equal(calls.at(-1).input.path, resolve(cwd, 'manifest.json'))
  } finally {
    process.chdir(originalCwd)
    await rm(cwd, { recursive: true, force: true })
  }
})

test('--url requires an explicitly selected store', async () => {
  let output = ''
  const code = await runCli(['--url', 'http://127.0.0.1:8787', 'documents'],
    { stdout: { write() {} }, stderr: { write(value) { output += value } } })
  assert.notEqual(code, 0)
  assert.match(output, /--url requires an explicit --store/)
})

test('--url without a resident owner reports the selected-store requirement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-cli-url-'))
  let output = ''
  const stdout = { write() {} }
  const stderr = { write(value) { output += value } }
  try {
    const code = await runCli(['--store', join(directory, 'store.sqlite'), '--url', 'http://127.0.0.1:8787', 'documents'],
      { stdout, stderr })
    assert.notEqual(code, 0)
    assert.match(output, /--url requires a resident owner for the selected --store/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
