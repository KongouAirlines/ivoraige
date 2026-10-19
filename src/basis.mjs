// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

export function basisFor(document, unit, targetLang, constraints) {
  const sourceBindingDigest = document.sourceBindingDigest ?? digest(document.sourceBinding)
  const sourceKind = unit.kind
  const sourceLocator = unit.locator ?? null
  const sourceRevision = digest({ text: unit.sourceText, kind: sourceKind, locator: sourceLocator,
    bindingDigest: sourceBindingDigest })
  const basis = {
    sourceRevision,
    sourceBindingDigest,
    sourceKind,
    sourceLocator,
    sourceText: unit.sourceText,
    sourceLang: document.language,
    targetLang,
    effectiveContext: constraints.effectiveContext,
    effectiveTarget: constraints.effectiveTarget,
    termConstraintSetId: constraints.termConstraintSetId,
  }
  return { ...basis, reuseKey: digest({ sourceText: unit.sourceText.normalize('NFC'),
    sourceLang: document.language, targetLang, effectiveContext: basis.effectiveContext,
    effectiveTarget: basis.effectiveTarget, termConstraintSetId: basis.termConstraintSetId }) }
}

// Key lookup narrows candidates; compare the actual applicability fields afterwards.
export function sameBasis(a, b) {
  if (!a || !b) return false
  if (Object.hasOwn(a, 'sourceBinding') && Object.hasOwn(b, 'sourceBinding')) {
    return isDeepStrictEqual(a, b)
  }
  const legacy = Object.hasOwn(a, 'sourceBinding') ? a :
    Object.hasOwn(b, 'sourceBinding') ? b : null
  if (!legacy) return isDeepStrictEqual(a, b)
  const compact = legacy === a ? b : a
  if (!Object.hasOwn(compact, 'sourceBindingDigest') ||
      digest(legacy.sourceBinding) !== compact.sourceBindingDigest ||
      compact.sourceRevision !== digest({ text: compact.sourceText, kind: compact.sourceKind,
        locator: compact.sourceLocator, bindingDigest: compact.sourceBindingDigest }) ||
      legacy.sourceRevision !== digest({ text: compact.sourceText, kind: compact.sourceKind,
        locator: compact.sourceLocator, binding: legacy.sourceBinding })) return false
  const { sourceBinding, sourceRevision: oldRevision, ...common } = legacy
  const { sourceBindingDigest, sourceKind, sourceLocator, sourceRevision, ...newCommon } = compact
  return isDeepStrictEqual(common, newCommon)
}
