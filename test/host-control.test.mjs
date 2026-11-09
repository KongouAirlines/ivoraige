import test from 'node:test'
import assert from 'node:assert/strict'
import { HostControl } from '../src/host-control.mjs'
import { HostDeadline, waitForDeadline } from '../src/host-deadline.mjs'
import { Context, z } from '../dist/dsh.mjs'
import { OperationCatalog } from '../src/operation-catalog.mjs'
import { EntryEvents } from '../src/entry-events.mjs'
import { Tasks } from '../src/tasks.mjs'
import { ResourceAccess } from '../src/resource-access.mjs'
import { Components } from '../src/components.mjs'

const generation = 'generation-1'
const defaultStages = () => ({ work: async () => {}, resources: async () => {}, storage: async () => {},
  releaseStore: async () => {}, cleanupDiscovery: async () => {}, closeControl: async () => {} })
function host(stages = {}) {
  const control = new HostControl({ dataDomainRef: 'domain-1', generation,
    stages: { ...defaultStages(), ...stages } })
  control.ready()
  return control
}
const op = (control, operationId) => control.operation(operationId, { expectedGeneration: generation })

test('gate atomically closes admission; timed out admission joins the same operation', async () => {
  let gates = 0
  const control = host({ gate: () => { gates++ } })
  const release = control.beginAdmission()
  const accepted = control.drain({ expectedGeneration: generation, budgetMs: 5 })
  assert.equal(control.state().state, 'draining')
  assert.equal(control.state().acceptingBusiness, false)
  assert.throws(() => control.beginAdmission(), { code: 'PRECONDITION_FAILED', details: { reason: 'host-draining' } })
  await control.waitForAttempt()
  assert.equal(op(control, accepted.operationId).status, 'blocked')
  assert.equal(op(control, accepted.operationId).reason, 'deadline-exceeded')
  release()
  const repeated = control.drain({ expectedGeneration: generation, budgetMs: 100 })
  assert.equal(repeated.operationId, accepted.operationId)
  await control.waitForAttempt()
  assert.equal(op(control, accepted.operationId).status, 'drained')
  assert.equal(op(control, accepted.operationId).safeToExit, true)
  assert.equal(gates, 1)
  assert.equal(control.state().storeOwnership, 'held')
})

test('repeated completed drain stays quiescent until exit promotion', async () => {
  let workCalls = 0
  const control = host({ work: () => { workCalls++ } })
  const accepted = control.drain({ expectedGeneration: generation, budgetMs: 100 })
  await control.waitForAttempt()
  assert.equal(op(control, accepted.operationId).phase, 'quiescent')
  const repeated = control.drain({ expectedGeneration: generation, budgetMs: 100 })
  assert.equal(repeated.operationId, accepted.operationId)
  assert.equal(op(control, accepted.operationId).phase, 'quiescent')
  assert.equal(op(control, accepted.operationId).status, 'drained')
  assert.equal(workCalls, 1)
})

test('exit promotes drain, runs each stage once, and only releases after storage', async () => {
  const calls = []
  let finishWork
  const work = new Promise(resolve => { finishWork = resolve })
  const control = host({ gate: () => calls.push('gate'), work: async () => { calls.push('work'); await work },
    resources: () => calls.push('resources'), storage: () => calls.push('storage'),
    releaseStore: () => calls.push('release'), cleanupDiscovery: () => calls.push('discovery'),
    closeControl: () => calls.push('control') })
  const first = control.drain({ expectedGeneration: generation, budgetMs: 1000 })
  const promoted = control.exit({ expectedGeneration: generation, budgetMs: 1 })
  assert.equal(first.operationId, promoted.operationId)
  finishWork()
  await control.waitForAttempt()
  assert.deepEqual(calls, ['gate', 'work', 'resources', 'storage', 'release', 'discovery', 'control'])
  assert.equal(op(control, first.operationId).intent, 'exit')
  assert.equal(control.state().storeOwnership, 'released')
  assert.equal(control.state().state, 'stopping')
  assert.deepEqual(control.finalizationReceipt(), { type: 'host.finalized', dataDomainRef: 'domain-1',
    generation, operationId: first.operationId, storeOwnership: 'released' })
})

