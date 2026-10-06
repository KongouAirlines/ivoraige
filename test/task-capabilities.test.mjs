import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { Exporter } from '../src/export.mjs'

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
  await [...app.ctx.registry.get(Exporter).fibers][0].dispose()
  const { taskId } = await app.tasks.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'json' }] })
  const failed = await app.tasks.wait(taskId)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.message, 'Install an export service before exporting')
})
