// Accept source-checked R03 page-1 revisions after the independent model run.
// This is an agent engineering review, not human scientific sign-off.
import { readFile, writeFile } from 'node:fs/promises'
import { createApp } from '../../src/app.mjs'
import { projectPdfText } from '../../src/records.mjs'
import { resolveBasis } from '../../src/terms.mjs'

const root = new URL('../../', import.meta.url)
const path = name => new URL(name, root)
const snapshot = JSON.parse(await readFile(path('evaluation/runs/m3-2/r03-source-snapshot.json')))
const draft = JSON.parse(await readFile(path('evaluation/runs/m3-3/page1-draft.json')))
const suffix = snapshot.uncalled_paragraphs.find(item => item.pdf_page === 1 && item.prepared_input === 'e')
if (!suffix) throw new Error('Expected source-bound email suffix is absent')
const app = await createApp({ store: new URL('evaluation/runs/m3-3/store', root).pathname.replace(/^\/(?=[A-Z]:)/, '') })
try {
  const documentId = 'R03-p1'
  await app.records.pairPdfUncalledSuffix(documentId, 'R03-M3-2-p01-u011', {
    fragment: 'e', key: suffix.key,
    reason: 'Original email final letter is a separate, uncalled BabelDOC paragraph; preserve both fragments.',
  })
  const result = []
  for (const item of draft.units) {
    const doc = app.records.getDocument(documentId)
    const unit = doc.units.find(value => value.id === item.unit_id)
    if (!unit) throw new Error(`Unknown source unit ${item.unit_id}`)
    const readable = projectPdfText(item.engine_projection, unit.placeholders, unit.placeholderDisplay) + (unit.pdfUncalledSuffix?.fragment ?? '')
    if (item.unit_id !== 'R03-M3-2-p01-u002' && readable !== item.readable_target) throw new Error(`Readable draft differs for ${item.unit_id}`)
    const { basis } = resolveBasis(app.records, app.terms, documentId, unit.id)
    const priorDraft = unit.revisions.find(revision => revision.status === 'draft')
    const sourceDraft = priorDraft ?? await app.records.saveDraft(documentId, unit.id, {
      text: item.engine_projection, basis,
      provenance: { kind: 'agent-source-reviewed-draft', modelAttempt: 'local hy-mt2-1.8b; invalid placeholder outputs rejected' },
      finish: { kind: 'stop' },
    })
    const accepted = await app.records.accept(documentId, unit.id, sourceDraft.id, basis, {
      expectedAcceptedId: null, actor: 'agent-engineering-review', text: item.engine_projection,
    })
    result.push({ unitId: unit.id, modelDraft: !!priorDraft, revisionId: accepted.id, decision: item.decision, reason: item.reason ?? item.note ?? null })
  }
  const manifest = app.records.manifest(documentId)
  await writeFile(path('evaluation/runs/m3-3/acceptance.json'), JSON.stringify({ status: 'agent_engineering_accepted_not_human_scientific_signoff', units: result }, null, 2) + '\n')
  await writeFile(path('evaluation/runs/m3-3/frozen-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Accepted ${result.length} source-bound units; document revision ${manifest.documentRevision}`)
} finally { await app.dispose() }