test('failed resources leave storage and release untouched; retry skips completed phases', async () => {
  const calls = []
  let fail = true
  const control = host({ work: () => calls.push('work'), resources: () => {
    calls.push('resources')
    if (fail) throw new Error('worker remains')
  }, storage: () => calls.push('storage'), releaseStore: () => calls.push('release') })
  const accepted = control.exit({ expectedGeneration: generation, budgetMs: 100 })
  await control.waitForAttempt()
  assert.deepEqual(calls, ['work', 'resources'])
  assert.equal(control.state().storeOwnership, 'held')
  assert.equal(op(control, accepted.operationId).phase, 'resources')
  fail = false
  control.exit({ expectedGeneration: generation, budgetMs: 100 })
  await control.waitForAttempt()
  assert.deepEqual(calls, ['work', 'resources', 'resources', 'storage', 'release'])
})

test('failure after lock release never reopens the store or deletes discovery on the first attempt', async () => {
  let releases = 0, discoveries = 0
  const control = host({ releaseStore: () => { releases++ }, cleanupDiscovery: () => {
    discoveries++
    if (discoveries === 1) throw new Error('registry inaccessible')
  } })
  const accepted = control.exit({ expectedGeneration: generation, budgetMs: 100 })
  await control.waitForAttempt()
  assert.equal(control.state().storeOwnership, 'released')
  assert.equal(control.finalizationReceipt(), null)
  assert.equal(op(control, accepted.operationId).status, 'blocked')
  control.exit({ expectedGeneration: generation, budgetMs: 100 })
  await control.waitForAttempt()
  assert.equal(releases, 1)
  assert.equal(discoveries, 2)
  assert.ok(control.finalizationReceipt())
})

test('discovery can finish after its deadline without closing control until an explicit retry', async () => {
  let releases = 0, discoveries = 0, closes = 0
  const control = host({ releaseStore: () => { releases++ }, cleanupDiscovery: deadline => {
    discoveries++
    // Deterministic clock advance, not a native-cleanup timing requirement.
    deadline.now = () => Number.MAX_SAFE_INTEGER
  }, closeControl: () => { closes++ } })
  const accepted = control.exit({ expectedGeneration: generation, budgetMs: 1000 })
  await control.waitForAttempt()
  assert.equal(control.state().storeOwnership, 'released')
  assert.equal(op(control, accepted.operationId).status, 'blocked')
  assert.equal(op(control, accepted.operationId).reason, 'deadline-exceeded')
  assert.equal(closes, 0)
  const retried = control.exit({ expectedGeneration: generation, budgetMs: 1000 })
  assert.equal(retried.operationId, accepted.operationId)
  await control.waitForAttempt()
  assert.equal(releases, 1)
  assert.equal(discoveries, 1)
  assert.equal(closes, 1)
})

test('stale generation and invalid budget do not close gate; revision is control-only when bridge absent', () => {
  const control = host()
  assert.throws(() => control.exit({ expectedGeneration: 'other', budgetMs: 10 }), { code: 'CONFLICT' })
  assert.throws(() => control.exit({ expectedGeneration: generation, budgetMs: 0 }), { code: 'INVALID_ARGUMENT' })
  assert.equal(control.state().state, 'ready')
  assert.equal(control.state().synchronization, 'control-only')
  assert.equal(control.state().stateRevision, null)
})

test('deadline waits use a monotonic clock and do not cancel underlying work', async () => {
  let now = 10
  const deadline = new HostDeadline(10, () => now)
  now = 21
  await assert.rejects(waitForDeadline(new Promise(() => {}), deadline), { details: { reason: 'deadline-exceeded' } })
})

test('service gate closes before accept returns, including direct service admissions', () => {
  let serviceAccepting = true
  const control = host({ gate: () => { serviceAccepting = false } })
  const accepted = control.drain({ expectedGeneration: generation, budgetMs: 100 })
  assert.equal(accepted.accepted, true)
  assert.equal(serviceAccepting, false)
})

test('an expired attempt cannot start the next phase after a synchronous stall', async () => {
  let resources = 0
  const control = host({ work: () => {
    const until = performance.now() + 10
    while (performance.now() < until) { /* Simulate a stalled synchronous owner. */ }
  }, resources: () => { resources++ } })
  const accepted = control.exit({ expectedGeneration: generation, budgetMs: 1 })
  await control.waitForAttempt()
  assert.equal(resources, 0)
  assert.equal(control.state().storeOwnership, 'held')
  assert.equal(op(control, accepted.operationId).reason, 'deadline-exceeded')
})

