import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { Exporter } from '../src/export.mjs'
import { TRANSLATION_FEATURE } from '../src/prompt-library.mjs'

test('tasks resolve models mounted and replaced after startup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-late-model-'))
  const app = await createApp({ store: join(directory, 'store.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'First.\n\nSecond.' }, { language: 'en' })
  const units = app.records.listUnits(document.id, { targetLang: 'zh' })
  let calls = 0
  class Model extends Service {
    constructor(ctx, { label }) { super(ctx, 'ivoraige.translationModel'); this.label = label }
    async translate() { calls++; return { text: this.label, modelId: this.label, promptVersion: 'test', tokens: { input: null, output: null } } }
  }
  const first = await app.ctx.plugin(Model, { label: 'first model' })
  const submit = async unitId => {
    const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh', unitIds: [unitId] })
    return app.tasks.wait(taskId)
  }
  assert.equal((await submit(units[0].id)).state, 'succeeded')
  await first.dispose()
  await app.ctx.plugin(Model, { label: 'replacement model' })
  assert.equal((await submit(units[1].id)).state, 'succeeded')
  assert.equal(calls, 2)
  assert.equal(app.records.getUnit(units[1].id, { targetLang: 'zh' }).accepted.text, 'replacement model')
  const selected = await app.tasks.submit(document.id, { targetLang: 'zh', unitIds: [units[0].id],
    promptTemplateId: 'builtin:scientific-translation' })
  const unsupported = await app.tasks.wait(selected.taskId)
  assert.equal(unsupported.state, 'failed')
  assert.match(unsupported.error.message, /cannot resolve the prompt template/)
  assert.equal(unsupported.stats.llmCalls, 0)
  assert.equal(calls, 2)
  await [...app.ctx.registry.get(Exporter).fibers][0].dispose()
  const { taskId } = await app.tasks.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'json' }] })
  const failed = await app.tasks.wait(taskId)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.message, 'Install an export service before exporting')
})

