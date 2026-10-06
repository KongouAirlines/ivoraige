import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SidecarClient } from '../src/sidecar.mjs'

const fixture = fileURLToPath(new URL('./fixtures/pdf-sidecar.mjs', import.meta.url))
const client = (mode = 'normal', extras = []) => new SidecarClient({
  command: process.execPath, args: [fixture, mode, ...extras], timeoutMs: 500
})

test('lazy handshake, configure, progress, serial calls and shutdown', async () => {
  const sidecar = client('slow')
  assert.equal(sidecar.session, null)
  const progress = []
  const first = sidecar.request('parse', { path: 'a.pdf' }, { onProgress: value => progress.push(value) })
  const second = sidecar.request('rebuild', { out: 'b.pdf' })
  assert.deepEqual(await first, { method: 'parse', params: { path: 'a.pdf' } })
  assert.deepEqual(await second, { method: 'rebuild', params: { out: 'b.pdf' } })
  assert.deepEqual(progress, [{ stage: 'parse', done: 1, total: 2 }])
  assert.deepEqual(sidecar.capabilities, { parse: ['pdf'] })
  await sidecar.close()
  await assert.rejects(sidecar.request('parse'), { code: 'PRECONDITION_FAILED' })
})

test('missing executable and mismatched handshake are component errors', async () => {
  const missing = new SidecarClient({ command: join(tmpdir(), 'missing-sidecar-executable'), timeoutMs: 500 })
  await assert.rejects(missing.request('parse'), { code: 'COMPONENT_MISSING' })
  await missing.close()
  const mismatch = client('bad-version')
  await assert.rejects(mismatch.request('parse'), { code: 'COMPONENT_MISSING' })
  await mismatch.close()
})

test('sidecar error codes and malformed stdout map to kernel errors', async () => {
  for (const [mode, code] of [['missing-assets', 'COMPONENT_MISSING'], ['remote-error', 'UPSTREAM_FAILURE'],
    ['rebuild-error', 'UPSTREAM_FAILURE'], ['malformed', 'UPSTREAM_FAILURE']]) {
    const sidecar = client(mode)
    await assert.rejects(sidecar.request('parse'), { code })
    await sidecar.close()
  }
})

test('one process crash is retried once; two crashes fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-sidecar-'))
  try {
    const once = client('crash-once', [join(directory, 'marker')])
    assert.deepEqual(await once.request('parse'), { method: 'parse', params: {} })
    await once.close()
    const always = client('crash-always')
    await assert.rejects(always.request('parse'), { code: 'UPSTREAM_FAILURE' })
    await always.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('abort active request kills child and queued cancellation does not run', async () => {
  const sidecar = client('hang')
  const controller = new AbortController()
  const queued = new AbortController()
  const first = sidecar.request('parse', {}, { signal: controller.signal })
  const second = sidecar.request('rebuild', {}, { signal: queued.signal })
  const firstRejected = assert.rejects(first, error => error.code === 'UPSTREAM_FAILURE' && error.details.canceled === true)
  const secondRejected = assert.rejects(second, error => error.code === 'UPSTREAM_FAILURE' && error.details.canceled === true)
  queued.abort()
  controller.abort()
  await firstRejected
  await secondRejected
  await sidecar.close()
})

test('canceling a queued request preserves the active call and later work', async () => {
  const sidecar = client('slow')
  const controller = new AbortController()
  const first = sidecar.request('parse', { path: 'first.pdf' })
  const skipped = sidecar.request('parse', { path: 'skip.pdf' }, { signal: controller.signal })
  const third = sidecar.request('parse', { path: 'third.pdf' })
  const skippedRejected = assert.rejects(skipped, error => error.details.canceled === true)
  controller.abort()
  await skippedRejected
  assert.equal((await first).params.path, 'first.pdf')
  assert.equal((await third).params.path, 'third.pdf')
  await sidecar.close()
})

test('close sends shutdown to an idle sidecar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-sidecar-'))
  const marker = join(directory, 'shutdown')
  try {
    const sidecar = client('normal', [marker])
    await sidecar.request('parse')
    await sidecar.close()
    assert.equal(await readFile(marker, 'utf8'), 'shutdown')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('timeout and close reject pending calls', async () => {
  const timeout = client('hang')
  await assert.rejects(timeout.request('parse'), { code: 'UPSTREAM_FAILURE' })
  await timeout.close()
  const sidecar = client('hang')
  const first = sidecar.request('parse')
  const second = sidecar.request('rebuild')
  const firstRejected = assert.rejects(first, { code: 'PRECONDITION_FAILED' })
  const secondRejected = assert.rejects(second, { code: 'PRECONDITION_FAILED' })
  await sidecar.close()
  await firstRejected
  await secondRejected
})

test('abort during handshake and configure releases active and queued callers', async () => {
  for (const mode of ['hang-handshake', 'hang-configure']) {
    const directory = await mkdtemp(join(tmpdir(), 'ivoraige-sidecar-'))
    const marker = join(directory, 'phase')
    try {
      const sidecar = client(mode, [marker])
      const controller = new AbortController()
      const active = sidecar.request('parse', {}, { signal: controller.signal })
      const queued = sidecar.request('rebuild')
      const activeRejected = assert.rejects(active, error => error.details.canceled === true)
      const queuedRejected = assert.rejects(queued, { code: 'PRECONDITION_FAILED' })
      const deadline = Date.now() + 1000
      while (true) {
        try { assert.equal(await readFile(marker, 'utf8'), mode.slice(5)); break } catch (error) {
          if (Date.now() > deadline) throw error
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      controller.abort()
      await sidecar.close()
      await activeRejected
      await queuedRejected
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
})

test('an aborted active request settles after the child closes', async () => {
  const sidecar = client('hang')
  const controller = new AbortController()
  const pending = sidecar.request('parse', {}, { signal: controller.signal })
  const rejected = assert.rejects(pending, error => error.details.canceled === true)
  const deadline = Date.now() + 1000
  while (!sidecar.capabilities) {
    if (Date.now() > deadline) throw new Error('Sidecar did not finish configuration')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  let closed = false
  sidecar.session.child.once('close', () => { closed = true })
  controller.abort()
  await rejected
  assert.equal(closed, true)
  await sidecar.close()
})

test('non-JSON params reject without occupying transport', async () => {
  const sidecar = client()
  await assert.rejects(sidecar.request('parse', { value: 1n }), { code: 'INVALID_ARGUMENT' })
  assert.equal((await sidecar.request('parse')).method, 'parse')
  await sidecar.close()
})
