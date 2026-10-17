import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const PDF_EXPORT_FORMATS = ['pdf', 'md', 'json']

export async function listAllUnits(call, docId, targetLang) {
  const items = []
  let cursor
  do {
    const page = await call('units_list', { docId, targetLang, ...(cursor ? { cursor } : {}) })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

export async function createRunDirectory(parent) {
  const directory = resolve(parent)
  await mkdir(directory, { recursive: true })
  return mkdtemp(join(directory, 'run-'))
}

export function errorSummary(error) {
  return { name: error.name, message: error.message,
    ...(error instanceof AggregateError ? { causes: error.errors.map(item => ({ name: item.name, message: item.message })) } : {}) }
}

export async function writeAcceptanceReport(report, path, primaryError, write = writeFile) {
  try {
    await write(path, JSON.stringify(report, null, 2) + '\n')
    return primaryError
  } catch (writeError) {
    report.passed = false
    report.reportWriteError = errorSummary(writeError)
    if (!primaryError) report.error = errorSummary(writeError)
    return primaryError
      ? new AggregateError([primaryError, writeError], 'Acceptance failed and report could not be written')
      : writeError
  }
}

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
