import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { bootModelSettings } from '../src/model-settings.mjs'
import { createApp } from '../src/app.mjs'
import { errorEnvelope } from '../src/protocol.mjs'

test('unconfigured model fails before recording an LLM call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-unconfigured-model-'))
  const app = await createApp({ store: join(directory, 'records.sqlite'),
    settingsDir: join(directory, 'settings') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'A result.' },
    { sourceId: 'settings:unconfigured', language: 'en' })
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  const failed = await app.tasks.wait(taskId)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.message, 'No translation model configured')
  assert.equal(failed.stats.llmCalls, 0)
  assert.equal(failed.cursor, 0)
})

test('DSH settings and credentials persist a model configured after empty boot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-model-settings-'))
  let app = await bootModelSettings({ directory })
  t.after(async () => {
    if (app) await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  assert.equal(app.settings.resolve(), null)
  assert.deepEqual((await app.settings.get()).routes, {})

  const saved = await app.settings.update({
    provider: 'local', model: 'scientific', api: 'openai-completions',
    baseURL: 'http://127.0.0.1:9999/v1', credentialRef: 'IVORAIGE_LOCAL_KEY',
    contextWindow: 8192, maxTokens: 512,
  })
  assert.partialDeepStrictEqual(saved.selected, { provider: 'local', model: 'scientific' })
  assert.equal(saved.routes.local.apiKeyEnv, 'IVORAIGE_LOCAL_KEY')
  await app.settings.setCredential({ ref: 'IVORAIGE_LOCAL_KEY', value: 'a-private-test-secret' })
  const view = await app.settings.get()
  assert.equal(view.credentials.local.configured, true)
  assert.doesNotMatch(JSON.stringify(view), /a-private-test-secret/)
  assert.doesNotMatch(await readFile(join(directory, 'cordis.patch.yml'), 'utf8'), /a-private-test-secret/)
  await assert.rejects(app.settings.update({ provider: 'local', model: 'other',
    routesRevision: view.revisions.routes, selectedRevision: view.revisions.selected - 1 }),
  { code: 'CONFLICT' })
  assert.partialDeepStrictEqual(app.settings.resolve(), { provider: 'local', model: 'scientific' })
  const changed = await app.settings.update({ provider: 'local', model: 'scientific-v2',
    contextWindow: 8192, maxTokens: 512,
    selectedRevision: view.revisions.selected })
  assert.equal(changed.routes.local.baseURL, 'http://127.0.0.1:9999/v1')
  assert.equal(changed.routes.local.apiKeyEnv, 'IVORAIGE_LOCAL_KEY')

  await app.dispose()
  app = await bootModelSettings({ directory })
  assert.partialDeepStrictEqual(app.settings.resolve(), { provider: 'local', model: 'scientific-v2' })
  assert.equal((await app.settings.get()).credentials.local.configured, true)
  assert.equal((await app.ctx.credentials.resolve('IVORAIGE_LOCAL_KEY')).value, 'a-private-test-secret')
})

