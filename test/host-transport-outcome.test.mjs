import test from 'node:test'
import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'
import { mkdtemp, realpath, lstat, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dispatchHostAction, exchangeHostFrame } from '../src/host-transport.mjs'
import { hostSocketDirectory, releaseHostSocketDirectory } from '../src/host-socket-directory.mjs'
import { KernelError } from '../src/errors.mjs'

const request = { interfaceVersion: 'HostControl@1', minor: 0, requestId: 'outcome-test',
  expectedGeneration: 'generation-test', action: 'business', params: { method: 'operation', input: {} },
  capability: 'synthetic-unit-test-capability', acceptTransfer: 'base64-json' }
const context = { dataDomainRef: 'domain-test', generation: 'generation-test', capability: request.capability,
  getState: () => ({ dataDomainRef: 'domain-test', generation: 'generation-test',
    storeOwnership: 'held', acceptingBusiness: true }) }
const unknown = { code: 'CONFLICT', details: { reason: 'outcome-unknown' } }

function replySocket(reply, onWrite = () => {}) {
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) {
    onWrite(chunk)
    queueMicrotask(() => this.push(Buffer.from(reply)))
    callback()
  } })
  queueMicrotask(() => socket.emit('connect'))
  return socket
}

test('socket-free response corruption/size failure is outcome-unknown, not rejected input', async () => {
  for (const reply of ['x'.repeat(1024 * 1024 + 1), 'not-json\n', '{}\n{}\n',
    '{"ok":true}\n', '{"ok":false}\n']) {
    let submitted = false
    await assert.rejects(exchangeHostFrame('unused', request, {
      createSocket: () => replySocket(reply, () => { submitted = true }) }), unknown)
    assert.equal(submitted, true)
  }
  await assert.rejects(exchangeHostFrame('unused', { action: 'attach' }, {
    createSocket: () => replySocket('not-json\n') }),
  { code: 'CONFLICT', details: { reason: 'owner-unreachable' } })
  const rejection = { ok: false, apiVersion: '2.0', error: { code: 'INVALID_ARGUMENT',
    message: 'Invalid operation input', details: { reason: 'invalid-request' } } }
  await assert.rejects(exchangeHostFrame('unused', request, {
    createSocket: () => replySocket(`${JSON.stringify(rejection)}\n`) }),
  { code: 'INVALID_ARGUMENT', details: { reason: 'invalid-request' } })
  let wroteOversizedInput = false
  await assert.rejects(exchangeHostFrame('unused', { ...request, params: { method: 'operation', input: 'x'.repeat(1024 * 1024) } }, {
    createSocket: () => replySocket('', () => { wroteOversizedInput = true }) }),
  { code: 'INVALID_ARGUMENT', details: { reason: 'invalid-request' } })
  assert.equal(wroteOversizedInput, false)
})

test('socket-free handler result delivery failure never claims a committed side effect did not happen', async () => {
  let effects = 0
  for (const result of [{ large: 'x'.repeat(32 * 1024 * 1024) }, undefined, { notJson: 1n }]) {
    let reply = ''
    const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { reply += chunk; callback() } })
    await dispatchHostAction(socket, request, { ...context, handleBusiness: () => { effects++; return result } })
    const failure = JSON.parse(reply)
    assert.equal(failure.ok, false)
    assert.equal(failure.apiVersion, '2.0')
    assert.equal(failure.error.code, 'CONFLICT')
    assert.deepEqual(failure.error.details, { reason: result?.large ? 'response-too-large' : 'outcome-unknown' })
    socket.destroy()
  }
  assert.equal(effects, 3)
  let reply = ''
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { reply += chunk; callback() } })
  await dispatchHostAction(socket, request, { ...context,
    handleBusiness: () => { throw new KernelError('INVALID_ARGUMENT', 'Invalid input', { reason: 'invalid-request' }) } })
  assert.equal(JSON.parse(reply).error.code, 'INVALID_ARGUMENT')
  socket.destroy()
})

test('chunked business reply rejects malformed, oversized, and truncated transfers as outcome-unknown', async () => {
  const header = (bytes, chunks) => `${JSON.stringify({ ok: true,
    transfer: { encoding: 'base64-json', bytes, chunks } })}\n`
  const body = Buffer.from(JSON.stringify({ ok: true, result: { data: 'x'.repeat(1024 * 1024) } }))
  const first = body.subarray(0, 512 * 1024)
  const part = (index, bytes) => `${JSON.stringify({ index, data: bytes.toString('base64') })}\n`
  const cases = [
    header(33 * 1024 * 1024, 66),
    header(body.length, 1),
    header(body.length, 3),
    header(body.length, 3) + part(1, first),
    header(body.length, 3) + part(0, Buffer.alloc(first.length, 0)),
    header(body.length, 3) + part(0, first) + 'not-json\n',
  ]
  for (const reply of cases)
    await assert.rejects(exchangeHostFrame('unused', request, {
      createSocket: () => {
        const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) {
          queueMicrotask(() => { this.push(Buffer.from(reply)); this.push(null) })
          callback()
        } })
        queueMicrotask(() => socket.emit('connect'))
        return socket
      } }), unknown)
})

