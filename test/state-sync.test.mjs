import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../dist/dsh.mjs'
import { EntryEvents } from '../src/entry-events.mjs'
import { createStateSync } from '../src/state-sync.mjs'

function gate() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}
async function until(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('controlled synchronization did not reach the expected barrier')
}
async function host(t) {
  const ctx = new Context()
  await ctx.plugin(EntryEvents)
  t.after(() => ctx.fiber.dispose())
  const events = ctx.get('ivoraige.events')
  const state = { first: 'queued', second: 'queued' }
  events.registerState('tasks', () => ({ ...state }))
  return { events, state, commit(change, scope = {}) {
    Object.assign(state, change)
    events.publish('task.changed', { scope })
  } }
}
function transport(events, log, { readyBarrier } = {}) {
  return callbacks => {
    const session = events.subscribe(callbacks.scope)
    log.push({ session, callbacks })
    const stop = session.onNotice(callbacks.onNotice)
    Promise.resolve(readyBarrier).then(() => callbacks.onReady(session.ready))
    return () => { stop(); session.close() }
  }
}

test('subscription-first handshake covers the old read/subscribe window and ready response transport', async t => {
  const server = await host(t)
  const staleRead = { ...server.state }
  const readyBarrier = gate(), connections = [], applied = []
  const sync = createStateSync({ connect: transport(server.events, connections, { readyBarrier: readyBarrier.promise }),
    snapshot: ready => server.events.getSession(ready.subscriptionId).snapshot(),
    onState: value => applied.push(value), retryMs: 0 })
  t.after(() => sync.stop())
  server.commit({ first: 'succeeded' }) // after installed, before ready crosses transport
  readyBarrier.release()
  await until(() => sync.status === 'synchronized')
  assert.equal(staleRead.first, 'queued')
  assert.equal(applied.at(-1).state.tasks.first, 'succeeded')
  assert.equal(connections.length, 1)
  assert.ok(applied.at(-1).stateRevision >= connections[0].session.ready.barrierRevision)
  sync.stop()
  assert.equal(server.events.sessions.size, 0)
})

test('commit during snapshot response and another during refetch converge on the same session with no later event', async t => {
  const server = await host(t)
  const firstResponse = gate(), secondResponse = gate(), enteredFirst = gate(), enteredSecond = gate()
  const connections = [], applied = [], requests = []
  const sync = createStateSync({ connect: transport(server.events, connections),
    snapshot: async ready => {
      requests.push(ready.subscriptionId)
      const value = server.events.getSession(ready.subscriptionId).snapshot()
      if (requests.length === 1) { enteredFirst.release(); await firstResponse.promise }
      if (requests.length === 2) { enteredSecond.release(); await secondResponse.promise }
      return value
    }, onState: value => applied.push(value), retryMs: 0 })
  t.after(() => sync.stop())
  await enteredFirst.promise
  server.commit({ first: 'succeeded' })
  firstResponse.release()
  await enteredSecond.promise
  server.commit({ second: 'succeeded' })
  secondResponse.release()
  await until(() => sync.status === 'synchronized')
  assert.equal(requests.length, 3)
  assert.equal(new Set(requests).size, 1)
  assert.equal(connections.length, 1)
  assert.deepEqual(applied.at(-1).state.tasks, { first: 'succeeded', second: 'succeeded' })
})

test('duplicate/delayed notifications and scope-filtered revision gaps do not require replay', async t => {
  const server = await host(t)
  const connections = [], applied = []
  let reads = 0
  const sync = createStateSync({ scope: { docId: 'opaque-id' }, connect: transport(server.events, connections),
    snapshot: ready => { reads++; return server.events.getSession(ready.subscriptionId).snapshot() },
    onState: value => applied.push(value), retryMs: 0 })
  t.after(() => sync.stop())
  await until(() => sync.status === 'synchronized')
  server.commit({}, { docId: 'other' })
  server.commit({ first: 'succeeded' }, { docId: 'opaque-id' })
  await until(() => sync.status === 'synchronized' && sync.current.state.tasks.first === 'succeeded')
  const { callbacks, session } = connections[0]
  const delayed = { type: 'state.invalidated', subscriptionId: session.ready.subscriptionId,
    generation: session.ready.generation, scope: session.ready.scope,
    stateRevision: sync.current.stateRevision }
  callbacks.onNotice(delayed); callbacks.onNotice(delayed)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 2)
  assert.equal(connections.length, 1)
  assert.equal(sync.status, 'synchronized')
})

