// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

const PLACEHOLDER_PATTERN = /<\/?(?:b|i|u|s|f)\d+>/g

export function extractPdfPlaceholders(text) {
  if (typeof text !== 'string' || !text) return []
  return text.match(PLACEHOLDER_PATTERN) ?? []
}

export function validatePdfPlaceholders(sourceText, candidateText) {
  const required = extractPdfPlaceholders(sourceText)
  if (!required.length) {
    return {
      required,
      actual: [],
      valid: true,
      missing: [],
      extra: [],
      orderMismatch: false,
      message: '',
    }
  }
  const actual = extractPdfPlaceholders(candidateText)
  const valid =
    required.length === actual.length &&
    required.every((token, index) => token === actual[index])

  if (valid) {
    return {
      required,
      actual,
      valid: true,
      missing: [],
      extra: [],
      orderMismatch: false,
      message: `占位符完整 (${required.length}/${required.length})`,
    }
  }

  const remainingActual = [...actual]
  const missing = []
  for (const token of required) {
    const idx = remainingActual.indexOf(token)
    if (idx === -1) missing.push(token)
    else remainingActual.splice(idx, 1)
  }
  const extra = remainingActual
  const orderMismatch = !missing.length && !extra.length

  const parts = []
  if (missing.length) parts.push(`缺少 ${missing.join(' ')}`)
  if (extra.length) parts.push(`多余 ${extra.join(' ')}`)
  if (orderMismatch) parts.push(`顺序不符（应为 ${required.join(' ')}）`)

  return {
    required,
    actual,
    valid: false,
    missing,
    extra,
    orderMismatch,
    message: parts.join('；'),
  }
}

export function insertAtSelection(text, selectionStart, selectionEnd, token) {
  const value = String(text ?? '')
  const start = Math.max(0, Math.min(value.length, Number.isInteger(selectionStart) ? selectionStart : value.length))
  const end = Math.max(start, Math.min(value.length, Number.isInteger(selectionEnd) ? selectionEnd : start))
  const nextText = value.slice(0, start) + token + value.slice(end)
  const cursor = start + token.length
  return { text: nextText, cursor }
}

export function unitTranslationStatus(unit) {
  if (!unit?.translatable) return 'non-translatable'
  if (unit.acceptedRevisionId) return 'accepted'
  if (unit.currentDraftRevisionId) return 'draft'
  return 'untranslated'
}

export function filterWorkbenchUnits(units, { filter = 'all', query = '' } = {}) {
  const list = Array.isArray(units) ? units : []
  const trimmed = String(query ?? '').trim()
  const pageMatch = trimmed.match(/^p(?:age)?:\s*(\d+)$/i)
  const indexMatch = trimmed.match(/^#(\d+)$/)
  const needle = trimmed.toLowerCase()

  return list.filter(unit => {
    const status = unitTranslationStatus(unit)
    if (filter !== 'all' && status !== filter) return false
    if (!trimmed) return true
    if (pageMatch) return Number(unit.locator?.page) === Number(pageMatch[1])
    if (indexMatch) return unit.order + 1 === Number(indexMatch[1])
    const source = String(unit.sourceText ?? '').toLowerCase()
    const kind = String(unit.kind ?? '').toLowerCase()
    return (
      source.includes(needle) ||
      kind.includes(needle) ||
      String(unit.order + 1) === needle
    )
  })
}

const DIFF_TOKEN_PATTERN = /(<\/?(?:b|i|u|s|f)\d+>|\s+|[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s])/g

function tokenizeForDiff(text) {
  if (typeof text !== 'string' || !text) return []
  return text.match(DIFF_TOKEN_PATTERN) ?? []
}

export function computeWordDiff(baseText, targetText) {
  const a = tokenizeForDiff(baseText)
  const b = tokenizeForDiff(targetText)
  if (!a.length && !b.length) return []
  if (!a.length) return [{ type: 'add', text: b.join('') }]
  if (!b.length) return [{ type: 'del', text: a.join('') }]
  if (a.length * b.length > 40_000) {
    return baseText === targetText
      ? [{ type: 'same', text: targetText }]
      : [
          { type: 'del', text: baseText },
          { type: 'add', text: targetText },
        ]
  }

  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const raw = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'del', text: a[i++] })
    } else {
      raw.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < n) raw.push({ type: 'del', text: a[i++] })
  while (j < m) raw.push({ type: 'add', text: b[j++] })

  const merged = []
  for (const item of raw) {
    const last = merged[merged.length - 1]
    if (last && last.type === item.type) last.text += item.text
    else merged.push({ ...item })
  }
  return merged
}