test('800 KiB artifact crosses bounded business frames without a Unix socket', async () => {
  const artifact = Buffer.alloc(800 * 1024, 0xa5).toString('base64')
  const result = { contents: [{ uri: 'ivoraige://artifact/one', blob: artifact }] }
  const frames = []
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) {
    frames.push(Buffer.from(chunk)); callback()
  } })
  await dispatchHostAction(socket, { ...request, action: 'mcp.read',
    params: { name: 'artifact', uri: 'ivoraige://artifact/one', variables: {} } },
  { ...context, handleBusiness: () => result })
  assert.ok(frames.length >= 4)
  assert.ok(frames.every(frame => frame.length <= 1024 * 1024))
  assert.deepEqual(await exchangeHostFrame('unused', request, {
    createSocket: () => replySocket(Buffer.concat(frames)) }), result)
  socket.destroy()
})

test('legacy business requester is never sent a transfer it did not accept', async () => {
  const frames = []
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) {
    frames.push(Buffer.from(chunk)); callback()
  } })
  const { acceptTransfer, ...legacy } = request
  await dispatchHostAction(socket, legacy, { ...context,
    handleBusiness: () => ({ artifact: 'x'.repeat(1024 * 1024) }) })
  assert.equal(frames.length, 1)
  assert.deepEqual(JSON.parse(frames[0]).error.details, { reason: 'outcome-unknown' })
  socket.destroy()
})

test('chunk sender waits for each slow write before queuing the next broker frame', async () => {
  const frames = [], callbacks = []
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) {
    frames.push(Buffer.from(chunk)); callbacks.push(callback)
  } })
  const pending = dispatchHostAction(socket, request, { ...context,
    handleBusiness: () => ({ artifact: 'x'.repeat(4 * 1024 * 1024) }) })
  const until = async count => {
    for (let i = 0; i < 100 && frames.length < count; i++)
      await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(frames.length, count)
  }
  await until(1)
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(frames.length, i + 1)
    callbacks[i]()
    await until(i + 2)
  }
  while (!socket.writableEnded) {
    const index = callbacks.length - 1
    callbacks[index]()
    await new Promise(resolve => setTimeout(resolve, 0))
    if (frames.length === index + 1 && !socket.writableEnded) await until(index + 2)
  }
  await pending
  assert.ok(frames.every(frame => frame.length <= 1024 * 1024))
  socket.destroy()
})

test('stalled chunk delivery expires once, frees its business slot, and never reruns the handler', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const action of ['business', 'mcp.read']) {
    let effects = 0, active = 0, released = 0, writing
    const frames = []
    const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) {
      frames.push(Buffer.from(chunk)); writing = callback
    } })
    const pending = dispatchHostAction(socket, action === 'business' ? request : {
      ...request, action, params: { name: 'artifact', uri: 'ivoraige://artifact/one', variables: {} },
    }, { ...context,
      acquireBusiness() { active++; return () => { active--; released++ } },
      handleBusiness() { effects++; return { artifact: 'x'.repeat(2 * 1024 * 1024) } },
    })
    // Allow state lookup and handler completion without advancing fake time.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(frames.length, 1)
    assert.equal(active, 1)
    t.mock.timers.tick(20_000)
    writing() // Header completed, but the first data chunk now stalls.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(frames.length, 2)
    t.mock.timers.tick(9_999)
    assert.equal(socket.destroyed, false)
    assert.equal(active, 1)
    t.mock.timers.tick(1) // One total deadline, not a fresh budget per chunk.
    await pending
    assert.equal(socket.destroyed, true)
    assert.equal(active, 0)
    assert.equal(released, 1)
    assert.equal(effects, 1)
    assert.equal(frames.length, 2) // No fallback frame appended to a partial reply.
    assert.equal(socket.listenerCount('close'), 0)
    writing() // A late native write acknowledgment must not release twice.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(released, 1)
    // The receiver reports truncated delivery as outcome-unknown, not rollback.
    await assert.rejects(exchangeHostFrame('unused', request, {
      createSocket: () => {
        const peer = replySocket(Buffer.concat(frames))
        queueMicrotask(() => peer.push(null))
        return peer
      },
    }), unknown)
  }
})

