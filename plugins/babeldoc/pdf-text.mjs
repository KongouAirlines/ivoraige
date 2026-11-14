// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { domainToASCII } from 'node:url'
import { KernelError } from './errors.mjs'

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
  .replace(/^(\s{0,3}\d+)\./gm, '$1&#46;')
  .replace(/^[ \t]+/gm, spaces => [...spaces].map(char => char === '\t' ? '&#9;' : '&#32;').join(''))
  // Only the explicit email candidates below may become links. Otherwise GFM
  // can link a shorter address after an escaped suffix (example.com\_x).
  .replace(/@/g, '&#64;')

// Keep link labels and destinations separate: GFM bare-URL parsing otherwise
// treats prose backslash escapes and HTML entities as part of the address.
const pdfUrls = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>]+/gi
// Collect whole prose tokens before validating email syntax. A failed domain
// must never let a regex backtrack to an earlier label or a second mailbox.
// ASCII prose delimiters and Unicode punctuation separate tokens, except for
// dot-atom punctuation, single quotes, and IDNA fullwidth dot variants.
const pdfEmailTokens = /(?:[^\s<>()\[\]",;:\p{P}]|[.!#$%&'*+\/=?^_`{|}~@‘’\-．｡])+/gu
// A quoted local part can contain whitespace, @, or URL-shaped text. Consume
// its complete envelope before ordinary prose tokens, then reject the unsupported
// syntax as a whole rather than linking anything inside the quotes.
const pdfQuotedEmails = /"(?:[^"\\]|\\.)*"@[^\s<>()\[\]",;:]*/gu
const emailAtom = /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*$/
function pdfEmail(raw, following) {
  const link = raw.replace(/[.!?'‘’]+$/u, '')
  let prefix = '', address = link
  // Pair straight/curly outer single quotes only across punctuation, never
  // across words or whitespace. Internal or unpaired ASCII apostrophes remain
  // mailbox data; unsupported Unicode local parts remain entirely plain text.
  if (/^['‘’]/u.test(address) && /^\p{P}*['‘’]/u.test(raw.slice(link.length) + following)) {
    prefix = address.match(/^['‘’]+/u)[0]
    address = address.slice(prefix.length)
  }
  const parts = address.split('@')
  if (parts.length !== 2) return null
  const [local, domain] = parts
  if (!emailAtom.test(local) || local.length > 64 ||
      !/^[\p{L}\p{N}\p{M}.-]+$/u.test(domain)) return null
  const ascii = domainToASCII(domain)
  const labels = ascii.split('.')
  if (ascii.length > 253 || local.length + ascii.length + 1 > 254 || labels.length < 2 ||
      !labels.every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) ||
      !/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i.test(labels.at(-1))) return null
  // Encode local-part URI delimiters as mailbox data, not mailto headers or
  // fragments. IDNA converts the domain only; visible spelling is untouched.
  const destination = `mailto:${encodeURIComponent(local)}@${ascii}`
  return { link: address, prefix, destination }
}
function escapePdfMarkdown(value) {
  let result = '', cursor = 0
  const candidates = [...value.matchAll(pdfQuotedEmails), ...value.matchAll(pdfUrls),
    ...[...value.matchAll(pdfEmailTokens)].filter(match => match[0].includes('@'))]
    .sort((a, b) => a.index - b.index)
  for (const match of candidates) {
    if (match.index < cursor) continue
    const raw = match[0]
    const kind = /^www\./i.test(raw) ? 'www'
      : /^(?:https?|ftp):\/\//i.test(raw) ? 'url' : 'email'
    const angleUrl = kind !== 'email' && value[match.index - 1] === '<' &&
      value[match.index + raw.length] === '>'
    if (kind === 'email') {
      const email = pdfEmail(raw, value.slice(match.index + raw.length))
      result += escapePdfLiteral(value.slice(cursor, match.index))
      if (email) {
        const { link, prefix, destination } = email
        result += escapePdfLiteral(prefix) + `[${escapePdfLiteral(link)}](<${destination}>)` +
          escapePdfLiteral(raw.slice(prefix.length + link.length))
      } else {
        // Suppress GFM www/URL fallback inside rejected email tokens too.
        result += escapePdfLiteral(raw).replace(/:/g, '&#58;').replace(/\./g, '&#46;')
      }
      cursor = match.index + raw.length
      continue
    }
    let link = raw
    // An explicit <URL> boundary keeps valid trailing address characters.
    // Bare links leave sentence punctuation and unmatched brackets as prose.
    const excess = { ')': 0, ']': 0 }
    const entityEnds = new Set([...link.matchAll(/&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);/g)]
      .map(entity => entity.index + entity[0].length - 1))
    for (const char of link) {
      if (char === '(') excess[')']--
      else if (char === '[') excess[']']--
      else if (char === ')' || char === ']') excess[char]++
    }
    let end = link.length
    while (!angleUrl && end) {
      const char = link[end - 1]
      if (char === ';' && entityEnds.has(end - 1)) break
      if (/[.!?,:;"']/.test(char)) end--
      else if ((char === ')' || char === ']') && excess[char] > 0) {
        excess[char]--
        end--
      } else break
    }
    link = link.slice(0, end)
    // Keep the original candidate kind after trimming; a broken www prefix
    // must not be reinterpreted as a mailbox such as mailto:www.
    const destination = kind === 'www' ? `http://${link}`
      : link
    const parsed = link ? URL.parse(destination) : null
    const hostname = parsed?.hostname.replace(/\.$/, '')
    const validWww = kind !== 'www' || (hostname?.startsWith('www.') &&
      hostname.split('.').every(label =>
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))
    result += escapePdfLiteral(value.slice(cursor, match.index))
    if (parsed && validWww) {
      const href = destination.replace(/&/g, '&amp;').replace(/\\/g, '\\\\')
        // Preserve IPv6 authority brackets through Markdown URI encoding. Path
        // brackets still receive the renderer's ordinary percent encoding.
        .replace(/^((?:https?|ftp):\/\/(?:[^/?#]*@)?)\[([^\]]+)\]/i,
          '$1&#91;$2&#93;')
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
  const title = escapePdfMarkdown(document.title.replace(/[\r\n\u2028\u2029]+/g, ' '))
  const paragraphs = units.map(({ unit, text }) => {
    const readable = readablePdfText(sourceBinding, unit, text)
    const prose = escapePdfMarkdown(unit.kind === 'heading' ? readable.replace(/[\r\n\u2028\u2029]+/g, ' ') : readable)
    return unit.kind === 'heading' && prose ? `## ${prose}` : prose
  })
  return `<!-- ivoraige snapshot:${snapshot.id} revisions:${snapshot.revisionSetHash} -->\n\n` +
    `# ${title}\n\n${paragraphs.join('\n\n')}\n`
}
