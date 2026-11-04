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
const escapePdfLiteral = value => value.replace(/\r\n?/g, '\n')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_{}\[\]()#+!|~-]/g, '\\$&')
  .replace(/^( {0,4})(=+)(?=[ \t]*$)/gm, (_, indent, equals) => `${indent}\\${equals}`)
  .replace(/^(\s{0,3}\d+)\./gm, '$1\\.')
  .replace(/^[ \t]+/gm, spaces => [...spaces].map(char => char === '\t' ? '&#9;' : '&#32;').join(''))

// Keep link labels and destinations separate: GFM bare-URL parsing otherwise
// treats prose backslash escapes and HTML entities as part of the address.
const pdfLinks = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>]+|(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w-])/gi
function escapePdfMarkdown(value) {
  let result = '', cursor = 0
  for (const match of value.matchAll(pdfLinks)) {
    const raw = match[0]
    let link = raw
    // Sentence punctuation and unmatched enclosing brackets stay literal prose.
    const excess = { ')': 0, ']': 0 }
    const entityEnds = new Set([...link.matchAll(/&[A-Za-z0-9]+;/g)]
      .map(entity => entity.index + entity[0].length - 1))
    for (const char of link) {
      if (char === '(') excess[')']--
      else if (char === '[') excess[']']--
      else if (char === ')' || char === ']') excess[char]++
    }
    let end = link.length
    while (end) {
      const char = link[end - 1]
      if (char === ';' && entityEnds.has(end - 1)) break
      if (/[.!?,:;"']/.test(char)) end--
      else if ((char === ')' || char === ']') && excess[char] > 0) {
        excess[char]--
        end--
      } else break
    }
    link = link.slice(0, end)
    const destination = /^www\./i.test(link) ? `http://${link}`
      : /^(?:https?|ftp):\/\//i.test(link) ? link : `mailto:${link}`
    result += escapePdfLiteral(value.slice(cursor, match.index))
    if (link && URL.canParse(destination)) {
      const href = destination.replace(/&/g, '&amp;').replace(/\\/g, '\\\\')
      result += `[${escapePdfLiteral(link)}](<${href}>)`
      result += escapePdfLiteral(raw.slice(link.length))
    } else {
      // An invalid URL-shaped token is text, not an implicitly corrupted link.
      result += escapePdfLiteral(raw).replace(/:/g, '&#58;')
        .replace(/\./g, '&#46;').replace(/@/g, '&#64;')
    }
    cursor = match.index + raw.length
  }
  return result + escapePdfLiteral(value.slice(cursor))
}

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
