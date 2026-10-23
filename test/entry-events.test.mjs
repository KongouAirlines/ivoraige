import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../dist/dsh.mjs'
import { EntryEvents } from '../src/entry-events.mjs'

async function fixture(t) {
  const ctx = new Context()
  await ctx.plugin(EntryEvents)
  t.after(() => ctx.fiber.dispose())
  return { ctx, events: ctx.get('ivoraige.events') }
}
const tick = () => new Promise(resolve => queueMicrotask(resolve))

test('subscription barrier covers commits before install, during ready transport and after snapshot', async t => {
  const { events } = await fixture(t)
  let state = 'queued'
  events.registerState('task', () => ({ state }))
  state = 'running'; events.publish('task.started')
  const session = events.subscribe()
  const barrier = session.ready.barrierRevision
  state = 'succeeded'; events.publish('task.succeeded') // ready response not delivered yet
  const notices = []
  session.onNotice(notice => notices.push(notice))
  const snapshot = session.snapshot()
  assert.equal(snapshot.state.task.state, 'succeeded')
  assert.ok(snapshot.stateRevision > barrier)
  session.acknowledge(snapshot.stateRevision)
  await tick()
  assert.deepEqual(notices, []) // covered before transport delivery, no future event needed
  state = 'abandoned'; events.publish('task.abandoned')
  assert.equal(notices.length, 0) // deferred network/session callbacks
  await tick()
  assert.equal(notices[0].stateRevision, snapshot.stateRevision + 1)
  assert.equal(session.snapshot().state.task.state, 'abandoned')
})

test('snapshot retries a synchronous settings notification and rejects an incoherent or async reader', async t => {
  const { events } = await fixture(t)
  let first = true, settings = 0, reads = 0
  const unregister = events.registerState('settings', () => {
    reads++
    const before = settings
    if (first) { first = false; settings++; events.publish('settings.changed') }
    return { settings: before }
  })
  const session = events.subscribe()
  const snapshot = session.snapshot()
  assert.equal(reads, 2)
  assert.equal(snapshot.state.settings.settings, 1)
  assert.ok(snapshot.stateRevision > session.ready.barrierRevision)
  unregister()
  events.registerState('unstable', () => { events.publish('settings.changed'); return {} })
  assert.throws(() => session.snapshot(), { code: 'PRECONDITION_FAILED' })
  assert.equal(session.drain()[0].type, 'resync-required')
  events.readers.clear()
  const other = events.subscribe()
  events.registerState('async', async () => ({}))
  assert.throws(() => other.snapshot(), { code: 'PRECONDITION_FAILED' })
  assert.equal(other.drain()[0].reason, 'asynchronous-state-reader')
})

test('scope filtering tolerates revision gaps, unknown ownership invalidates and IDs are opaque', async t => {
  const { events } = await fixture(t)
  const session = events.subscribe({ docId: 'opaque:/doc.α' })
  const notices = []
  session.onNotice(event => notices.push(event))
  events.publish('records.changed', { scope: { docId: 'another' } })
  events.publish('records.changed', { scope: { docId: 'opaque:/doc.α' } })
  events.publish('task.changed')
  await tick()
  assert.equal(notices.length, 2)
  assert.equal(notices[0].stateRevision, session.ready.barrierRevision + 2)
  assert.deepEqual(notices[0].scope, session.ready.scope)
  assert.deepEqual(notices[0].event.scope, { docId: 'opaque:/doc.α' })
  assert.throws(() => events.subscribe({ authorization: '*' }), { code: 'INVALID_ARGUMENT' })
})

test('finite buffering explicitly invalidates; close and plugin disposal release owned sessions/listeners', async t => {
  const { ctx, events } = await fixture(t)
  const session = events.subscribe({}, { maxBuffer: 1 })
  const notices = []
  session.onNotice(value => notices.push(value))
  events.publish('one'); events.publish('two'); events.publish('three')
  await tick()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].type, 'resync-required')
  assert.equal(notices[0].reason, 'buffer-overflow')
  assert.throws(() => session.snapshot(), { code: 'PRECONDITION_FAILED' })
  assert.equal(events.getSession(session.ready.subscriptionId), session)
  session.close(); session.close()
  assert.throws(() => events.getSession(session.ready.subscriptionId), { code: 'NOT_FOUND' })
  assert.equal(events.sessions.size, 0)
  assert.equal(session.listeners.size, 0)
  events.subscribe(); events.subscribeLegacy(() => {})
  await ctx.fiber.dispose()
  assert.equal(events.sessions.size, 0)
  assert.equal(events.legacyListeners.size, 0)
  assert.equal(events.readers.size, 0)
  assert.throws(() => events.subscribe(), { code: 'PRECONDITION_FAILED' })
})

test('legacy callbacks are synchronous, isolated and data-only without mutating producer data', async t => {
  const { events, ctx } = await fixture(t)
  const data = { taskId: 'opaque', count: 1 }
  let received
  events.subscribeLegacy(event => { event.data.count = 9; throw new Error('observer failure') })
  const stop = events.subscribeLegacy(event => { received = event })
  events.publish('task.started', { data: { taskId: data.taskId }, legacyData: data })
  assert.deepEqual(received, { type: 'task.started', data })
  assert.equal(data.count, 1)
  stop()
  for (const bad of [ctx, { run() {} }, { value: Infinity }, { get secret() { throw new Error('getter called') } }])
    assert.throws(() => events.publish('unsafe', { data: bad }), { code: 'INVALID_ARGUMENT' })
  const array = []
  Object.defineProperty(array, '0', { get() { throw new Error('array getter called') } })
  assert.throws(() => events.publish('unsafe', { data: { array } }), { code: 'INVALID_ARGUMENT' })
})