test('chunk deadline starts after business and is cleared on successful delivery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finishBusiness, active = 0, released = 0
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
  const pending = dispatchHostAction(socket, request, { ...context,
    acquireBusiness() { active++; return () => { active--; released++ } },
    handleBusiness: () => new Promise(resolve => { finishBusiness = resolve }),
  })
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(60_000)
  assert.equal(socket.destroyed, false)
  assert.equal(active, 1)
  finishBusiness({ artifact: 'x'.repeat(2 * 1024 * 1024) })
  await pending
  assert.equal(socket.writableEnded, true)
  assert.equal(active, 0)
  assert.equal(released, 1)
  t.mock.timers.tick(60_000)
  assert.equal(socket.destroyed, false)
  assert.equal(socket.listenerCount('close'), 0)
  socket.destroy()
})

test('local broker and stream failures after submission are outcome-unknown, not permission rejections', async () => {
  const permissionFailure = () => new KernelError('PRECONDITION_FAILED', 'Native helper failed',
    { reason: 'owner-permissions-unverified' })
  for (const failure of [permissionFailure(), Object.assign(new Error('Stream ended'),
    { code: 'ERR_STREAM_PREMATURE_CLOSE' })]) {
    let effects = 0
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) {
      effects++
      callback()
      queueMicrotask(() => this.destroy(failure))
    } })
    queueMicrotask(() => socket.emit('connect'))
    await assert.rejects(exchangeHostFrame('unused', request, { createSocket: () => socket }), unknown)
    assert.equal(effects, 1)
  }
  // A failure before connection and a verified rejection frame still carry
  // their original meaning; only a local reply-channel fault is normalized.
  const unconnected = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
  queueMicrotask(() => unconnected.destroy(permissionFailure()))
  await assert.rejects(exchangeHostFrame('unused', request, { createSocket: () => unconnected }),
    { code: 'PRECONDITION_FAILED', details: { reason: 'owner-permissions-unverified' } })
  const rejection = { ok: false, apiVersion: '2.0', error: { code: 'PRECONDITION_FAILED',
    message: 'Owner refused request', details: { reason: 'owner-permissions-unverified' } } }
  await assert.rejects(exchangeHostFrame('unused', request, {
    createSocket: () => replySocket(`${JSON.stringify(rejection)}\n`) }),
  { code: 'PRECONDITION_FAILED', details: { reason: 'owner-permissions-unverified' } })
})

test('random socket leaves are retired without deleting shared or unowned directories',
  { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(join(await realpath('/tmp'), 'io-'))
    const options = { runtimeDirectory: '', userTemporaryDirectory: '',
      homeDirectory: `${root}/${'x'.repeat(120)}`, sharedTemporaryDirectory: root }
    try {
      const first = await hostSocketDirectory(root, options)
      const second = await hostSocketDirectory(root, options)
      await releaseHostSocketDirectory(first)
      await assert.rejects(lstat(first), { code: 'ENOENT' })
      assert.ok((await lstat(second)).isDirectory())
      await releaseHostSocketDirectory(first) // idempotent
      const residue = join(second, 'not-a-socket')
      await writeFile(residue, 'must not be recursively removed')
      await assert.rejects(releaseHostSocketDirectory(second), error => ['ENOTEMPTY', 'EEXIST'].includes(error.code))
      assert.ok((await lstat(residue)).isFile())
      await rm(residue)
      await releaseHostSocketDirectory(second) // failed cleanup retained ownership for retry
      await assert.rejects(lstat(second), { code: 'ENOENT' })
      const shared = await hostSocketDirectory(root, { ...options, runtimeDirectory: root, userTemporaryDirectory: root })
      await releaseHostSocketDirectory(shared)
      assert.ok((await lstat(shared)).isDirectory())
      const unowned = join(root, 'ivoraige-unowned-XXXXXX')
      await mkdir(unowned, { mode: 0o700 })
      await releaseHostSocketDirectory(unowned)
      assert.ok((await lstat(unowned)).isDirectory())
    } finally { await rm(root, { recursive: true, force: true }) }
  })

test('accepted exit retains its finalization channel after shared dispatch validation', async () => {
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
  let accepted = 0
  const result = { accepted: true, operationId: 'exit-op' }
  const options = { ...context, handleControl: () => result,
    onAcceptedExit(peer, value) { assert.equal(peer, socket); assert.equal(value, result); accepted++ } }
  await dispatchHostAction(socket, { ...request, acceptTransfer: undefined,
    action: 'exit', params: { budgetMs: 100 } }, options)
  assert.equal(accepted, 1)
  assert.equal(socket.writableEnded, false)
  socket.destroy()
})
