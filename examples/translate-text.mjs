import { readFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createApp } from '../src/app.mjs'

// A kernel example, not the planned CLI protocol entry.
const [configFile, sourceFile, outputDir = 'evaluation/runs/translation', targetLang = 'zh', sourceLang = 'en'] = process.argv.slice(2)
if (!configFile || !sourceFile) {
  throw new Error('Usage: node examples/translate-text.mjs <config.json> <source.txt> [outputDir] [targetLang] [sourceLang]')
}
const root = resolve(outputDir)
await mkdir(root, { recursive: true })
const translation = JSON.parse(await readFile(resolve(configFile), 'utf8'))
const app = await createApp({ store: join(root, 'records.sqlite'), exportDir: join(root, 'exports'), translation })
try {
  const { document } = await app.records.importDocument({ path: resolve(sourceFile) }, { language: sourceLang })
  const unfinished = (await app.tasks.list({ docId: document.id })).find(task =>
    task.targetLang === targetLang && ['paused', 'failed'].includes(task.state))
  let taskId = unfinished?.id
  if (unfinished) await app.tasks.resume(taskId)
  else ({ taskId } = await app.tasks.submit(document.id, { targetLang, mode: 'fast' }))
  const task = await app.tasks.wait(taskId)
  console.log(JSON.stringify(task, null, 2))
  if (task.state !== 'succeeded') throw new Error(`Translation task ${task.id} ended in ${task.state}`)
  const exported = await app.exporter.exportDocument(document.id, {
    targetLang, outputs: [{ format: 'md' }, { format: 'json' }],
  })
  console.log(JSON.stringify(exported, null, 2))
} finally {
  await app.dispose()
}
