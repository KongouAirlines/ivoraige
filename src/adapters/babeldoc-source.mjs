
const copy = value => structuredClone(value)
const tokens = text => text.match(/<\/?b\d+>/g) ?? []

export function projectBabeldocText(text, placeholders = [], display = placeholders.map(item => item.formula_chars), order) {
  const expected = placeholders.flatMap(item => tokens(item.placeholder))
  const approved = order ?? expected
  if (approved.length !== expected.length || [...approved].sort().join('\0') !== [...expected].sort().join('\0')) throw new Error('Invalid PDF placeholder order correction')
  const actual = tokens(text)
  if (JSON.stringify(actual) !== JSON.stringify(approved)) throw new Error(`PDF placeholder mismatch: expected ${approved.join(' ')}; got ${actual.join(' ')}`)
  if (/<\/?b/.test(text.replace(/<\/?b\d+>/g, ''))) throw new Error('Malformed PDF placeholder')
  if (display.length !== expected.length || display.some(value => typeof value !== 'string' || !value.length)) throw new Error('Missing PDF placeholder display text')
  const byToken = new Map(expected.map((token, index) => [token, display[index]]))
  return text.replace(/<\/?b\d+>/g, token => byToken.get(token))
}

export const babeldoc = {
  id: 'babeldoc',
  acceptsLegacy(document) { return !!document.pdfSource },
  legacyBinding(document) { return { provider: this.id, ...document.pdfSource } },
  parse(snapshot, { documentId, pages, title = 'PDF translation', libraries = [] } = {}) {
    if (!snapshot?.snapshot_id || !Array.isArray(snapshot.units) || !Array.isArray(pages) || !pages.length) throw new Error('PDF snapshot and selected pages are required')
    const selected = snapshot.units.filter(unit => pages.includes(unit.pdf_page))
    if (!selected.length || selected.some(unit => !unit.unit_id || !unit.request_text || !unit.source_binding?.key)) throw new Error('PDF snapshot has no valid selected units')
    for (const unit of selected) projectBabeldocText(unit.request_text, unit.placeholders)
    return { id: documentId ?? `${snapshot.document_id}-${pages.join('-')}`, title, sourceLanguage: 'en', targetLanguage: 'zh', libraries,
      sourceBinding: { provider: this.id, snapshotId: snapshot.snapshot_id, sourcePdf: snapshot.source_pdf, sourceSha256: snapshot.source_sha256_from_import_manifest, sourceRevision: snapshot.source_revision, captureConfig: copy(snapshot.capture_config), pages: [...pages] },
      units: selected.map(unit => ({ id: unit.unit_id, location: { pdfPage: unit.pdf_page, key: unit.source_binding.key }, text: unit.request_text, requestText: unit.request_text, sourceUnicode: unit.source_unicode, sourceRevision: snapshot.source_revision, sourceBinding: copy(unit.source_binding), placeholders: copy(unit.placeholders), placeholderDisplay: unit.placeholders.map(item => item.formula_chars), kind: unit.kind })) }
  },
  project(unit, text) { return projectBabeldocText(text, unit.placeholders, unit.placeholderDisplay ?? unit.placeholders.map(item => item.formula_chars), unit.placeholderOrder) },
  manifestUnit(unit, revision) {
    return { source: unit.requestText, correctedSource: unit.text, engineProjection: revision.text, placeholderDisplay: unit.placeholderDisplay ?? unit.placeholders.map(item => item.formula_chars), placeholderOrder: unit.placeholderOrder, placeholderOrderReason: unit.placeholderOrderReason, placeholders: unit.placeholders, pdfUncalledSuffix: unit.pdfUncalledSuffix, pdfSourceRegionRestoration: unit.pdfSourceRegionRestoration, pdfFieldLabel: unit.pdfFieldLabel, sourceUnicode: unit.sourceUnicode, sourceBinding: unit.sourceBinding, kind: unit.kind }
  },
  manifestDocument(document, binding) { return { pdfSource: document.pdfSource ?? binding } },
  readable(unit, revision) { return this.project(unit, revision.text) + (unit.pdfUncalledSuffix?.fragment ?? '') },
  structureHint(unit) { return unit.placeholders?.length ? 'Preserve every <bN> or </bN> placeholder exactly once, in the same order; these encode PDF formula or style structure. Do not translate or change placeholder tokens.' : '' },
  correct(unit, action, payload) {
    if (action === 'display') { this.project({ ...unit, placeholderDisplay: payload }, unit.text); unit.placeholderDisplay = copy(payload) }
    else if (action === 'order') { const { sourceText, order, reason } = payload; if (!reason?.trim()) throw new Error('PDF placeholder order correction needs a source reason'); this.project({ ...unit, placeholderOrder: order }, sourceText); unit.text = sourceText; unit.placeholderOrder = copy(order); unit.placeholderOrderReason = reason }
    else if (action === 'suffix') { const { fragment, key, reason } = payload; if (![fragment, key, reason].every(v => typeof v === 'string' && v)) throw new Error('PDF suffix pairing requires fragment, source key and reason'); unit.pdfUncalledSuffix = { fragment, key, reason } }
    else if (action === 'region') { if (!payload?.trim()) throw new Error('PDF source region restoration needs a reason'); unit.pdfSourceRegionRestoration = payload }
    else if (action === 'field') { const { label, reason } = payload; if (!label?.trim() || !reason?.trim()) throw new Error('PDF field label needs translated text and a reason'); if (unit.kind !== 'field_list_item') throw new Error('Unknown PDF field item'); unit.pdfFieldLabel = { text: label, reason }; unit.pdfSourceRegionRestoration = null }
    else throw new Error(`Unknown source correction: ${action}`)
  },
}
