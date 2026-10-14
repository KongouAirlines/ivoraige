import assert from 'node:assert/strict'

export const PDF_EXPORT_FORMATS = ['pdf', 'md', 'json']

export function assertArtifactFormats(artifacts, expected = PDF_EXPORT_FORMATS) {
  assert.ok(Array.isArray(artifacts), 'Export artifacts must be an array')
  assert.deepEqual(
    artifacts.map(item => item.format).sort(),
    [...expected].sort(),
    `Expected exactly one artifact for each format: ${expected.join(', ')}`,
  )
}

export async function closeBestEffort(resources) {
  const errors = []
  for (const [name, close] of resources) {
    try { await close() } catch (error) { errors.push({ name, error }) }
  }
  return errors
}
