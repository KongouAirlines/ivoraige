import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostTransport, connectHostTransport, validateHostRequest } from '../src/host-transport.mjs'
import { assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from '../src/host-permissions.mjs'

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
        const response = once(raw, 'data')
        raw.write(`${JSON.stringify({ interfaceVersion: 'HostControl@1', minor: 0,
          requestId: 'no-capability', action: 'attach',
          params: { dataDomainRef: 'domain-a', requiredLifetime: 'resident' } })}\n`)
        assert.equal(JSON.parse((await response)[0].toString()).error.code, 'UNAUTHORIZED')
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
