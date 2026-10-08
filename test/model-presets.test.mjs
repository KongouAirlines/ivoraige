import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createApp } from '../src/app.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { modelPresets } from '../src/model-presets.mjs'
import { modelForm, presetForm, modelSettingsRequest, modelSettingsPath,
  modelSettingsView, sharedRouteModels, modelDraftDirty,
  shouldReplaceModelDraft, mayApplyModelRead, savedModelPathAfterSave,
  formForProviderChange, formForModelChange, formForPresetChoice } from '../web/model-settings-state.mjs'

test('provider presets produce valid DSH routes without network calls or credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-presets-'))
  const app = await bootModelSettings({ directory })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  for (const preset of modelPresets) {
    const form = presetForm(preset)
    if (!form.model) form.model = 'user-loaded-model'
    const current = await app.settings.get()
    const saved = await app.settings.update(modelSettingsRequest(form, current.revisions))
    assert.equal(saved.selected, null, preset.id)
    assert.ok(saved.savedModels.some(item => item.provider === form.provider && item.model === form.model), preset.id)
    assert.equal(saved.routes[form.provider].apiKeyEnv, form.credentialRef)
    if (form.baseURL) assert.equal(saved.routes[form.provider].baseURL, form.baseURL)
    else {
      const model = (await app.ctx.llm.listModels(form.provider)).find(item => item.id === form.model)
      assert.ok(model, preset.id)
    }
    assert.equal(saved.credentials[form.provider].configured, false)
  }
})

test('editing a saved model keeps its timeout, capacity and unrelated compatibility fields', () => {
  const settings = { selected: { provider: 'a', model: 'one', timeoutMs: 1000 },
    savedModels: [{ provider: 'b', model: 'two', timeoutMs: 3000 }],
    routes: { b: { api: 'openai-completions', apiKeyEnv: 'B_KEY',
      compat: { supportsStore: false, thinkingFormat: 'deepseek' },
      modelOverrides: { two: { contextWindow: 8192, maxTokens: 1024 } } } } }
  const form = modelForm(settings, 'b', 'two')
  const request = modelSettingsRequest(form, { routes: 10, selected: 20 })
  assert.equal(request.select, false)
  assert.equal(request.timeoutMs, 3000)
  assert.deepEqual(request.compat, { supportsStore: false, thinkingFormat: 'deepseek' })
  assert.equal(request.contextWindow, 8192)
  assert.equal(request.maxTokens, 1024)
  form.thinkingFormat = ''
  assert.deepEqual(modelSettingsRequest(form, { routes: 10, selected: 20 }, true).compat,
    { supportsStore: false })
  assert.equal(settings.routes.b.compat.thinkingFormat, 'deepseek')
})

test('cleared fields request removal and catalog presets do not override a mixed-protocol route', () => {
  const preset = modelPresets.find(item => item.id === 'openrouter')
  assert.ok(new Set(preset.models.map(item => item.api)).size > 1)
  const form = presetForm(preset)
  const request = modelSettingsRequest(form, { routes: 1, selected: 1 })
  assert.equal(request.api, null)
  assert.equal(request.baseURL, null)
  assert.equal(request.reasoning, null)
  assert.equal(request.contextWindow, null)
  assert.equal(request.maxTokens, null)
  assert.equal(request.reasoningEfforts, null)
  assert.deepEqual(request.compat, {})
})

test('half-filled capacity pairs are rejected before sending settings requests', () => {
  for (const values of [{ contextWindow: '8192', maxTokens: '' }, { contextWindow: '', maxTokens: '2048' }]) {
    assert.throws(() => modelSettingsRequest({ ...presetForm(modelPresets[0]), ...values }, { routes: 1, selected: 1 }),
      /必须同时填写/)
  }
})

test('model detail paths encode provider and model identifiers and shared routes list affected models', () => {
  const path = modelSettingsPath('custom/a', 'model ? # / 中文')
  assert.deepEqual(modelSettingsView(path), { kind: 'edit', provider: 'custom/a', model: 'model ? # / 中文' })
  assert.deepEqual(modelSettingsView(modelSettingsPath()), { kind: 'new' })
  assert.deepEqual(modelSettingsView('/settings/models'), { kind: 'list' })
  assert.deepEqual(sharedRouteModels({ savedModels: [
    { provider: 'a', model: 'one' }, { provider: 'a', model: 'two' }, { provider: 'b', model: 'one' },
  ] }, 'a').map(item => item.model), ['one', 'two'])
})

