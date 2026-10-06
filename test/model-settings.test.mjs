import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { bootModelSettings } from '../src/model-settings.mjs'
import { createApp } from '../src/app.mjs'

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
