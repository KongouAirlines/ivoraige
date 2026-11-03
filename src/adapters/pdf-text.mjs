// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { KernelError } from '../errors.mjs'

export const placeholderTokens = text => {
  if (typeof text !== 'string') {
    throw new KernelError('PRECONDITION_FAILED', 'PDF source and translation text must be strings')
  }
  return text.match(/<\/?(?:b|i|u|s|f)\d+>/g) ?? []
}

export function validatePdfTranslation(binding, unit, text) {
  const record = binding.records?.[unit.order]
  if (!record || record.order !== unit.order || record.requestText !== unit.sourceText) {
    throw new KernelError('PRECONDITION_FAILED', 'PDF source binding does not match this unit')
  }
  const expected = placeholderTokens(unit.sourceText)
  const actual = placeholderTokens(text)
  if (expected.length !== actual.length || expected.some((token, index) => token !== actual[index])) {
    throw new KernelError('PRECONDITION_FAILED', 'Preserve PDF placeholders exactly, in their original order',
      { unitId: unit.id, expected })
  }
}

export function readablePdfText(binding, unit, text) {
  const record = binding.records[unit.order]
  if (!record) throw new KernelError('PRECONDITION_FAILED', 'PDF source binding is incomplete')
  let index = 0
  return text.replace(/<\/?(?:b|i|u|s|f)\d+>/g, token => {
    const replacement = record.placeholders?.[index++]
    if (replacement?.token === token && typeof replacement.text === 'string') return replacement.text
    // Older bindings may lack display metadata. Preserve the engine token
    // rather than dropping source content or blocking every output format.
    const payload = record.placeholderPayloads?.find(item => item.type === 'formula' && item.placeholder === token)
    return typeof payload?.formula_chars === 'string' ? payload.formula_chars : token
  })
}

// PDF capture records a heading kind, but does not record a reliable depth.
// Escape extracted text as literal prose so Markdown and HTML syntax cannot
// hide identifiers, formulas, or older bindings' unresolved placeholders.
const escapePdfMarkdown = value => value.replace(/\r\n?/g, '\n')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_{}\[\]()#+!|~-]/g, '\\$&')
  .replace(/^=+(?=\s*$)/gm, value => `\\${value}`)
  .replace(/^(\s{0,3}\d+)\./gm, '$1\\.')
  .replace(/^( {4,}|\t+)/gm, spaces => [...spaces].map(char => char === '\t' ? '&#9;' : '&#32;').join(''))

export function renderPdfMarkdown({ sourceBinding, snapshot, document, units }) {
  if (sourceBinding?.adapterId !== 'babeldoc' || !Array.isArray(units)) {
    throw new KernelError('PRECONDITION_FAILED', 'Frozen PDF source binding is unavailable')
  }
  const title = escapePdfMarkdown(document.title.replace(/[\r\n]+/g, ' '))
  const paragraphs = units.map(({ unit, text }) => {
    const readable = readablePdfText(sourceBinding, unit, text)
    const prose = escapePdfMarkdown(unit.kind === 'heading' ? readable.replace(/[\r\n]+/g, ' ') : readable)
    return unit.kind === 'heading' && prose ? `## ${prose}` : prose
  })
  return `<!-- ivoraige snapshot:${snapshot.id} revisions:${snapshot.revisionSetHash} -->\n\n` +
    `# ${title}\n\n${paragraphs.join('\n\n')}\n`
}