test('draft tracking treats credential input as unsaved without exposing it in requests', () => {
  const base = emptyModelFormForTest()
  assert.equal(modelDraftDirty(base, base), false)
  assert.equal(modelDraftDirty({ ...base, timeoutMs: String(base.timeoutMs) }, base), false)
  assert.equal(modelDraftDirty(base, base, 'secret'), true)
  assert.equal(modelDraftDirty({ ...base, timeoutMs: 9000 }, base), true)
})

test('reconnect refreshes a clean model form but preserves a dirty draft and its revisions', () => {
  const baseline = emptyModelFormForTest()
  const current = { available: true, settings: { revisions: { routes: 4, selected: 5 } },
    initializedView: 'edit', viewKey: 'edit', form: baseline, baseline, secret: '' }
  assert.equal(shouldReplaceModelDraft(current), true)
  assert.equal(shouldReplaceModelDraft({ ...current, form: { ...baseline, timeoutMs: 3000 } }), false)
  assert.equal(shouldReplaceModelDraft({ ...current, secret: 'typed-key' }), false)
  assert.equal(shouldReplaceModelDraft({ ...current, available: false }), false)
  assert.equal(shouldReplaceModelDraft({ ...current, initializedView: 'list' }), true)
})

test('new model save switches to its edit identity and reads back saved fields', () => {
  const form = { ...emptyModelFormForTest(), provider: 'custom/a', model: 'reader/large',
    api: 'openai-completions', baseURL: 'http://127.0.0.1:1234/v1', timeoutMs: 90000 }
  const target = savedModelPathAfterSave({ kind: 'new' }, form)
  assert.deepEqual(modelSettingsView(target), { kind: 'edit', provider: form.provider, model: form.model })
  assert.equal(savedModelPathAfterSave({ kind: 'edit', provider: form.provider, model: form.model }, form), null)
  assert.equal(savedModelPathAfterSave({ kind: 'edit', provider: 'old', model: 'entry' }, form), target)
  const settings = { savedModels: [{ provider: form.provider, model: form.model, timeoutMs: form.timeoutMs }],
    routes: { [form.provider]: { api: form.api, baseURL: form.baseURL, models: [
      { id: form.model, contextWindow: 8192, maxTokens: 1024 },
    ] } } }
  const readBack = modelForm(settings, form.provider, form.model)
  assert.equal(readBack.model, form.model)
  assert.equal(readBack.baseURL, form.baseURL)
  assert.equal(readBack.timeoutMs, form.timeoutMs)
})

test('settings read started before a write cannot overwrite the acknowledged result', () => {
  const read = { active: true, available: true, startedVersion: 2, currentVersion: 2,
    startedView: 'new', currentView: 'new' }
  assert.equal(mayApplyModelRead(read), true)
  assert.equal(mayApplyModelRead({ ...read, currentVersion: 3 }), false)
  assert.equal(mayApplyModelRead({ ...read, currentView: 'edit' }), false)
  assert.equal(mayApplyModelRead({ ...read, available: false }), false)
})

test('changing provider loads its route and never submits source route or model overrides', () => {
  const settings = { selected: { provider: 'a', model: 'source', timeoutMs: 1111 },
    savedModels: [
      { provider: 'a', model: 'source', timeoutMs: 1111 },
      { provider: 'b', model: 'target', timeoutMs: 2222 },
    ], routes: {
      a: { api: 'openai-completions', baseURL: 'https://a.example/v1', apiKeyEnv: 'A_KEY',
        reasoning: 'off', compat: { thinkingFormat: 'a', supportsStore: false },
        models: [{ id: 'source', contextWindow: 4096, maxTokens: 512 }] },
      b: { api: 'anthropic-messages', baseURL: 'https://b.example/v1', apiKeyEnv: 'B_KEY',
        reasoning: 'on', compat: { thinkingFormat: 'b' },
        models: [{ id: 'target', contextWindow: 8192, maxTokens: 2048 }] },
    } }
  const source = modelForm(settings, 'a', 'source')
  const changed = formForProviderChange(settings, [], source, 'b')
  assert.equal(changed.provider, 'b')
  assert.equal(changed.model, '')
  assert.equal(changed.api, 'anthropic-messages')
  assert.equal(changed.baseURL, 'https://b.example/v1')
  assert.equal(changed.credentialRef, 'B_KEY')
  assert.equal(changed.reasoning, 'on')
  assert.deepEqual(changed.compat, { thinkingFormat: 'b' })
  assert.equal(changed.contextWindow, '')
  assert.equal(changed.maxTokens, '')
  assert.equal(changed.timeoutMs, 120_000)
  assert.deepEqual(formForProviderChange(settings, [], source, 'unconfigured'),
    { ...emptyModelFormForTest(), provider: 'unconfigured', model: '' })
  const target = formForModelChange(settings, changed, 'target')
  const request = modelSettingsRequest(target, { routes: 3, selected: 4 })
  assert.equal(request.baseURL, 'https://b.example/v1')
  assert.equal(request.credentialRef, 'B_KEY')
  assert.equal(request.contextWindow, 8192)
  assert.equal(request.maxTokens, 2048)
  assert.equal(request.timeoutMs, 2222)
})

