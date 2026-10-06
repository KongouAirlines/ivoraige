import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createApp } from '../src/app.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { modelPresets } from '../src/model-presets.mjs'
import { modelForm, presetForm, modelSettingsRequest } from '../web/model-settings-state.mjs'

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