test('catalog admission lease spans awaited preflight and rechecks the gate before commit', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  const catalog = ctx.get('ivoraige.operationCatalog')
  let finishPreflight, handlerCalls = 0
  const preflight = new Promise(resolve => { finishPreflight = resolve })
  catalog.register({ id: 'held', inputSchema: z.object({}).strict(), resultSchema: z.object({}).strict(),
    preflight: () => preflight, handler: () => { handlerCalls++; return {} } })
  const control = host({ gate: () => catalog.stopAccepting(), work: deadline => catalog.close({ deadline }) })
  catalog.setHostControl(control)
  const invoking = catalog.invoke('held')
  assert.equal(control.admissions.size, 1)
  const accepted = control.drain({ expectedGeneration: generation, budgetMs: 100 })
  finishPreflight()
  await assert.rejects(invoking, { code: 'PRECONDITION_FAILED', details: { reason: 'host-draining' } })
  await control.waitForAttempt()
  assert.equal(op(control, accepted.operationId).status, 'drained')
  assert.equal(handlerCalls, 0)
  assert.equal(control.admissions.size, 0)
  await assert.rejects(catalog.invoke('held'), { details: { reason: 'host-draining' } })
})

test('running handlers release admission so the drain can abort and join them', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  const catalog = ctx.get('ivoraige.operationCatalog')
  let entered
  const started = new Promise(resolve => { entered = resolve })
  catalog.register({ id: 'running', inputSchema: z.object({}).strict(), resultSchema: z.object({}).strict(),
    handler: (_input, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted by drain')), { once: true })
      entered()
    }) })
  const control = host({ gate: () => catalog.stopAccepting(), admissions: deadline => catalog.close({ deadline }) })
  catalog.setHostControl(control)
  const invoking = catalog.invoke('running')
  await started
  assert.equal(control.admissions.size, 0)
  const accepted = control.drain({ expectedGeneration: generation, budgetMs: 100 })
  await assert.rejects(invoking, /aborted by drain/)
  await control.waitForAttempt()
  assert.equal(op(control, accepted.operationId).status, 'drained')
  assert.equal(catalog.active.size, 0)
})

test('an unfinished timed-out stage is joined before later stages or store release', async () => {
  let finishWork
  const work = new Promise(resolve => { finishWork = resolve })
  const calls = []
  const control = host({ work: async () => { calls.push('work'); await work },
    resources: () => calls.push('resources'), storage: () => calls.push('storage'),
    releaseStore: () => calls.push('release') })
  const accepted = control.exit({ expectedGeneration: generation, budgetMs: 1000 })
  await control.waitForAttempt()
  assert.deepEqual(calls, ['work'])
  assert.equal(op(control, accepted.operationId).reason, 'deadline-exceeded')
  assert.equal(control.state().storeOwnership, 'held')
  control.exit({ expectedGeneration: generation, budgetMs: 20 })
  await control.waitForAttempt()
  assert.deepEqual(calls, ['work'])
  finishWork()
  control.exit({ expectedGeneration: generation, budgetMs: 1000 })
  await control.waitForAttempt()
  assert.deepEqual(calls, ['work', 'resources', 'storage', 'release'])
  assert.equal(control.state().storeOwnership, 'released')
})

test('direct service admissions report host-draining after the gate closes', async () => {
  const reason = { code: 'PRECONDITION_FAILED', details: { reason: 'host-draining' } }
  await assert.rejects(Tasks.prototype.submit.call({ ready: Promise.resolve(), closing: true }, 'doc'), reason)
  await assert.rejects(Tasks.prototype.resume.call({ ready: Promise.resolve(), closing: true }, 'task'), reason)
  assert.throws(() => ResourceAccess.prototype.artifact.call({ closing: true }, 'artifact'), reason)
  assert.throws(() => Components.prototype.start.call({ closing: true }, {}), reason)
})

test('owner P04 state and notices stay out of public sessions', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(EntryEvents, { generation })
  const events = ctx.get('ivoraige.events')
  events.registerOwnerState('host', () => ({ storeOwnership: 'held' }))
  assert.throws(() => events.registerState('host', () => ({ leaked: true })), { code: 'CONFLICT' })
  assert.throws(() => events.registerOwnerState('__proto__', () => ({})), { code: 'INVALID_ARGUMENT' })
  const publicSession = events.subscribe()
  const ownerSession = events.subscribe({}, { owner: true })
  events.publish('host.changed', { ownerOnly: true })
  assert.equal(publicSession.snapshot().state.host, undefined)
  assert.deepEqual(ownerSession.snapshot().state.host, { storeOwnership: 'held' })
  assert.deepEqual(publicSession.drain(), [])
  assert.equal(ownerSession.drain().length, 1)
  assert.throws(() => events.publish('host.changed', { ownerOnly: true, legacyData: { secret: true } }),
    { code: 'INVALID_ARGUMENT' })
})
