import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { SidecarClient } from '../src/sidecar.mjs'
import { errorEnvelope } from '../src/protocol.mjs'

const fixture = fileURLToPath(new URL('./fixtures/pdf-sidecar-diagnostics.mjs', import.meta.url))
const release = child => child.stdin.write('{"method":"test.release"}\n')
async function client(t) {
  const sidecar = new SidecarClient({ command: process.execPath, args: [fixture], timeoutMs: 10_000 })
  t.after(() => sidecar.close())
  await sidecar.request('success')
  return sidecar
}
function check(error, diagnostic) {
  assert.equal(error.code, 'UPSTREAM_FAILURE')
  assert.equal(error.message, 'rebuild failed')
  assert.equal(error.cause?.message, diagnostic?.slice(-4096))
  assert.deepEqual(error.details, { stage: 'sidecar', sidecarCode: -32003, sidecarData: { code: 'UPSTREAM_FAILURE' } })
  assert.doesNotMatch(JSON.stringify(errorEnvelope(error)), /private/)
  return true
}

test('diagnostics follow request IDs in both pipe orders without delaying responses or successes', { timeout: 15_000 }, async t => {
  const sidecar = await client(t)
  const child = sidecar.session.child
  const first = 'private first request\n'
  const stderr = once(child.stderr, 'data')
  const rejected = assert.rejects(sidecar.request('rebuild', { diagnostic: first, order: 'stderr-first' }), error => check(error, first))
  await stderr // The error response cannot be emitted until this barrier is released.
  release(child)
  await rejected
  const second = 'private second request\n'
  await assert.rejects(sidecar.request('rebuild', { diagnostic: second }), error => check(error, second))
  // stderr is still held: neither failure nor the next successful RPC may wait for it.
  assert.deepEqual(await sidecar.request('success'), { ok: true })
  const late = once(child.stderr, 'data')
  release(child)
  await late
  await assert.rejects(sidecar.request('rebuild'), error => check(error, undefined))
  assert.deepEqual(await sidecar.request('success'), { ok: true })
  const legacy = once(child.stderr, 'data')
  release(child)
  await legacy
  const long = 'private ' + 'x'.repeat(5000) + ' private bounded tail'
  await assert.rejects(sidecar.request('rebuild', { diagnostic: long }), error => check(error, long))
  assert.equal(sidecar.session.child, child)
})

test('crash diagnostics drain after exit, stay private and preserve one retry', { timeout: 15_000 }, async t => {
  const sidecar = await client(t)
  let exits = 0
  const sessions = []
  await assert.rejects(sidecar.request('exit', {}, { onProgress() {
    const session = sidecar.session
    sessions.push(session)
    const child = session.child
    child.stderr.pause()
    child.once('exit', () => {
      exits++
      assert.equal(session.stderr, '') // No stderr callback has run at the exit boundary.
      child.stderr.resume()
    })
    release(child)
  } }), error => {
    assert.equal(error.code, 'UPSTREAM_FAILURE')
    assert.match(error.cause?.message, /private terminal diagnostic/)
    assert.doesNotMatch(JSON.stringify(errorEnvelope(error)), /private/)
    return true
  })
  assert.equal(exits, 2)
  for (const session of sessions) assert.equal(session.child.stderr.closed, true)
})

test('timeout drains diagnostics; cancel and close retain their clean terminal errors', { timeout: 15_000 }, async t => {
  for (const action of ['timeout', 'cancel', 'close']) {
    const sidecar = await client(t)
    const session = sidecar.session
    const controller = new AbortController()
    const stderr = once(session.child.stderr, 'data')
    if (action === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] })
    const rejected = assert.rejects(sidecar.request('hang', {}, { signal: controller.signal }), error => {
      if (action === 'timeout') {
        assert.match(error.message, /timed out/)
        assert.match(error.cause?.message, /private timeout diagnostic/)
      } else {
        assert.equal(error.cause, undefined)
        assert.equal(error.code, action === 'cancel' ? 'UPSTREAM_FAILURE' : 'PRECONDITION_FAILED')
        if (action === 'cancel') assert.equal(error.details.canceled, true)
      }
      assert.doesNotMatch(JSON.stringify(errorEnvelope(error)), /private/)
      return true
    })
    await stderr
    if (action === 'timeout') {
      // Fire the already installed timeout deterministically; no scheduling delay is needed.
      t.mock.timers.tick(10_000)
    } else if (action === 'cancel') controller.abort()
    else await sidecar.close()
    await rejected
    if (action === 'timeout') t.mock.timers.reset()
    assert.equal(session.child.stderr.closed, true)
  }
})
