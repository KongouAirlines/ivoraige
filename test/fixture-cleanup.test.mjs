import test from 'node:test'
import assert from 'node:assert/strict'
import { createCleanup } from './fixtures/cleanup.mjs'

function fixture() {
  const hooks = []
  const defer = createCleanup({ after: hook => hooks.push(hook) })
  return { defer, async cleanup() { for (const hook of hooks) await hook() } }
}

test('fixture failure releases a blocked resource before closing its owner and removing files', async () => {
  const f = fixture(), calls = []
  let resume
  const pending = new Promise(resolve => { resume = resolve })
  let released = false
  f.defer(() => { calls.push('remove'); assert.equal(released, true) })
  f.defer(async () => {
    calls.push('dispose')
    assert.equal(released, true, 'blocked file-stat must be released before disposal')
    await pending
  })
  f.defer(() => { calls.push('restore'); released = true; resume() })
  // A body failure leaves the file-stat gate blocked until teardown.
  await assert.rejects(async () => { throw new Error('injected body failure') }, /injected body failure/)
  await f.cleanup()
  assert.deepEqual(calls, ['restore', 'dispose', 'remove'])
})

test('fixture cleanup attempts all disposers and preserves their failures', async () => {
  const f = fixture(), calls = [], errors = [new Error('restore failed'), new Error('dispose failed')]
  f.defer(() => { calls.push('remove') })
  f.defer(() => { calls.push('dispose'); throw errors[1] })
  f.defer(() => { calls.push('restore'); throw errors[0] })
  await assert.rejects(f.cleanup(), error => error instanceof AggregateError &&
    error.errors.length === 2 && error.errors.every((item, i) => item === errors[i]))
  assert.deepEqual(calls, ['restore', 'dispose', 'remove'])
})

test('source fixture registers disposal before an import can reject', async () => {
  const f = fixture(), calls = []
  f.defer(() => { calls.push('remove') })
  const app = { dispose: async () => { calls.push('dispose') },
    import: async () => { throw new Error('injected import failure') } }
  f.defer(() => app.dispose())
  await assert.rejects(app.import(), /injected import failure/)
  await f.cleanup()
  assert.deepEqual(calls, ['dispose', 'remove'])
})

// Exercise the actual fixtures, not only the cleanup stack. The child is
// expected to fail its body, but must restore globals and remove its directory.
import { readFile, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const exec = promisify(execFile)

for (const [file, name, trigger, directory] of [
  ['resource-access', 'the shared resource file-stat await', '  await entered.promise\n', 'dir'],
  ['resource-access', 'shutdown keeps storage owned', '  await entered\n', 'dir'],
  ['source-mode', 'CLI accepts source content', "  const { document } = await app.records.importDocument", 'directory'],
]) {
  test(`actual ${name} fixture cleans after an injected body failure`, async () => {
    let source = await readFile(new URL(`./${file}.test.mjs`, import.meta.url), 'utf8')
    // Check both checkout representations cheaply; execute the identical normalized fixture once.
    const normalized = source.replaceAll('\r\n', '\n')
    assert.equal(source.replace(/\r?\n/g, '\r\n').replaceAll('\r\n', '\n'), normalized)
    // Git may check JavaScript out with CRLF; injection anchors use LF.
    source = source.replaceAll('\r\n', '\n')
    const start = source.indexOf(`test('${name}`)
    assert.notEqual(start, -1)
    const end = source.indexOf("\ntest('", start + 1)
    let body = source.slice(start, end === -1 ? undefined : end)
    if (file === 'resource-access') body = body.replace(
      'const { app, document', 'const { app, dir, document')
    const position = body.indexOf(trigger)
    assert.notEqual(position, -1)
    const offset = file === 'source-mode' ? position : position + trigger.length
    body = body.slice(0, offset) + `
  let probeDisposed = false
  const probeDispose = app.dispose
  app.dispose = async (...args) => { await probeDispose.call(app, ...args); probeDisposed = true }
  t.after(async () => {
    assert.equal(probeDisposed, true, 'fixture must dispose its application')
    assert.equal(probeFs.promises.open, probeOpen)
    await assert.rejects(probeFs.promises.stat(${directory}), { code: 'ENOENT' })
    console.log('injected failure cleanup verified')
  })
  throw new Error('injected fixture body failure')
` + body.slice(offset)
    source = source.slice(0, start) + body + (end === -1 ? '' : source.slice(end))
    source = source.replaceAll("'../src/", "'../../src/")
      .replaceAll("'./fixtures/cleanup.mjs'", "'./cleanup.mjs'")
    source = "import probeFs from 'node:fs'; const probeOpen = probeFs.promises.open;\n" + source
    const path = new URL(`./fixtures/cleanup-probe-${randomUUID()}.mjs`, import.meta.url)
    try {
      await writeFile(path, source)
      await assert.rejects(exec(process.execPath, ['--test', '--test-name-pattern', name,
        fileURLToPath(path)], { timeout: 10000,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) }), error => {
        assert.equal(error.code, 1)
        assert.match(error.stdout, /injected fixture body failure/)
        assert.match(error.stdout, /injected failure cleanup verified/)
        assert.doesNotMatch(error.stdout, /test timed out|hookFailed|Fixture cleanup failed/)
        return true
      })
    } finally { await rm(path, { force: true }) }
  })
}