test('changing model loads target capacity but preserves edited shared provider route', () => {
  const settings = { savedModels: [{ provider: 'p', model: 'one', timeoutMs: 1000 },
    { provider: 'p', model: 'two', timeoutMs: 2000 }], routes: { p: {
    api: 'openai-completions', baseURL: 'https://p.example/v1', apiKeyEnv: 'P_KEY',
    modelOverrides: { one: { contextWindow: 4096, maxTokens: 512, reasoningEfforts: ['low'] },
      two: { contextWindow: 16384, maxTokens: 4096, reasoningEfforts: ['high'] } },
  } } }
  const edited = { ...modelForm(settings, 'p', 'one'), baseURL: 'https://edited.example/v1' }
  const target = formForModelChange(settings, edited, 'two')
  assert.equal(target.baseURL, 'https://edited.example/v1')
  assert.equal(target.contextWindow, 16384)
  assert.equal(target.maxTokens, 4096)
  assert.deepEqual(target.reasoningEfforts, ['high'])
  assert.equal(target.timeoutMs, 2000)
  const newModel = formForModelChange(settings, edited, 'third')
  assert.equal(newModel.baseURL, edited.baseURL)
  assert.equal(newModel.contextWindow, '')
  assert.equal(newModel.maxTokens, '')
  assert.equal(newModel.reasoningEfforts, null)
  assert.equal(newModel.timeoutMs, 120_000)
})

test('provider change to matching saved model uses destination overrides; preset change clears source capacity', () => {
  const settings = { savedModels: [
    { provider: 'a', model: 'shared', timeoutMs: 1000 },
    { provider: 'b', model: 'shared', timeoutMs: 2000 },
  ], routes: {
    a: { baseURL: 'https://a.example/v1', apiKeyEnv: 'A_KEY',
      modelOverrides: { shared: { contextWindow: 4000, maxTokens: 400 } } },
    b: { baseURL: 'https://b.example/v1', apiKeyEnv: 'B_KEY',
      modelOverrides: { shared: { contextWindow: 8000, maxTokens: 800 } } },
  } }
  const source = modelForm(settings, 'a', 'shared')
  const target = formForProviderChange(settings, [], source, 'b')
  assert.equal(target.model, 'shared')
  assert.equal(target.baseURL, 'https://b.example/v1')
  assert.equal(target.credentialRef, 'B_KEY')
  assert.equal(target.contextWindow, 8000)
  assert.equal(target.maxTokens, 800)
  assert.equal(target.timeoutMs, 2000)
  const preset = { defaults: { provider: 'c', model: 'sample', api: 'openai-completions',
    baseURL: 'https://c.example/v1', credentialRef: 'C_KEY', contextWindow: 16000, maxTokens: 1600 } }
  const unsaved = formForProviderChange(settings, [preset], source, 'c')
  assert.equal(unsaved.model, '')
  assert.equal(unsaved.baseURL, 'https://c.example/v1')
  assert.equal(unsaved.credentialRef, 'C_KEY')
  assert.equal(unsaved.contextWindow, '')
  assert.equal(unsaved.maxTokens, '')
})

