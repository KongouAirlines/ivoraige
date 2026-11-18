import './fixtures/host-test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Storage, StorageSqlite, StorageDomain } from '../dist/dsh.mjs'
import { PromptLibrary, DEFAULT_TEMPLATE, TRANSLATION_FEATURE, modelConfigurationId } from '../src/prompt-library.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-prompts-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(dir, 'store.sqlite') })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(PromptLibrary)
  const library = ctx.get('ivoraige.prompts')
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { library }
}

test('templates are immutable versions, bound by plugin, feature and real connection', async t => {
  const { library } = await fixture(t)
  const stopTranslate = library.register(TRANSLATION_FEATURE)
  assert.equal(library.hasFeature(TRANSLATION_FEATURE), true)
  const review = { pluginId: 'example.review', featureId: 'review', variables: ['sourceText'], output: 'review-notes' }
  const reviewDefault = { ...review, id: 'builtin:review', version: '1', name: 'Review', style: '' }
  const stopReview = library.register(review, reviewDefault)
  t.after(() => { stopTranslate(); stopReview() })
  assert.equal(library.hasFeature({ pluginId: 'not-registered', featureId: 'review' }), false)
  const routeA = { api: 'openai-completions', baseURL: 'http://localhost:8001/v1', apiKeyEnv: 'A' }
  const routeB = { ...routeA, baseURL: 'http://localhost:8002/v1' }
  const a = modelConfigurationId({ provider: 'local', model: 'same-name', route: routeA })
  const b = modelConfigurationId({ provider: 'local', model: 'same-name', route: routeB })
  assert.notEqual(a, b)
  assert.notEqual(a, modelConfigurationId({ provider: 'local', model: 'other-name', route: routeA }))
  assert.notEqual(a, modelConfigurationId({ provider: 'different-provider', model: 'same-name', route: routeA }))
  const selector = { ...TRANSLATION_FEATURE, configurationId: a }
  const builtin = await library.resolve(selector)
  assert.equal(builtin.source, 'builtin')
  assert.equal(builtin.template.id, DEFAULT_TEMPLATE.id)
  const custom = await library.copyTemplate({ name: 'Formal' })
  assert.equal(custom.style, '')
  const updated = await library.updateTemplate({ id: custom.id, expectedVersion: '1', style: 'Use concise academic prose.' })
  assert.equal(updated.version, '2')
  assert.equal(library.getTemplate(custom.id, '1').style, '')
  await library.bind({ ...selector, templateId: custom.id })
  const global = await library.resolve(selector)
  assert.equal(global.source, 'global')
  assert.equal(global.template.style, 'Use concise academic prose.')
  assert.notEqual(global.contentId, builtin.contentId)
  assert.equal((await library.resolve({ ...selector, configurationId: b })).source, 'builtin')
  assert.equal((await library.resolve({ ...review, configurationId: a })).source, 'builtin')
  const reviewCopy = await library.copyTemplate({ sourceId: reviewDefault.id })
  await library.bind({ ...review, configurationId: a, templateId: reviewCopy.id })
  assert.equal((await library.resolve({ ...review, configurationId: a })).template.id, reviewCopy.id)
  await assert.rejects(library.bind({ ...review, configurationId: a, templateId: custom.id }),
    { code: 'PRECONDITION_FAILED' })
  await library.bind({ ...selector, configurationId: b, templateId: custom.id })
  await library.bind({ ...selector, docId: 'doc-1', templateId: DEFAULT_TEMPLATE.id })
  assert.equal((await library.resolve({ ...selector, docId: 'doc-1' })).source, 'document')
  assert.equal((await library.resolve({ ...selector, docId: 'doc-2' })).source, 'global')
  assert.equal((await library.resolve({ ...selector, docId: 'doc-1', templateId: custom.id })).source, 'run')
  await library.restore({ ...selector, docId: 'doc-1' })
  assert.equal((await library.resolve({ ...selector, docId: 'doc-1' })).source, 'global')
  await library.restore(selector)
  assert.equal((await library.resolve(selector)).source, 'builtin')
  await assert.rejects(library.resolve({ ...selector, templateId: 'missing' }), { code: 'NOT_FOUND' })
  await assert.rejects(library.resolve({ ...review, configurationId: a, templateId: custom.id }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal((await library.resolve({ ...selector, configurationId: b })).source, 'global')
  assert.equal(library.table.get('library').templates.some(item => item.style === 'Use concise academic prose.'), true)
})

test('missing bound template records a compatible built-in fallback; missing plugin is isolated', async t => {
  const { library } = await fixture(t)
  library.register(TRANSLATION_FEATURE)
  const selector = { ...TRANSLATION_FEATURE, configurationId: 'config' }
  const custom = await library.copyTemplate()
  await library.bind({ ...selector, templateId: custom.id })
  const saved = structuredClone(library.table.get('library'))
  saved.bindings[JSON.stringify([selector.pluginId, selector.featureId, 'config', null])].templateId = 'missing'
  await library.table.put('library', saved)
  library.data = saved
  const fallback = await library.resolve(selector)
  assert.equal(fallback.source, 'builtin')
  assert.equal(fallback.fallback.reason, 'Prompt template or version is missing')
  await assert.rejects(library.resolve({ pluginId: 'missing', featureId: 'missing', configurationId: 'config' }),
    { code: 'COMPONENT_MISSING' })
  assert.equal((await library.resolve(selector)).template.id, DEFAULT_TEMPLATE.id)
})

test('invalid stored prompt content is reported by the prompt service, without losing storage availability', async t => {
  const { library } = await fixture(t)
  library.register(TRANSLATION_FEATURE)
  await library.table.put('library', { templates: [{ id: 'broken', variables: null }], bindings: {} })
  library.data = structuredClone(library.table.get('library'))
  await assert.rejects(library.list(), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(library.resolve({ ...TRANSLATION_FEATURE, configurationId: 'local' }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal(library.domain.table('library').get('library').templates.length, 1)
})

test('a real DSH profile prompt plugin waiting at boot activates when the service mounts later', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-profile-prompt-'))
  const settingsDir = join(directory, 'settings')
  let boot, app
  t.after(async () => { await app?.dispose(); await boot?.dispose(); await rm(directory, { recursive: true, force: true }) })
  boot = await bootModelSettings({ directory: settingsDir })
  await boot.dispose()
  boot = undefined
  await writeFile(join(settingsDir, 'prompt-probe.mjs'), [
    "export const inject = ['ivoraige.prompts']",
    'export function apply(ctx) {',
    "  const prompts = ctx.get('ivoraige.prompts')",
    "  ctx.effect(() => prompts.register({ pluginId: 'probe.plugin', featureId: 'review',",
    "    variables: ['sourceText'], output: 'review-notes' },",
    "    { id: 'builtin:probe', version: '1', name: 'Probe', pluginId: 'probe.plugin',",
    "      featureId: 'review', variables: ['sourceText'], output: 'review-notes', style: '' }))",
    "  ctx.provide('probe.activated', true)",
    '}',
    '',
  ].join('\n'))
  await writeFile(join(settingsDir, 'cordis.patch.yml'), JSON.stringify([
    { insert: [{ id: 'profile-prompt-probe', name: './prompt-probe.mjs' }] },
  ]) + '\n')
  boot = await bootModelSettings({ directory: settingsDir })
  assert.equal(boot.ctx.get('probe.activated'), undefined, 'the profile entry waits for PromptLibrary')
  await boot.dispose()
  boot = undefined
  app = await createApp({ store: join(directory, 'store.sqlite'), settingsDir })
  assert.equal(app.ctx.get('probe.activated'), true, 'late provider registration activates the profile entry')
  assert.ok((await app.prompts.list()).features.some(item => item.pluginId === 'probe.plugin'))
  const selected = await app.prompts.resolve({ pluginId: 'probe.plugin', featureId: 'review', configurationId: 'local' })
  assert.equal(selected.template.id, 'builtin:probe')
  await app.dispose()
  app = undefined
})
