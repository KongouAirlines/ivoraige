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
  capability: 'synthetic-unit-test-capability' }
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
  for (const result of [{ large: 'x'.repeat(1024 * 1024) }, undefined, { notJson: 1n }]) {
    let reply = ''
    const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { reply += chunk; callback() } })
    await dispatchHostAction(socket, request, { ...context, handleBusiness: () => { effects++; return result } })
    const failure = JSON.parse(reply)
    assert.equal(failure.ok, false)
    assert.equal(failure.apiVersion, '2.0')
    assert.equal(failure.error.code, 'CONFLICT')
    assert.deepEqual(failure.error.details, { reason: 'outcome-unknown' })
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
  await dispatchHostAction(socket, { ...request, action: 'exit', params: { budgetMs: 100 } }, options)
  assert.equal(accepted, 1)
  assert.equal(socket.writableEnded, false)
  socket.destroy()
})
