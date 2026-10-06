import { resolve, join } from 'node:path'
import { createApp } from '../src/app.mjs'

// Project-original fixture with an explicitly supplied translation; no model is used.
const directory = resolve(process.argv[2] ?? 'evaluation/runs/text-records')
const app = await createApp({ store: join(directory, 'records.sqlite'), exportDir: join(directory, 'exports') })
try {
  const { document, deduplicated } = await app.records.importDocument({
    format: 'txt', title: 'Text records example', content: 'The signal was measured twice.',
  }, { sourceId: 'example:measured-twice', language: 'en' })
  const [unit] = app.records.listUnits(document.id, { targetLang: 'zh' })
  const { accepted, draft } = app.records.getUnit(unit.id, { targetLang: 'zh' })
  if (!accepted) {
    const revision = await app.records.writeRevision(unit.id, {
      targetLang: 'zh', text: '该信号测量了两次。', origin: 'imported', baseRevisionId: draft?.id ?? null,
    })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  const exported = await app.exporter.exportDocument(document.id, {
    targetLang: 'zh', outputs: [{ format: 'md' }, { format: 'json' }],
  })
  console.log(JSON.stringify({ documentId: document.id, deduplicated, ...exported }, null, 2))
} finally {
  await app.dispose()
}