test('createApp uses saved DSH settings for translation after empty boot and restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-app-settings-'))
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ headers: request.headers, body: JSON.parse(body) })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end([
      { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
      { choices: [{ delta: { content: '细胞分裂。' }, index: 0, finish_reason: null }] },
      { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let app
  t.after(async () => {
    if (app) await app.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const store = join(directory, 'records.sqlite')
  const settingsDir = join(directory, 'settings')
  app = await createApp({ store, settingsDir })
  assert.equal(app.settings.resolve(), null)
  await assert.rejects(app.ctx.get('ivoraige.translationModel').translate({ basis: {
    sourceText: 'A cell divides.', sourceLang: 'en', targetLang: 'zh-CN',
    effectiveContext: {}, effectiveTarget: {}, termConstraintSetId: 'none',
  } }), { code: 'COMPONENT_MISSING' })
  await app.settings.update({
    provider: 'local', model: 'scientific', api: 'openai-completions',
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    credentialRef: 'IVORAIGE_TEST_KEY', contextWindow: 8192, maxTokens: 512,
  })
  await app.settings.setCredential({ ref: 'IVORAIGE_TEST_KEY', value: 'private-local-secret' })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'A cell divides.' },
    { sourceId: 'settings:cell', language: 'en' })
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh-CN', mode: 'fast' })
  const finished = await app.tasks.wait(taskId)
  assert.equal(finished.state, 'succeeded', JSON.stringify(finished.error))
  assert.equal(finished.stats.llmCalls, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].headers.authorization, 'Bearer private-local-secret')
  assert.equal(requests[0].body.model, 'scientific')
  await app.dispose()
  app = await createApp({ store, settingsDir })
  assert.partialDeepStrictEqual(app.settings.resolve(), { provider: 'local', model: 'scientific' })
  const reused = await app.tasks.submit(document.id, { targetLang: 'zh-CN', mode: 'fast' })
  const second = await app.tasks.wait(reused.taskId)
  assert.equal(second.state, 'succeeded', JSON.stringify(second.error))
  assert.equal(second.stats.llmCalls, 0)
  assert.equal(requests.length, 1)
})

test('model library saves multiple providers and models and switches without editing routes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-model-library-'))
  let app = await bootModelSettings({ directory })
  t.after(async () => {
    if (app) await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const first = await app.settings.update({ provider: 'provider-a', model: 'a1',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9991/v1',
    credentialRef: 'PROVIDER_A_KEY', contextWindow: 8192, maxTokens: 512, timeoutMs: 1000 })
  const second = await app.settings.update({ provider: 'provider-a', model: 'a2',
    contextWindow: 16384, maxTokens: 1024, timeoutMs: 2000, select: false })
  assert.deepEqual(second.selected, first.selected)
  assert.equal(second.routes['provider-a'].models.length, 2)
  const third = await app.settings.update({ provider: 'provider-b', model: 'b1',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9992/v1',
    credentialRef: 'PROVIDER_B_KEY', contextWindow: 8192, maxTokens: 512,
    timeoutMs: 3000, select: false })
  assert.deepEqual(third.selected, first.selected)
  assert.deepEqual(third.savedModels, [
    { provider: 'provider-a', model: 'a1', timeoutMs: 1000 },
    { provider: 'provider-a', model: 'a2', timeoutMs: 2000 },
    { provider: 'provider-b', model: 'b1', timeoutMs: 3000 },
  ])
  assert.ok(Array.isArray(third.presets))

  const routesBefore = structuredClone(third.routes)
  const routesRevision = third.revisions.routes
  await assert.rejects(app.settings.update({ provider: 'provider-b', model: 'missing', selectOnly: true }),
    { code: 'INVALID_ARGUMENT' })
  await assert.rejects(app.settings.update({ provider: 'provider-b', model: 'b1',
    selectOnly: true, baseURL: 'http://example.test' }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(app.settings.update({ provider: 'provider-b', model: 'b1',
    selectOnly: true, selectedRevision: third.revisions.selected - 1 }), { code: 'CONFLICT' })
  const selected = await app.settings.update({ provider: 'provider-b', model: 'b1',
    selectOnly: true, routesRevision, selectedRevision: third.revisions.selected })
  assert.deepEqual(selected.selected, { provider: 'provider-b', model: 'b1', timeoutMs: 3000 })
  assert.deepEqual(selected.routes, routesBefore)
  assert.equal(selected.revisions.routes, routesRevision)

  await app.dispose()
  app = await bootModelSettings({ directory })
  const restarted = await app.settings.get()
  assert.deepEqual(restarted.selected, selected.selected)
  assert.deepEqual(restarted.savedModels, selected.savedModels)
  assert.deepEqual(restarted.routes, routesBefore)
})

test('model library exposes legacy declared route models and current selection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-legacy-model-library-'))
  let app = await bootModelSettings({ directory })
  t.after(async () => {
    if (app) await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await app.settings.update({ provider: 'old', model: 'current',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9993/v1',
    contextWindow: 8192, maxTokens: 512, timeoutMs: 4500 })
  await app.settings.update({ provider: 'old', model: 'declared',
    contextWindow: 8192, maxTokens: 512, select: false })
  await app.ctx.settings.mutate('ivoraige-model', [
    { op: 'set', path: ['savedModels'], value: [] },
  ])
  await app.dispose()
  app = await bootModelSettings({ directory })
  const legacy = await app.settings.get()
  assert.deepEqual(app.settings.savedModels({ old: { models: [{ id: 'declared' }, { id: 'current' }] } }), [
    { provider: 'old', model: 'current', timeoutMs: 4500 },
    { provider: 'old', model: 'declared', timeoutMs: 120000 },
  ])
  assert.deepEqual(legacy.savedModels, [
    { provider: 'old', model: 'current', timeoutMs: 4500 },
    { provider: 'old', model: 'declared', timeoutMs: 120000 },
  ])
  const switched = await app.settings.update({ provider: 'old', model: 'declared', selectOnly: true })
  assert.deepEqual(switched.selected, { provider: 'old', model: 'declared', timeoutMs: 120000 })
})

test('catalog models use a DSH route and modelOverrides for capacity edits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-catalog-model-library-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const preset = (await app.settings.get()).presets.find(item => item.id === 'deepseek')
  assert.ok(preset)
  const saved = await app.settings.update({ provider: 'deepseek', model: preset.defaults.model,
    select: false })
  assert.ok(saved.routes.deepseek)
  assert.equal(saved.selected, null)
  const changed = await app.settings.update({ provider: 'deepseek', model: preset.defaults.model,
    contextWindow: 65536, maxTokens: 4096, select: false })
  assert.equal(changed.routes.deepseek.models.length, 0)
  assert.partialDeepStrictEqual(changed.routes.deepseek.modelOverrides[preset.defaults.model],
    { contextWindow: 65536, maxTokens: 4096 })
  assert.equal(changed.presets.some(item => item.id === 'xai'), false)
  const xaiModel = getBuiltinModels('xai')[0].id
  const outsidePresets = await app.settings.update({ provider: 'xai', model: xaiModel,
    contextWindow: 65536, maxTokens: 4096, select: false })
  assert.equal(outsidePresets.routes.xai.models.length, 0)
  assert.partialDeepStrictEqual(outsidePresets.routes.xai.modelOverrides[xaiModel],
    { contextWindow: 65536, maxTokens: 4096 })
})

