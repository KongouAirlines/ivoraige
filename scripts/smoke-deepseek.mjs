// Explicit opt-in live API check: at most three initial translation units.
// Credentials are resolved by DSH; never include their values in the report.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createApp } from '../src/app.mjs'

const translation = JSON.parse(await readFile(new URL('../examples/translation-deepseek.json', import.meta.url), 'utf8'))
const root = resolve(process.argv[2] ?? 'evaluation/runs/deepseek-restart')
await mkdir(root, { recursive: true })
const store = join(root, 'records.sqlite')
const cases = [
  { id: 'original-en', sourceLang: 'en', targetLang: 'zh', text:
    'At a temperature of 300 K, the normalized signal increased from 0.12 to 0.18 when the applied magnetic field changed from 10 mT to 20 mT. These measurements do not establish a causal relationship.\n\n' +
    'For the model y = a x + b, the fitted slope was a = 1.5 ± 0.2. The uncertainty denotes one standard deviation, not a 95% confidence interval.' },
  { id: 'original-zh', sourceLang: 'zh', targetLang: 'en', text:
    '在相同边界条件下，我们比较了两组数值模拟。网格间距由 4 nm 减小到 2 nm 后，共振频率的相对变化小于 1%；这一结果支持该观测量的网格收敛性，但不能证明模型适用于所有样品。' },
]
let app
let calls = 0
const report = { model: translation.model, endpoint: translation.providers[translation.provider].baseURL,
  createdAt: new Date().toISOString(), samples: [], reuse: [], modelCalls: 0 }
async function open() {
  app = await createApp({ store, exportDir: join(root, 'exports'), translation })
  app.ctx.on('llm/stream', async function* (options, next) { calls++; yield* next() })
}
try {
  await open()
  for (const sample of cases) {
    const { document } = await app.records.importDocument({ format: 'txt', content: sample.text },
      { sourceId: `deepseek-smoke:${sample.id}:v1`, language: sample.sourceLang })
    const { taskId } = await app.tasks.submit(document.id, { targetLang: sample.targetLang, mode: 'fast' })
    const task = await app.tasks.wait(taskId)
    report.samples.push({ id: sample.id, documentId: document.id, source: sample.text, targetLang: sample.targetLang, task })
    assert.equal(task.state, 'succeeded', JSON.stringify(task.error))
    const before = calls
    const output = await app.exporter.exportDocument(document.id,
      { targetLang: sample.targetLang, outputs: [{ format: 'md' }, { format: 'json' }] })
    assert.equal(calls, before, 'Export must not invoke the model')
    assert.equal(output.artifacts[0].snapshotId, output.artifacts[1].snapshotId)
    const json = JSON.parse(await readFile(output.artifacts[1].path, 'utf8'))
    Object.assign(report.samples.at(-1), { output, translations: json.units.map(unit => unit.text) })
  }
  const initialCalls = calls
  await app.dispose(); app = undefined
  await open()
  for (const sample of report.samples) {
    const { taskId } = await app.tasks.submit(sample.documentId, { targetLang: sample.targetLang })
    const task = await app.tasks.wait(taskId)
    assert.equal(task.state, 'succeeded')
    assert.equal(task.stats.llmCalls, 0)
    assert.equal(task.stats.reusedUnits, task.progress.total)
    report.reuse.push(task)
  }
  assert.equal(calls, initialCalls, 'Restart and reuse must not invoke the model')
  report.passed = true
} finally {
  if (app) await app.dispose()
  report.modelCalls = calls
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed ?? false, modelCalls: calls, report: join(root, 'report.json') }))
}
