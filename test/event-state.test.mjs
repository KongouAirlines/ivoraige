import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { SettingsPages } from '../src/settings-pages.mjs'
import { EntryEvents } from '../src/entry-events.mjs'
import { installEventState } from '../src/event-state.mjs'

async function attach(ctx) {
  if (ctx.get('ivoraige.events')) return { events: ctx.get('ivoraige.events'), dispose() {} }
  await ctx.plugin(EntryEvents)
  return { events: ctx.get('ivoraige.events'), dispose: installEventState(ctx) }
}
function gate() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

test('actual Records durable commit advances state only after public metadata is visible', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-event-state-'))
  const app = await createApp({ store: join(dir, 'store.sqlite') })
  const { events, dispose } = await attach(app.ctx)
  t.after(async () => { dispose(); await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const session = events.subscribe()
  const before = session.snapshot()
  session.acknowledge(before.stateRevision)
  const unit = app.records.table.host.unit
  const original = unit.putRecord.bind(unit)
  const entered = gate(), continueWrite = gate()
  unit.putRecord = async (...args) => { entered.release(); await continueWrite.promise; return original(...args) }
  const importing = app.records.importDocument({ format: 'txt', content: 'PRIVATE_SOURCE_SENTINEL.' },
    { sourceId: 'events', language: 'en', origin: 'cli' })
  await entered.promise
  assert.equal(session.snapshot().stateRevision, before.stateRevision)
  assert.equal(session.snapshot().state.documents.length, 0)
  continueWrite.release()
  const { document } = await importing
  unit.putRecord = original
  const after = session.snapshot()
  assert.ok(after.stateRevision > before.stateRevision)
  assert.equal(after.state.documents[0].id, document.id)
  assert.doesNotMatch(JSON.stringify(after), /PRIVATE_SOURCE_SENTINEL|sourceBinding|sourcePath|checkpoints/)
  assert.ok(session.drain().some(notice => notice.event?.type === 'records.changed'))
  const scoped = events.subscribe({ docId: document.id })
  assert.equal(scoped.snapshot().state.documents[0].id, document.id)
  // Unknown task scope is resolved by exact stored identity, never split/prefix.
  assert.deepEqual(events.subscribe({ taskId: `${document.id}.not-a-task` }).snapshot().state.documents, [])
})

test('settings page notifications and legacy delivery work without Tasks and are owned by registration', async t => {
  const ctx = new Context()
  await ctx.plugin(SettingsPages)
  const { events, dispose } = await attach(ctx)
  t.after(async () => { dispose(); await ctx.fiber.dispose() })
  assert.equal(ctx.get('ivoraige.tasks'), undefined)
  const legacy = []
  const stop = events.subscribeLegacy(event => legacy.push(event))
  const session = events.subscribe()
  const initial = session.snapshot()
  const unregister = ctx.get('ivoraige.settingsPages').register({ id: 'synthetic', label: 'Synthetic', order: 1 })
  assert.deepEqual(legacy[0], { type: 'settings.pages.changed',
    data: { settingsPages: [{ id: 'synthetic', label: 'Synthetic', order: 1 }] } })
  assert.ok(session.snapshot().stateRevision > initial.stateRevision)
  assert.equal(session.snapshot().state.settingsPages.length, 1)
  unregister()
  assert.deepEqual(session.snapshot().state.settingsPages, [])
  stop(); dispose()
  assert.equal(events.readers.size, 0)
  const revision = events.stateRevision
  ctx.emit('ivoraige/settings-pages-changed', { settingsPages: [] })
  assert.equal(events.stateRevision, revision)
})

test('actual DSH settings partial-save commits invalidate despite the operation failing, without leaking credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-settings-event-'))
  const boot = await bootModelSettings({ directory: dir })
  const { events, dispose } = await attach(boot.ctx)
  t.after(async () => { dispose(); await boot.dispose(); await rm(dir, { recursive: true, force: true }) })
  const session = events.subscribe()
  const initial = session.snapshot() // describe() initial discovery may advance revision
  session.acknowledge(initial.stateRevision)
  const mutate = boot.ctx.settings.mutate.bind(boot.ctx.settings)
  boot.ctx.settings.mutate = (namespace, ...args) => namespace === 'ivoraige-model' ?
    Promise.reject(new Error('synthetic selection write failure')) : mutate(namespace, ...args)
  await assert.rejects(boot.settings.update({ provider: 'synthetic', model: 'safe',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9999/PRIVATE_ENDPOINT',
    credentialRef: 'PRIVATE_CREDENTIAL_REFERENCE', contextWindow: 8192, maxTokens: 512 }), error => {
    assert.equal(error.details?.partialSave?.persisted, 'routes', error.stack)
    return true
  })
  boot.ctx.settings.mutate = mutate
  const after = session.snapshot()
  assert.ok(after.stateRevision > initial.stateRevision)
  const routes = after.state.settings.find(row => row.namespace === 'llm-pi-ai')
  assert.ok(routes)
  assert.doesNotMatch(JSON.stringify({ after, notices: session.drain() }),
    /PRIVATE_ENDPOINT|PRIVATE_CREDENTIAL_REFERENCE|providers|apiKey|baseURL/)
  assert.ok(session.drain().some(notice => notice.event?.type === 'settings.changed'))
})
