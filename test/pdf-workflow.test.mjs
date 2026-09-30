import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { projectPdfText } from '../src/records.mjs'
import { resolveBasis } from '../src/terms.mjs'

const snapshot = { snapshot_id: 'fixed-capture', document_id: 'sample', source_pdf: 'sample.pdf', source_revision: 1,
  capture_config: { babeldoc: '0.6.4', min_text_length: 5 }, units: [{ unit_id: 'u1', pdf_page: 1,
    kind: 'body', source_unicode: 'Field B', request_text: 'Field <b1>',
    placeholders: [{ type: 'formula', placeholder: '<b1>', formula_chars: 'B' }],
    source_binding: { key: 'p0:1.000,2.000,3.000,4.000', box_pdf_bottom_left_xyxy: [1, 2, 3, 4] } }] }

test('PDF accepts one revision for readable and engine projections, then rejects stale or broken structure', async () => {
  const store = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-'))
  const app = await createApp({ store })
  try {
    await app.records.importPdfSnapshot(snapshot, { documentId: 'pdf', pages: [1] })
    const basis = resolveBasis(app.records, app.terms, 'pdf', 'u1').basis
    await assert.rejects(app.records.saveDraft('pdf', 'u1', { text: '场 <b2>', basis, finish: { kind: 'stop' } }), /placeholder mismatch/)
    const draft = await app.records.saveDraft('pdf', 'u1', { text: '场 <b1>', basis, finish: { kind: 'stop' } })
    const accepted = await app.records.accept('pdf', 'u1', draft.id, basis, { expectedAcceptedId: null, actor: 'agent-engineering-review' })
    const manifest = app.records.manifest('pdf')
    assert.equal(manifest.units[0].revisionId, accepted.id)
    assert.equal(manifest.units[0].engineProjection, '场 <b1>')
    assert.equal(manifest.units[0].text, '场 B')
    assert.deepEqual(manifest.units[0].placeholderDisplay, ['B'])
    await app.records.updateSource('pdf', 'u1', 'Corrected field <b1>')
    assert.throws(() => app.records.manifest('pdf'), /Missing applicable accepted revision/)
    assert.throws(() => projectPdfText('场 <b1><b1>', snapshot.units[0].placeholders), /placeholder mismatch/)
    assert.throws(() => projectPdfText('场 <b1', snapshot.units[0].placeholders), /placeholder mismatch|Malformed/)
  } finally { await app.dispose(); await rm(store, { recursive: true, force: true }) }
})

test('source-justified placeholder reorder keeps token identity and readable symbols', () => {
  const placeholders = [
    { placeholder: '<b1>', formula_chars: 'γ' },
    { placeholder: '<b2>', formula_chars: '矢量 ' },
  ]
  assert.throws(() => projectPdfText('先 <b2>B，后 <b1>', placeholders), /placeholder mismatch/)
  assert.equal(projectPdfText('先 <b2>B，后 <b1>', placeholders, ['γ_LL', '矢量 '], ['<b2>', '<b1>']), '先 矢量 B，后 γ_LL')
  assert.throws(() => projectPdfText('先 <b2>B，后 <b1>', placeholders, ['γ', '矢量 '], ['<b2>', '<b2>']), /Invalid PDF placeholder order/)
})