test('claimed prompt model needs selection and basis preflight while translate-only replacements remain supported', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-prompt-model-contract-'))
  const app = await createApp({ store: join(directory, 'store.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'First.' },
    { sourceId: 'prompt-contract', language: 'en' })
  let calls = 0, preflights = 0
  class ClaimedModel extends Service {
    constructor(ctx) {
      super(ctx, 'ivoraige.translationModel')
      ctx.effect(() => ctx.get('ivoraige.prompts').register(TRANSLATION_FEATURE))
    }
    async translate({ pinned }) {
      calls++
      return { text: '译文。', modelId: 'fixture', promptVersion: 'fixture-v1',
        promptTrace: pinned?.promptTrace, tokens: { input: null, output: null } }
    }
  }
  class PreflightOnly extends ClaimedModel {
    async preflight() { preflights++ }
  }
  class SelectionOnly extends ClaimedModel {
    async resolvePromptSelection() { return {} }
  }
  class MissingTrace extends SelectionOnly {
    async preflight() { preflights++ }
  }
  class MissingPrompt extends MissingTrace {
    async resolvePromptSelection() { return { promptTrace: { contentId: 'incomplete' } } }
  }
  class Complete extends ClaimedModel {
    async resolvePromptSelection({ docId, promptTemplateId, pinned } = {}) {
      const prompt = pinned?.prompt ?? await this.ctx.get('ivoraige.prompts').resolve({ ...TRANSLATION_FEATURE,
        configurationId: 'fixture-connection', docId, templateId: promptTemplateId })
      return { prompt, promptTrace: pinned?.promptTrace ?? {
        templateId: prompt.template.id, version: prompt.template.version, contentId: prompt.contentId,
        source: prompt.source, pluginId: prompt.pluginId, featureId: prompt.featureId,
        configurationId: prompt.configurationId, protocolVersion: 'fixture-v1',
      } }
    }
    async preflight({ basis }) {
      preflights++
      assert.equal(basis.termConstraintSetId, 'none')
    }
  }
  const run = async () => {
    const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh' })
    return app.tasks.wait(taskId)
  }
  const incompletePreflight = await app.ctx.plugin(PreflightOnly)
  const first = await run()
  assert.equal(first.state, 'failed')
  assert.match(first.error.message, /prompt contract requires selection and preflight/)
  assert.equal(first.stats.llmCalls, 0)
  assert.equal(preflights, 0)
  await incompletePreflight.dispose()
  const incompleteSelection = await app.ctx.plugin(SelectionOnly)
  const second = await run()
  assert.equal(second.state, 'failed')
  assert.match(second.error.message, /prompt contract requires selection and preflight/)
  assert.equal(second.stats.llmCalls, 0)
  await incompleteSelection.dispose()
  const incompleteTrace = await app.ctx.plugin(MissingTrace)
  const noTrace = await run()
  assert.equal(noTrace.state, 'failed')
  assert.match(noTrace.error.message, /did not resolve the prompt template/)
  assert.equal(noTrace.stats.llmCalls, 0)
  assert.equal(preflights, 0)
  assert.equal(noTrace.promptSelection, undefined)
  await incompleteTrace.dispose()
  const incompletePrompt = await app.ctx.plugin(MissingPrompt)
  const noPrompt = await run()
  assert.equal(noPrompt.state, 'failed')
  assert.match(noPrompt.error.message, /did not resolve the prompt template/)
  assert.equal(noPrompt.stats.llmCalls, 0)
  assert.equal(noPrompt.promptSelection, undefined)
  await incompletePrompt.dispose()
  await app.ctx.plugin(Complete)
  const third = await run()
  assert.equal(third.state, 'succeeded', JSON.stringify(third.error))
  assert.equal(third.stats.llmCalls, 1)
  assert.equal(calls, 1)
  assert.equal(preflights, 1)
  assert.equal(third.promptSelection.promptTrace.templateId, 'builtin:scientific-translation')
  const [unit] = app.records.listUnits(document.id, { targetLang: 'zh' })
  const [revision] = app.records.listRevisions(unit.id, { targetLang: 'zh' })
  assert.equal(revision.promptTrace.templateId, 'builtin:scientific-translation')
})

test('unconfigured prompt-aware model reuses a human revision but cannot create an untraced machine revision', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-unconfigured-prompt-model-'))
  const app = await createApp({ store: join(directory, 'store.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  let calls = 0, preflights = 0, selections = 0
  class UnconfiguredModel extends Service {
    constructor(ctx) {
      super(ctx, 'ivoraige.translationModel')
      ctx.effect(() => ctx.get('ivoraige.prompts').register(TRANSLATION_FEATURE))
    }
    configuration() { return null }
    async resolvePromptSelection() { selections++; return undefined }
    async preflight() { preflights++ }
    async translate() {
      calls++
      return { text: '模型译文。', modelId: 'fixture', promptVersion: 'fixture-v1',
        tokens: { input: null, output: null } }
    }
  }
  await app.ctx.plugin(UnconfiguredModel)
  const { document: reusedDocument } = await app.records.importDocument({ format: 'txt', content: 'Reviewed.' },
    { sourceId: 'reviewed', language: 'en' })
  const [reusedUnit] = app.records.listUnits(reusedDocument.id, { targetLang: 'zh' })
  const human = await app.records.writeRevision(reusedUnit.id, { targetLang: 'zh', text: '人工译文。',
    baseRevisionId: null, origin: 'human' })
  await app.records.acceptRevision(human.id, { expectedAcceptedRevisionId: null })
  const first = await app.tasks.submit(reusedDocument.id, { targetLang: 'zh' })
  const reused = await app.tasks.wait(first.taskId)
  assert.equal(reused.state, 'succeeded', JSON.stringify(reused.error))
  assert.equal(reused.stats.reusedUnits, 1)
  assert.equal(reused.stats.llmCalls, 0)
  assert.equal(reused.promptSelection, undefined)
  const selected = await app.tasks.submit(reusedDocument.id, { targetLang: 'zh',
    promptTemplateId: 'builtin:scientific-translation' })
  const explicit = await app.tasks.wait(selected.taskId)
  assert.equal(explicit.state, 'failed')
  assert.match(explicit.error.message, /No translation model configured/)
  assert.equal(explicit.stats.llmCalls, 0)

  const { document: newDocument } = await app.records.importDocument({ format: 'txt', content: 'Needs model.' },
    { sourceId: 'needs-model', language: 'en' })
  const [newUnit] = app.records.listUnits(newDocument.id, { targetLang: 'zh' })
  const second = await app.tasks.submit(newDocument.id, { targetLang: 'zh' })
  const failed = await app.tasks.wait(second.taskId)
  assert.equal(failed.state, 'failed')
  assert.match(failed.error.message, /No translation model configured/)
  assert.equal(failed.stats.llmCalls, 0)
  assert.equal(app.records.listRevisions(newUnit.id, { targetLang: 'zh' }).length, 0)
  assert.equal(calls, 0)
  assert.equal(preflights, 0)
  assert.equal(selections, 0)
})
