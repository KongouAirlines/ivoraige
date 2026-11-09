import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t, { events = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-host-bootstrap-'))
  const options = { store: join(root, 'store.sqlite'), registryRoot: join(root, 'registry'),
    entries: { cli: false, http: false, mcp: false }, mcp: false, events }
  const app = await createApp(options)
  t.after(async () => {
    try { if (!app.host.closed) await app.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  return { app, options }
}

test('ephemeral host owns one generation and projects P04 state only for owner', async t => {
  const { app } = await fixture(t, { events: true })
  const control = app.host.control
  const state = control.state({ expectedGeneration: app.generation })
  assert.equal(state.dataDomainRef, app.dataDomainRef)
  assert.equal(state.lifetime, 'ephemeral')
  assert.equal(state.synchronization, 'p04')
  assert.equal(state.stateRevision, app.events.stateRevision)
  assert.equal(app.events.generation, app.generation)
  assert.equal(app.events.capture({}).state.host, undefined)
  const owner = app.events.capture({}, { owner: true })
  assert.equal(owner.state.host.generation, app.generation)
  assert.equal(owner.state.host.stateRevision, owner.stateRevision)
  assert.throws(() => control.state({ expectedGeneration: 'stale' }), { code: 'CONFLICT' })
})

test('events-disabled owner remains control-only, drains, and exits under same operation', async t => {
  const { app } = await fixture(t)
  const control = app.host.control
  assert.equal(control.state().synchronization, 'control-only')
  assert.equal(control.state().stateRevision, null)
  const accepted = control.drain({ expectedGeneration: app.generation, budgetMs: 1000 })
  await control.waitForAttempt()
  assert.equal(control.operation(accepted.operationId, { expectedGeneration: app.generation }).status, 'drained')
  assert.equal(control.state().storeOwnership, 'held')
  await app.dispose()
  assert.equal(app.host.closed, true)
  assert.equal(control.operation(accepted.operationId, { expectedGeneration: app.generation }).intent, 'exit')
  assert.equal(control.state().storeOwnership, 'released')
})

test('resource-stage fault keeps lease and retries only the unfinished stage', async t => {
  const { app, options } = await fixture(t)
  const control = app.host.control
  let calls = 0
  const resources = control.stages.resources
  control.stages.resources = async deadline => {
    calls++
    if (calls === 1) throw new Error('injected resource fault')
    return resources(deadline)
  }
  await assert.rejects(app.dispose(), { code: 'PRECONDITION_FAILED' })
  const accepted = control.operation(control.state().operationId, { expectedGeneration: app.generation })
  assert.equal(accepted.phase, 'resources')
  assert.equal(control.state().storeOwnership, 'held')
  await assert.rejects(createApp(options), { code: 'CONFLICT' })
  await app.dispose()
  assert.equal(calls, 2)
  assert.equal(control.state().storeOwnership, 'released')
})

test('storage-stage fault keeps lease and successful restart preserves domain ID, not generation', async t => {
  const { app, options } = await fixture(t)
  const control = app.host.control
  let calls = 0
  const storage = control.stages.storage
  control.stages.storage = async deadline => {
    calls++
    if (calls === 1) throw new Error('injected storage fault')
    return storage(deadline)
  }
  await assert.rejects(app.dispose(), { code: 'PRECONDITION_FAILED' })
  assert.equal(control.operation(control.state().operationId, { expectedGeneration: app.generation }).phase, 'storage')
  assert.equal(control.state().storeOwnership, 'held')
  await assert.rejects(createApp(options), { code: 'CONFLICT' })
  await app.dispose()
  const next = await createApp(options)
  assert.equal(next.dataDomainRef, app.dataDomainRef)
  assert.notEqual(next.generation, app.generation)
  assert.throws(() => next.host.control.exit({ expectedGeneration: app.generation, budgetMs: 100 }),
    { code: 'CONFLICT' })
  await next.dispose()
})

test('unconfirmed pinned backend disposal blocks release instead of trusting Cordis root disposal', async t => {
  const { app, options } = await fixture(t)
  const backend = app.ctx.storage.backend.get('sqlite')
  const realClose = backend.close.bind(backend)
  backend.close = () => Promise.reject(new Error('injected backend close failure'))
  await assert.rejects(app.dispose(), error => error.code === 'PRECONDITION_FAILED' &&
    error.details?.reason === 'storage-disposal-unconfirmed')
  assert.equal(app.host.control.state().storeOwnership, 'held')
  await assert.rejects(createApp(options), { code: 'CONFLICT' })
  backend.close = realClose
  // The pinned close API caches a rejection; ordinary retry cannot certify it.
  await assert.rejects(app.dispose(), error => error.details?.reason === 'storage-disposal-unconfirmed')
  // Test-only recovery of the injected adapter fault; production stays blocked
  // until an owner-specific, verifiable recovery mechanism exists.
  app.host.control.stages.storage = async () => {
    await realClose()
    await app.ctx.fiber.dispose()
  }
  await app.dispose()
})
