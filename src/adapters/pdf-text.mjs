import { KernelError } from '../errors.mjs'

export const placeholderTokens = text => text.match(/<\/?(?:b|i|u|s|f)\d+>/g) ?? []

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
    if (replacement?.token !== token || typeof replacement.text !== 'string') {
      throw new KernelError('PRECONDITION_FAILED', 'PDF placeholder display mapping is unavailable')
    }
    return replacement.text
  })
}