test('choosing a preset for an installed provider keeps its custom route and target model fields', () => {
  const preset = { defaults: { provider: 'ollama', model: 'loaded', api: 'openai-completions',
    baseURL: 'http://127.0.0.1:11434/v1', credentialRef: 'OLLAMA_LOCAL_KEY',
    contextWindow: 8192, maxTokens: 2048 } }
  const settings = { selected: null, savedModels: [
    { provider: 'ollama', model: 'loaded', timeoutMs: 45000 },
  ], routes: { ollama: {
    api: 'openai-completions', baseURL: 'http://127.0.0.1:4444/v1', apiKeyEnv: 'CUSTOM_KEY',
    reasoning: 'off', compat: { supportsStore: false },
    models: [{ id: 'loaded', contextWindow: 32000, maxTokens: 4000 }],
  } } }
  const form = formForPresetChoice(settings, preset)
  assert.equal(form.baseURL, 'http://127.0.0.1:4444/v1')
  assert.equal(form.credentialRef, 'CUSTOM_KEY')
  assert.equal(form.contextWindow, 32000)
  assert.equal(form.maxTokens, 4000)
  assert.equal(form.timeoutMs, 45000)
  assert.deepEqual(modelSettingsRequest(form, { routes: 1, selected: 2 }).compat,
    { supportsStore: false })
  const fresh = formForPresetChoice({ routes: {} }, preset)
  assert.equal(fresh.baseURL, preset.defaults.baseURL)
  assert.equal(fresh.credentialRef, preset.defaults.credentialRef)
})

function emptyModelFormForTest() { return presetForm({ defaults: { provider: 'local', model: 'test' } }) }

test('local presets distinguish serving endpoints from a model family and keep placeholder outside config', () => {
  for (const id of ['ollama', 'llama-cpp', 'lmstudio']) {
    const preset = modelPresets.find(item => item.id === id)
    assert.ok(preset)
    assert.equal(new URL(preset.defaults.baseURL).hostname, '127.0.0.1')
    const request = modelSettingsRequest(presetForm(preset), { routes: 1, selected: 1 })
    assert.equal(preset.placeholderCredential, 'local')
    assert.ok(request.credentialRef)
    assert.equal(request.value, undefined)
    assert.equal(request.apiKey, undefined)
  }
})

test('saved model switching reaches the selected route; reuse after restart makes no extra calls', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-model-switch-'))
  const requests = []
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(text) })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '测试译文。' }, index: 0, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const config = { store: join(directory, 'store.sqlite'), settingsDir: join(directory, 'settings') }
  let app
  t.after(async () => {
    if (app) await app.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  app = await createApp(config)
  for (const name of ['a', 'b']) {
    await app.operations.invoke('updateSettings', { provider: `local-${name}`, model: `model-${name}`,
      api: 'openai-completions', baseURL: `http://127.0.0.1:${server.address().port}/${name}/v1`,
      credentialRef: `LOCAL_${name}`, contextWindow: 8192, maxTokens: 512, select: false })
    await app.operations.invoke('setCredential', { ref: `LOCAL_${name}`, value: `placeholder-${name}` })
  }
  assert.equal(app.settings.resolve(), null)
  let lastDocId
  for (const name of ['a', 'b']) {
    await app.operations.invoke('updateSettings', { provider: `local-${name}`, model: `model-${name}`, selectOnly: true })
    const { document } = await app.records.importDocument({ format: 'txt', content: `Sentence ${name}.` },
      { sourceId: `switch:${name}`, language: 'en' })
    lastDocId = document.id
    const { taskId } = await app.operations.invoke('translate', { docId: document.id, targetLang: 'zh', mode: 'fast' })
    const task = await app.tasks.wait(taskId)
    assert.equal(task.state, 'succeeded', JSON.stringify(task.error))
  }
  assert.deepEqual(requests.map(item => [item.url, item.authorization, item.body.model]), [
    ['/a/v1/chat/completions', 'Bearer placeholder-a', 'model-a'],
    ['/b/v1/chat/completions', 'Bearer placeholder-b', 'model-b'],
  ])
  await app.dispose()
  app = await createApp(config)
  assert.equal(app.settings.resolve().model, 'model-b')
  assert.equal((await app.settings.get()).savedModels.length, 2)
  const reused = await app.operations.invoke('translate', { docId: lastDocId, targetLang: 'zh', mode: 'fast' })
  assert.equal((await app.tasks.wait(reused.taskId)).stats.llmCalls, 0)
  const exported = await app.operations.invoke('exportDocument', { docId: lastDocId, targetLang: 'zh', outputs: [{ format: 'md' }, { format: 'json' }] })
  assert.equal((await app.tasks.wait(exported.taskId)).state, 'succeeded')
  assert.equal(requests.length, 2)
})
