import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { SettingsPages } from '../src/settings-pages.mjs'
import { Parse } from '../src/parse.mjs'
import { Outputs } from '../src/outputs.mjs'
import { Pdf } from '../src/adapters/pdf.mjs'
import { KernelError } from '../src/errors.mjs'
import { errorEnvelope } from '../src/protocol.mjs'
import { serve } from '../src/http.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'

test('settings pages follow mounted plugins, including unavailable PDF, without duplicates', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SettingsPages)
  await ctx.plugin(Outputs)
  await ctx.plugin(Parse)
  const registry = ctx.get('ivoraige.settingsPages')
  assert.deepEqual(registry.list(), [])
  const mount = () => ctx.plugin(Pdf, { directory: join(tmpdir(), 'unused-pdf'), command: 'missing' })
  const first = mount()
  await first
  assert.deepEqual(registry.list(), [{ id: 'pdf', label: 'PDF', order: 20 }])
  assert.equal(ctx.get('ivoraige.parse').componentStatus().babeldoc.state, 'unchecked')
  await first.dispose()
  assert.deepEqual(registry.list(), [])
  const second = mount()
  await second
  assert.deepEqual(registry.list(), [{ id: 'pdf', label: 'PDF', order: 20 }])
  await second.dispose()
  assert.deepEqual(registry.list(), [])
})

test('capabilities settings entry follows model and PDF pages independently', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-settings-pages-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cases = [
    [{}, []],
    [{ settingsDir: join(directory, 'models') }, ['models']],
    [{ pdf: { command: 'missing' } }, ['pdf']],
    [{ settingsDir: join(directory, 'both'), pdf: { command: 'missing' } }, ['models', 'pdf']],
  ]
  for (const [options, expected] of cases) {
    const app = await createApp({ store: join(directory, `${expected.join('-') || 'none'}.sqlite`), ...options })
    try {
      const { settingsPages, features } = await app.operations.invoke('capabilities')
      assert.deepEqual(settingsPages.map(page => page.id), expected)
      if (expected.includes('models')) assert.equal(settingsPages.find(page => page.id === 'models').label, '模型')
      assert.equal(features.includes('settings'), expected.length > 0)
      if (expected.includes('pdf')) assert.equal((await app.operations.invoke('capabilities')).components.babeldoc.state, 'unchecked')
    } finally { await app.dispose() }
  }
})

test('a profile created before settings pages upgrades without losing its saved model', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-settings-profile-upgrade-'))
  let boot = await bootModelSettings({ directory })
  t.after(async () => {
    if (boot) await boot.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const before = await boot.settings.update({ provider: 'custom', model: 'saved',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9999/v1',
    contextWindow: 8192, maxTokens: 512, timeoutMs: 2500 })
  await boot.dispose()
  boot = null
  const bundle = join(directory, 'node_modules', 'ivoraige-model-settings', 'cordis.patch.yml')
  const patch = JSON.parse(await readFile(bundle, 'utf8'))
  patch[0].insert = patch[0].insert.filter(item => item.id !== 'settings-pages')
  await writeFile(bundle, JSON.stringify(patch) + '\n')

  boot = await bootModelSettings({ directory })
  const upgraded = JSON.parse(await readFile(bundle, 'utf8'))[0].insert
  assert.equal(upgraded.filter(item => item.id === 'settings-pages').length, 1)
  assert.ok(upgraded.findIndex(item => item.id === 'settings-pages') <
    upgraded.findIndex(item => item.id === 'ivoraige-model'))
  const after = await boot.settings.get()
  assert.deepEqual(after.selected, before.selected)
  assert.deepEqual(after.savedModels, before.savedModels)
  assert.deepEqual(after.routes, before.routes)
  assert.deepEqual(boot.ctx.get('ivoraige.settingsPages').list().map(page => page.id), ['models'])
  await boot.dispose()
  boot = await bootModelSettings({ directory })
  assert.equal(boot.ctx.get('ivoraige.settingsPages').list().length, 1)
})

test('second DSH mutation failure reports persisted route and preserves the failed selection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-settings-partial-'))
  const app = await createApp({ store: join(directory, 'records.sqlite'), settingsDir: join(directory, 'settings') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const settings = app.ctx.settings
  const mutate = settings.mutate.bind(settings)
  settings.mutate = (ns, ...args) => ns === 'ivoraige-model' ?
    Promise.reject(new Error('injected second write failure')) : mutate(ns, ...args)
  try {
    await assert.rejects(app.operations.invoke('updateSettings', {
      provider: 'custom', model: 'scientific', api: 'openai-completions',
      baseURL: 'http://127.0.0.1:9999/v1', contextWindow: 8192, maxTokens: 512,
    }), error => {
      assert.equal(error.code, 'UPSTREAM_FAILURE')
      assert.equal(error.details.partialSave.persisted, 'routes')
      assert.equal(error.details.partialSave.failed, 'selected')
      assert.ok(Number.isInteger(error.details.partialSave.revisions.routes))
      return true
    })
  } finally { settings.mutate = mutate }
  const current = await app.settings.get()
  assert.ok(current.routes.custom)
  assert.equal(current.selected, null)
  assert.deepEqual(current.savedModels, [{ provider: 'custom', model: 'scientific', timeoutMs: 120000 }])

  settings.mutate = (ns, ...args) => ns === 'ivoraige-model' ?
    Promise.reject(new KernelError('CONFLICT', 'selection changed',
      { expected: 0, actual: 1, secret: 'must-stay-private' })) : mutate(ns, ...args)
  try {
    await assert.rejects(app.operations.invoke('updateSettings', {
      provider: 'custom', model: 'scientific', baseURL: 'http://127.0.0.1:9998/v1',
    }), error => {
      const envelope = errorEnvelope(error)
      assert.equal(envelope.status, 409)
      assert.equal(envelope.body.error.details.expected, 0)
      assert.equal(envelope.body.error.details.actual, 1)
      assert.doesNotMatch(JSON.stringify(envelope.body), /must-stay-private/)
      return true
    })
  } finally { settings.mutate = mutate }
})

test('HTTP subscribers receive mount and unmount changes and capabilities lose the page', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-settings-events-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  const server = await serve(app, { port: 0 })
  const controller = new AbortController()
  t.after(async () => {
    controller.abort()
    await server.close()
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const response = await fetch(`${server.url}/api/events`, { signal: controller.signal })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  async function nextEvent() {
    for (;;) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const match = /^event: ([\w.]+)\ndata: (.+)$/m.exec(frame)
        if (match) return { type: match[1], data: JSON.parse(match[2]) }
      }
      const chunk = await reader.read()
      if (chunk.done) throw new Error('SSE closed before settings event')
      buffer += decoder.decode(chunk.value, { stream: true })
    }
  }
  const fiber = app.ctx.plugin(Pdf, { directory: join(directory, 'pdf'), command: 'missing' })
  await fiber
  assert.deepEqual(await nextEvent(), { type: 'settings.pages.changed', data: {
    settingsPages: [{ id: 'pdf', label: 'PDF', order: 20 }],
  } })
  await fiber.dispose()
  assert.deepEqual(await nextEvent(), { type: 'settings.pages.changed', data: { settingsPages: [] } })
  const capabilities = await (await fetch(`${server.url}/api/capabilities`)).json()
  assert.deepEqual(capabilities.settingsPages, [])
  assert.equal(capabilities.features.includes('settings'), false)
})