test('disconnect/restart discards prior generation and converges without any new business event', { timeout: 5000 }, async t => {
  const first = await host(t), second = await host(t)
  second.commit({ first: 'succeeded', second: 'succeeded' })
  let selected = first
  const connections = [], applied = []
  let synchronized = gate()
  const sync = createStateSync({ connect: callbacks => transport(selected.events, connections)(callbacks),
    snapshot: ready => selected.events.getSession(ready.subscriptionId).snapshot(),
    onState: value => applied.push(value), retryMs: 0,
    onStatus: status => { if (status === 'synchronized') synchronized.release() } })
  t.after(() => sync.stop())
  await synchronized.promise
  const stale = connections[0]
  selected = second
  synchronized = gate()
  stale.callbacks.onDisconnect()
  assert.equal(sync.status, 'resync-required')
  await synchronized.promise
  assert.equal(connections.length, 2)
  assert.notEqual(applied[0].generation, applied.at(-1).generation)
  assert.equal(applied.at(-1).state.tasks.first, 'succeeded')
  stale.callbacks.onReady(stale.session.ready)
  assert.equal(sync.current.generation, second.events.generation)
  assert.equal(first.events.sessions.size, 0)
  sync.stop()
  assert.equal(second.events.sessions.size, 0)
})

test('client finite buffer overflow explicitly re-handshakes and stop aborts in-flight reads and timers', { timeout: 5000 }, async t => {
  const server = await host(t)
  const entered = gate(), response = gate(), connections = [], applied = [], signals = []
  let reads = 0
  const synchronized = gate()
  const sync = createStateSync({ maxBuffer: 1, retryMs: 0,
    connect: transport(server.events, connections), snapshot: async (ready, { signal }) => {
      signals.push(signal)
      const value = server.events.getSession(ready.subscriptionId).snapshot()
      if (++reads === 1) { entered.release(); await response.promise }
      return value
    }, onState: value => applied.push(value),
    onStatus: status => { if (status === 'synchronized') synchronized.release() } })
  t.after(() => sync.stop())
  await entered.promise
  server.commit({ first: 'succeeded' }); server.commit({ second: 'succeeded' })
  await synchronized.promise
  assert.equal(connections.length, 2)
  assert.equal(signals[0].aborted, true)
  response.release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(applied.length, 1) // canceled first response must never apply
  assert.deepEqual(sync.current.state.tasks, { first: 'succeeded', second: 'succeeded' })
  sync.stop(); sync.stop()
  assert.equal(signals.at(-1).aborted, true)
  assert.equal(server.events.sessions.size, 0)
  assert.equal(sync.status, 'closed')
})

test('explicit resync and changed generation/scope lose synchronization and require fresh handshakes', { timeout: 5000 }, async t => {
  const server = await host(t)
  const connections = []
  let synchronized = gate()
  const sync = createStateSync({ scope: { docId: 'first' }, retryMs: 0,
    connect: transport(server.events, connections),
    snapshot: ready => server.events.getSession(ready.subscriptionId).snapshot(), onState() {},
    onStatus: status => { if (status === 'synchronized') synchronized.release() } })
  t.after(() => sync.stop())
  await synchronized.promise
  synchronized = gate()
  connections[0].session.invalidate('explicit-resync')
  await synchronized.promise
  assert.equal(connections.length, 2)
  for (const mismatch of [{ generation: 'another-generation' }, { scope: { docId: 'another-scope' } }]) {
    const { session, callbacks } = connections.at(-1)
    const count = connections.length
    synchronized = gate()
    callbacks.onNotice({ type: 'state.invalidated', subscriptionId: session.ready.subscriptionId,
      generation: session.ready.generation, scope: session.ready.scope,
      stateRevision: server.events.stateRevision, ...mismatch })
    assert.equal(sync.status, 'resync-required')
    await synchronized.promise
    assert.equal(connections.length, count + 1)
  }
  const previous = connections.at(-1).session.ready
  sync.stop()
  const changedScope = createStateSync({ scope: { docId: 'second' }, retryMs: 0,
    connect: transport(server.events, connections),
    snapshot: ready => server.events.getSession(ready.subscriptionId).snapshot(), onState() {} })
  t.after(() => changedScope.stop())
  await until(() => changedScope.status === 'synchronized')
  assert.deepEqual(changedScope.current.scope, { docId: 'second' })
  assert.notEqual(changedScope.current.subscriptionId, previous.subscriptionId)
  changedScope.stop()
  assert.equal(server.events.sessions.size, 0)
})

test('a final reentrant invalidation in the synchronized callback is drained without a later event', { timeout: 5000 }, async t => {
  const server = await host(t)
  const connections = [], applied = [], finished = gate()
  let commitOnce = true, reads = 0
  const sync = createStateSync({ retryMs: 0, connect: transport(server.events, connections),
    snapshot: ready => { reads++; return server.events.getSession(ready.subscriptionId).snapshot() },
    onState: value => applied.push(value), onStatus: status => {
      if (status !== 'synchronized') return
      if (!commitOnce) { finished.release(); return }
      commitOnce = false
      server.commit({ first: 'succeeded' })
      const { callbacks, session } = connections[0]
      callbacks.onNotice({ type: 'state.invalidated', subscriptionId: session.ready.subscriptionId,
        generation: session.ready.generation, scope: session.ready.scope,
        stateRevision: server.events.stateRevision })
    } })
  t.after(() => sync.stop())
  await finished.promise
  assert.equal(sync.status, 'synchronized')
  assert.equal(reads, 2)
  assert.equal(connections.length, 1)
  assert.equal(applied.at(-1).state.tasks.first, 'succeeded')
})