test('unknown catalog model fails before changing a route with existing overrides', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-unknown-catalog-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const known = getBuiltinModels('deepseek')[0].id
  const before = await app.settings.update({ provider: 'deepseek', model: known,
    contextWindow: 65536, maxTokens: 4096 })
  await assert.rejects(app.settings.update({ provider: 'deepseek', model: 'unlisted-model',
    contextWindow: 8192, maxTokens: 1024 }), { code: 'INVALID_ARGUMENT' })
  const after = await app.settings.get()
  assert.deepEqual(after.routes, before.routes)
  assert.deepEqual(after.revisions, before.revisions)
  assert.deepEqual(after.savedModels, before.savedModels)
})

test('clearing route fields and catalog capacity restores installed defaults', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-clear-catalog-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const model = getBuiltinModels('deepseek')[0].id
  await app.settings.update({ provider: 'deepseek', model, api: 'openai-completions',
    baseURL: 'https://example.invalid/v1', credentialRef: 'DEEPSEEK_TEST_KEY',
    reasoning: 'medium', contextWindow: 65536, maxTokens: 4096 })
  const cleared = await app.settings.update({ provider: 'deepseek', model,
    api: null, baseURL: null, credentialRef: null, reasoning: null,
    contextWindow: null, maxTokens: null, reasoningEfforts: null })
  assert.equal(cleared.routes.deepseek.api, undefined)
  assert.equal(cleared.routes.deepseek.baseURL, undefined)
  assert.equal(cleared.routes.deepseek.apiKeyEnv, undefined)
  assert.equal(cleared.routes.deepseek.reasoning, undefined)
  assert.equal(cleared.routes.deepseek.modelOverrides?.[model], undefined)
  assert.equal(cleared.routes.deepseek.models.length, 0)
})

test('custom models need declared capacity and cannot clear it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-custom-capacity-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await assert.rejects(app.settings.update({ provider: 'custom', model: 'new',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9995/v1' }),
  { code: 'INVALID_ARGUMENT' })
  const saved = await app.settings.update({ provider: 'custom', model: 'new',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9995/v1',
    contextWindow: 8192, maxTokens: 512 })
  await assert.rejects(app.settings.update({ provider: 'custom', model: 'new',
    contextWindow: null, maxTokens: null }), { code: 'INVALID_ARGUMENT' })
  const after = await app.settings.get()
  assert.deepEqual(after.routes, saved.routes)
  assert.deepEqual(after.revisions, saved.revisions)
})

test('saving the active model without selection preserves its new timeout for the next switch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-active-model-library-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await app.settings.update({ provider: 'custom', model: 'one',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:9994/v1',
    contextWindow: 8192, maxTokens: 512, timeoutMs: 1000 })
  const saved = await app.settings.update({ provider: 'custom', model: 'one',
    timeoutMs: 5000, select: false })
  assert.deepEqual(saved.selected, { provider: 'custom', model: 'one', timeoutMs: 1000 })
  assert.deepEqual(saved.savedModels, [{ provider: 'custom', model: 'one', timeoutMs: 5000 }])
  const selected = await app.settings.update({ provider: 'custom', model: 'one', selectOnly: true })
  assert.deepEqual(selected.selected, { provider: 'custom', model: 'one', timeoutMs: 5000 })
})

test('invalid DSH route values map to public argument errors without persisting settings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-invalid-model-settings-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const before = await app.settings.get()
  for (const changes of [
    { compat: 'invalid' },
    { compat: { supportsStore: 'yes' } },
    { reasoningEfforts: ['low'] },
    { reasoningEfforts: {} },
    { reasoningEfforts: { low: null } },
  ]) {
    await assert.rejects(app.settings.update({ provider: 'local', model: 'science',
      api: 'openai-completions', baseURL: 'http://127.0.0.1:9999/v1',
      contextWindow: 8192, maxTokens: 512, ...changes }), error => {
      assert.equal(errorEnvelope(error).body.error.code, 'INVALID_ARGUMENT')
      return true
    })
  }
  const after = await app.settings.get()
  assert.deepEqual(after.routes, before.routes)
  assert.deepEqual(after.revisions, before.revisions)
})

test('missing DSH settings forms use a public component error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-missing-settings-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  t.mock.method(app.ctx.settings, 'describe', () => [])
  await assert.rejects(app.settings.get(), { code: 'COMPONENT_MISSING' })
  await assert.rejects(app.settings.update({ provider: 'local', model: 'science' }),
    { code: 'COMPONENT_MISSING' })
})
