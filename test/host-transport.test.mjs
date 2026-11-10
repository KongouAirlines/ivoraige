import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { Duplex } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import Ajv2020 from 'ajv/dist/2020.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostTransport, connectHostTransport, dispatchHostAction, exchangeHostFrame,
  formatHostFailure, validateHostAttach, validateHostRequest } from '../src/host-transport.mjs'
import { KernelError } from '../src/errors.mjs'
import { hostSocketDirectory } from '../src/host-socket-directory.mjs'
import { assertPrivateDirectory, assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from '../src/host-permissions.mjs'

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-'))
  const directory = join(root, 'control')
  try { await ensurePrivateDirectory(directory); return await fn(directory) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('private file helpers reject permissive files and directories', async () => fixture(async directory => {
  const file = join(directory, 'secret')
  await createPrivateFile(file, 'test')
  await assertPrivateFile(file)
  assert.equal(await readFile(file, 'utf8'), 'test')
  if (process.platform !== 'win32') {
    const { chmod } = await import('node:fs/promises')
    await chmod(file, 0o644)
    await assert.rejects(assertPrivateFile(file), { code: 'PRECONDITION_FAILED' })
    await chmod(directory, 0o755)
    await assert.rejects(ensurePrivateDirectory(directory), { code: 'PRECONDITION_FAILED' })
  }
}))

test('control frames enforce version, exact fields, and budget before dispatch', () => {
  const frame = { interfaceVersion: 'HostControl@1', minor: 0, requestId: 'r1',
    action: 'drain', expectedGeneration: 'g1', params: { budgetMs: 15_000 } }
  assert.deepEqual(validateHostRequest(frame).params, { budgetMs: 15_000 })
  assert.throws(() => validateHostRequest({ ...frame, params: { budgetMs: 0 } }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => validateHostRequest({ ...frame, params: { budgetMs: 15_000, surprise: true } }),
    { code: 'INVALID_ARGUMENT' })
  assert.throws(() => validateHostRequest({ ...frame, minor: 1 }), { code: 'PRECONDITION_FAILED' })
  assert.throws(() => validateHostRequest({ ...frame, principal: 'owner' }), { code: 'INVALID_ARGUMENT' })
  assert.deepEqual(validateHostRequest({ ...frame, action: 'business',
    params: { method: 'dynamicOperation', input: { approved: true } } }).params,
  { method: 'dynamicOperation', input: { approved: true } })
  assert.throws(() => validateHostRequest({ ...frame, action: 'business',
    params: { method: '__proto__', input: {} } }), { code: 'INVALID_ARGUMENT' })
})

test('OwnerIPC fixture requests match runtime validation and real error formatter matches schema', async () => {
  const base = new URL('../docs/requirements/0.1.x/', import.meta.url)
  const schema = JSON.parse(await readFile(new URL('schemas/host-control-v1.schema.json', base), 'utf8'))
  const { cases } = JSON.parse(await readFile(new URL('fixtures/host-control-v1.cases.json', base), 'utf8'))
  const ajv = new Ajv2020({ strict: false })
  ajv.addSchema(schema)
  const validFrame = ajv.getSchema(`${schema.$id}#/$defs/OwnerIPCFrame`)
  for (const fixture of cases.filter(item => item.definition === 'OwnerIPCRequest')) {
    const inspect = () => fixture.instance.action === 'attach'
      ? validateHostAttach(fixture.instance) : validateHostRequest(fixture.instance)
    if (fixture.valid) assert.doesNotThrow(inspect, fixture.id)
    else assert.throws(inspect, { code: 'INVALID_ARGUMENT' }, fixture.id)
  }
  const genericStart = cases.find(item => item.id === 'request-start').instance
  assert.throws(() => validateHostRequest(genericStart), { code: 'INVALID_ARGUMENT' })
  const ordinary = formatHostFailure(new KernelError('CONFLICT', 'Stale generation', { reason: 'stale-generation' }))
  const version = formatHostFailure(new KernelError('PRECONDITION_FAILED', 'Unsupported interface',
    { reason: 'interface-version-unsupported', supportedMinors: [0] }))
  for (const frame of [ordinary, version]) {
    assert.equal(validFrame(frame), true, JSON.stringify(validFrame.errors))
    assert.ok(frame.error.details.reason)
  }
  assert.deepEqual(version.error.details.supportedMinors, [0])
})

test('socket-free exchange keeps business response unbounded and distinguishes cancellation from uncertain result', async () => {
  const frame = { action: 'business' }
  const fakeSocket = (delay, response) => {
    const socket = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        if (response) setTimeout(() => this.push(Buffer.from(`${JSON.stringify(response)}\n`)), delay)
        callback()
      }
    })
    queueMicrotask(() => socket.emit('connect'))
    return socket
  }
  assert.deepEqual(await exchangeHostFrame('unused', frame, {
    createSocket: () => fakeSocket(5100, { ok: true, result: { done: true } }) }), { done: true })
  await assert.rejects(exchangeHostFrame('unused', frame, {
    createSocket: () => fakeSocket(100, { ok: true, result: {} }), timeoutMs: 10 }),
  { code: 'CONFLICT', details: { reason: 'outcome-unknown' } })
  const controller = new AbortController()
  let connecting
  const neverConnect = () => {
    connecting = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    return connecting
  }
  const pending = exchangeHostFrame('unused', frame, { createSocket: neverConnect, signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { code: 'CONFLICT', details: { reason: 'request-cancelled' } })
  assert.equal(connecting.destroyed, true)
})

test('disconnect during state lookup prevents business dispatch but does not cancel accepted exit', async () => {
  const state = { dataDomainRef: 'd', generation: 'g', storeOwnership: 'held', acceptingBusiness: true }
  const frame = action => ({ interfaceVersion: 'HostControl@1', minor: 0, requestId: 'r',
    expectedGeneration: 'g', action, params: action === 'business'
      ? { method: 'listDocuments', input: {} } : { budgetMs: 100 } })
  const socket = () => new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
  let releaseLookup, businessCalls = 0
  const lookup = new Promise(resolve => { releaseLookup = resolve })
  const businessSocket = socket()
  const pendingBusiness = dispatchHostAction(businessSocket, frame('business'), {
    dataDomainRef: 'd', generation: 'g', getState: () => lookup,
    handleBusiness: () => { businessCalls++; return {} } })
  const closedBusiness = once(businessSocket, 'close')
  businessSocket.destroy()
  await closedBusiness
  releaseLookup(state)
  await pendingBusiness
  assert.equal(businessCalls, 0)
  let finishExit, exitCalls = 0
  const exitWork = new Promise(resolve => { finishExit = resolve })
  const exitSocket = socket()
  const pendingExit = dispatchHostAction(exitSocket, frame('exit'), {
    dataDomainRef: 'd', generation: 'g', getState: () => state,
    handleControl: async () => { exitCalls++; await exitWork; return { exited: true } } })
  await Promise.resolve()
  assert.equal(exitCalls, 1)
  const closedExit = once(exitSocket, 'close')
  exitSocket.destroy()
  await closedExit
  finishExit()
  await pendingExit
  assert.equal(exitCalls, 1)
})

test('protected transport handshakes generation and rejects stale/unknown actions', async t => fixture(async directory => {
  const state = { dataDomainRef: 'domain-a', generation: 'generation-a', lifetime: 'resident',
    state: 'ready', storeOwnership: 'held', acceptingBusiness: true }
  const calls = []
  const host = createHostTransport({ directory, dataDomainRef: state.dataDomainRef,
    generation: state.generation, lifetime: 'resident', getState: () => state,
    handleControl: async (action, params) => { calls.push([action, params]); return { action, params } },
    handleBusiness: async (method, input) => ({ method, input }) })
  try {
    try { await host.start() }
    catch (error) {
      if (!process.env.CI && (error.code === 'EPERM' || error.code === 'EACCES')) {
        t.skip('Local sandbox does not permit Unix socket listening'); return
      }
      throw error
    }
    const client = await connectHostTransport({ directory, dataDomainRef: 'domain-a' })
    assert.equal(client.attached.generation, 'generation-a')
    assert.equal(client.attached.state.storeOwnership, 'held')
    if (process.platform === 'win32') {
      // An older native Node client can still use HostControl framing, but
      // same-user OS access alone never bypasses the generation capability.
      const { createConnection } = await import('node:net')
      const { once } = await import('node:events')
      const raw = createConnection(host.record.address)
      try {
        await once(raw, 'connect')
        const response = new Promise((resolve, reject) => {
          let line = ''
          raw.on('data', chunk => { line += chunk.toString(); if (line.includes('\n')) resolve(line) })
          raw.once('error', reject)
          raw.once('end', () => reject(new Error('Owner closed before the authentication response')))
        })
        raw.write(`${JSON.stringify({ interfaceVersion: 'HostControl@1', minor: 0,
          requestId: 'no-capability', action: 'attach',
          params: { dataDomainRef: 'domain-a', requiredLifetime: 'resident' } })}\n`)
        assert.equal(JSON.parse(await response).error.code, 'UNAUTHORIZED')
      } finally { raw.destroy() }
    }
    assert.equal((await client.request('state')).action, 'state')
    assert.equal((await client.request('business', { method: 'listDocuments', input: {} })).method, 'listDocuments')
    await assert.rejects(client.request('drain', { budgetMs: 0 }), { code: 'INVALID_ARGUMENT' })
    assert.equal((await client.request('business', { method: 'doesNotExist', input: {} })).method, 'doesNotExist')
    await assert.rejects(client.request('forceExit', { operationId: 'op', challengeId: 'ch',
      acknowledgeUnknownOutcome: true }), { code: 'PRECONDITION_FAILED' })
    state.storeOwnership = 'released'
    await assert.rejects(client.request('ownerBootstrap'), { code: 'CONFLICT' })
    assert.equal((await client.request('state')).action, 'state')
  } finally { await host.cleanupDiscovery(); await host.close() }
}))

test('ephemeral owner publishes only an in-process marker and refuses attach', async () => fixture(async directory => {
  const host = createHostTransport({ directory, dataDomainRef: 'domain-a', generation: 'generation-a',
    lifetime: 'ephemeral', getState: () => ({ storeOwnership: 'held' }) })
  try {
    assert.deepEqual(await host.start(), { dataDomainRef: 'domain-a', generation: 'generation-a',
      lifetime: 'ephemeral', address: null, kind: 'in-process' })
    await assert.rejects(connectHostTransport({ directory, dataDomainRef: 'domain-a' }),
      { code: 'CONFLICT', details: { reason: 'temporary-owner' } })
  } finally { await host.cleanupDiscovery(); await host.close() }
}))

test('shared temp fallback chooses a private random directory despite predictable-name occupation', async () => fixture(async directory => {
  if (process.platform === 'win32') return
  const root = await mkdtemp('/tmp/it-')
  try {
  const namespace = createHash('sha256').update(`${process.getuid()}:${directory}`).digest('hex').slice(0, 20)
  const occupied = join(root, `ivoraige-${namespace}`)
  await ensurePrivateDirectory(occupied)
  const selected = await hostSocketDirectory(directory, {
    runtimeDirectory: '', userTemporaryDirectory: '',
    homeDirectory: `${directory}/${'x'.repeat(120)}`, sharedTemporaryDirectory: root })
  try {
    assert.notEqual(selected, occupied)
    assert.match(selected, new RegExp(`^${root}/ivoraige-${namespace}-[A-Za-z0-9]{6}$`))
    await assertPrivateDirectory(selected)
  } finally { await rm(selected, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
}))

test('socket directory prefers a validated user runtime or temp root, never a permissive one', async () => fixture(async directory => {
  if (process.platform === 'win32') return
  const root = await mkdtemp('/tmp/ir-')
  const settings = { runtimeDirectory: root, userTemporaryDirectory: root,
    homeDirectory: `${directory}/${'x'.repeat(120)}`, sharedTemporaryDirectory: '/tmp' }
  let selected, fallback
  try {
    selected = await hostSocketDirectory(directory, settings)
    if (process.platform === 'darwin') assert.equal(selected, root)
    else assert.ok(selected.startsWith(`${root}/`))
    await assertPrivateDirectory(selected)
    await chmod(root, 0o755)
    fallback = await hostSocketDirectory(directory, settings)
    assert.notEqual(fallback, selected)
    await assertPrivateDirectory(fallback)
  } finally {
    await chmod(root, 0o700)
    if (fallback) await rm(fallback, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
}))

test('slow business succeeds past handshake budget and disconnect cancels only business', async t => fixture(async directory => {
  const state = { dataDomainRef: 'domain-slow', generation: 'generation-slow',
    storeOwnership: 'held', acceptingBusiness: true }
  let signalReceived
  const cancelled = new Promise(resolve => { signalReceived = resolve })
  const host = createHostTransport({ directory, dataDomainRef: state.dataDomainRef,
    generation: state.generation, lifetime: 'resident', getState: () => state,
    handleControl: async () => ({ accepted: true }),
    handleBusiness: async (method, input, { signal }) => {
      if (method === 'slow') { await new Promise(resolve => setTimeout(resolve, 5100)); return { done: true } }
      if (method === 'cancel') {
        signalReceived(signal)
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
        return { cancelled: true }
      }
      if (method === 'timeout') await new Promise(resolve => setTimeout(resolve, 200))
      return { done: true }
    } })
  try {
    try { await host.start() }
    catch (error) {
      if (!process.env.CI && (error.code === 'EPERM' || error.code === 'EACCES')) {
        t.skip('Local sandbox does not permit Unix socket listening'); return
      }
      throw error
    }
    const client = await connectHostTransport({ directory, dataDomainRef: state.dataDomainRef })
    assert.deepEqual(await client.request('business', { method: 'slow', input: {} }), { done: true })
    await assert.rejects(client.request('business', { method: 'timeout', input: {} }, { timeoutMs: 25 }),
      { code: 'CONFLICT', details: { reason: 'outcome-unknown' } })
    const controller = new AbortController()
    const pending = client.request('business', { method: 'cancel', input: {} }, { signal: controller.signal })
    const businessSignal = await cancelled
    controller.abort()
    await assert.rejects(pending, { code: 'CONFLICT', details: { reason: 'request-cancelled' } })
    await new Promise((resolve, reject) => {
      if (businessSignal.aborted) resolve()
      else {
        const timer = setTimeout(() => reject(new Error('Business handler did not receive disconnect')), 1000)
        businessSignal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      }
    })
  } finally { await host.cleanupDiscovery(); await host.close() }
}))

// Instrument the actual filesystem boundaries rather than relying on timing:
// every publication and each side of conditional cleanup must hold the same
// cross-process SQLite lease. The former read/check/unlink implementation
// allowed a new generation to replace the path after the read.
test('discovery publication and conditional cleanup share the registry lease', async () => fixture(async directory => {
  const dataDomainRef = 'domain-cleanup-race'
  const target = join(directory, `host-${createHash('sha256').update(dataDomainRef).digest('hex').slice(0, 24)}.json`)
  const lockPath = join(directory, 'domains.owner.sqlite')
  const original = { readFile: fs.promises.readFile, rename: fs.promises.rename, rm: fs.promises.rm }
  const boundaries = []
  function assertLocked(boundary) {
    const db = new DatabaseSync(lockPath, { timeout: 0 })
    try {
      assert.throws(() => db.exec('BEGIN IMMEDIATE'), error =>
        (error.errcode & 0xff) === 5 || (error.errcode & 0xff) === 6,
      `${boundary} must hold the publication/cleanup lease`)
      boundaries.push(boundary)
    } finally { db.close() }
  }
  fs.promises.rename = async (...args) => {
    if (args[1] === target) assertLocked('publish')
    return original.rename(...args)
  }
  fs.promises.readFile = async (...args) => {
    if (args[0] === target) assertLocked('read-before-delete')
    return original.readFile(...args)
  }
  fs.promises.rm = async (...args) => {
    if (args[0] === target) assertLocked('delete')
    return original.rm(...args)
  }
  syncBuiltinESMExports()
  const owner = generation => createHostTransport({ directory, dataDomainRef, generation,
    lifetime: 'ephemeral', getState: () => ({ storeOwnership: 'held' }) })
  const old = owner('generation-old'), next = owner('generation-next')
  try {
    await old.start()
    await old.cleanupDiscovery()
    await old.start() // Already-started owner does not republish after cleanup.
    await next.start()
    await old.cleanupDiscovery()
    const record = JSON.parse(await original.readFile(target, 'utf8'))
    assert.equal(record.generation, 'generation-next')
    await next.cleanupDiscovery()
    assert.deepEqual(boundaries, ['publish', 'read-before-delete', 'delete',
      'publish', 'read-before-delete', 'read-before-delete', 'delete'])
  } finally {
    Object.assign(fs.promises, original)
    syncBuiltinESMExports()
    await old.close()
    await next.close()
  }
}))
