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
  const sourceRevision = digest({ text: unit.sourceText, kind: unit.kind, locator: unit.locator ?? null,
    binding: document.sourceBinding })
  const basis = {
    sourceRevision,
    sourceBinding: document.sourceBinding,
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
export function sameBasis(a, b) { return isDeepStrictEqual(a, b) }
