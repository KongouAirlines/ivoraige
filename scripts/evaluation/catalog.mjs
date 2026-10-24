// SPDX-License-Identifier: LGPL-3.0-or-later
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import Ajv from 'ajv'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const schema = JSON.parse(await readFile(new URL('../../evaluation/catalog.schema.json', import.meta.url)))
const validate = new Ajv({ allErrors: true }).compile(schema)
export const inside = (root, file) => {
  const rel = relative(root, file)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

export async function catalogFile(root, path) {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) throw new Error('UNSAFE_CATALOG_PATH')
  const file = await realpath(resolve(root, path))
  if (!inside(await realpath(root), file)) throw new Error('UNSAFE_CATALOG_PATH')
  return file
}

export function validateManifest(manifest) {
  if (!validate(manifest)) throw new Error('INVALID_MANIFEST_SCHEMA')
  const ids = new Set()
  const hashes = new Map()
  for (const sample of manifest.samples) {
    if (ids.has(sample.id)) throw new Error('DUPLICATE_SAMPLE_ID')
    ids.add(sample.id)
    if (hashes.has(sample.sha256) && hashes.get(sample.sha256) !== sample.split) throw new Error('SPLIT_LEAKAGE')
    hashes.set(sample.sha256, sample.split)
    if ((sample.referencePath === null) !== (sample.referenceSha256 === null)) throw new Error('INVALID_REFERENCE_HASH')
    if (sample.validation.status === 'human-verified' && !sample.validation.reviewer?.trim()) throw new Error('MISSING_REVIEWER')
    if (manifest.visibility === 'synthetic' && sample.source.kind !== 'original-synthetic') throw new Error('NON_SYNTHETIC_PUBLIC_SAMPLE')
  }
  return manifest
}

// This tool has no provider or credentials route. Even an allowed sample cannot
// enable a remote operation without a separately implemented, reviewed executor.
export function assertUseAllowed(sample, mode = 'offline') {
  if (mode !== 'offline') throw new Error('EXTERNAL_EXECUTION_DISABLED')
  if (!sample.source.allowedUses.includes('offline-regression') ||
      sample.source.kind === 'permission-pending' || sample.validation.status === 'blocked') {
    throw new Error('SAMPLE_USE_NOT_AUTHORIZED')
  }
}

export async function loadCatalog(root, { split = 'dev', mode = 'offline' } = {}) {
  if (!['dev', 'heldout'].includes(split)) throw new Error('INVALID_SPLIT')
  if (mode !== 'offline') throw new Error('EXTERNAL_EXECUTION_DISABLED')
  root = await realpath(root)
  const bytes = await readFile(await catalogFile(root, 'manifest.json'))
  const manifest = validateManifest(JSON.parse(bytes))
  const selected = manifest.samples.filter(sample => sample.split === split)
  // Authorize the entire selected batch before opening any content/reference.
  for (const sample of selected) assertUseAllowed(sample, mode)
  const inputs = []
  for (const sample of selected) {
    const content = await readFile(await catalogFile(root, sample.path))
    if (sha256(content) !== sample.sha256) throw new Error('SOURCE_HASH_MISMATCH')
    await catalogFile(root, sample.source.licenseEvidence)
    let reference = null
    if (sample.referencePath !== null) {
      const bytes = await readFile(await catalogFile(root, sample.referencePath))
      if (sha256(bytes) !== sample.referenceSha256) throw new Error('REFERENCE_HASH_MISMATCH')
      reference = JSON.parse(bytes)
      if (!['agent-authored-pending-human', 'human-verified'].includes(reference.status) ||
          !Array.isArray(reference.texts) || !reference.texts.length ||
          !reference.texts.every(text => typeof text === 'string' && text.trim()) ||
          (reference.status === 'human-verified' && !reference.reviewer?.trim()) ||
          (reference.status === 'agent-authored-pending-human' && reference.reviewer !== null)) {
        throw new Error('INVALID_REFERENCE')
      }
    }
    inputs.push({ sample, content, reference })
  }
  return { manifest, manifestSha256: sha256(bytes), inputs }
}

export function compareReports(baseline, candidate) {
  if (baseline.schemaVersion !== 1 || candidate.schemaVersion !== 1 ||
      baseline.catalogId !== candidate.catalogId || baseline.split !== candidate.split ||
      baseline.mode !== 'offline' || candidate.mode !== 'offline') throw new Error('INCOMPARABLE_REPORTS')
  const before = new Map(baseline.results.map(row => [row.id, row]))
  const after = new Map(candidate.results.map(row => [row.id, row]))
  const rows = [...new Set([...before.keys(), ...after.keys()])].sort().map(id => {
    const a = before.get(id), b = after.get(id)
    let change = !a ? 'added' : !b ? 'removed' : 'unchanged'
    if (a && b) {
      if (a.sourceSha256 !== b.sourceSha256 || a.referenceSha256 !== b.referenceSha256) change = 'input-changed'
      else if (a.structure !== b.structure) change = b.structure === 'fail' ? 'regression' : 'status-changed'
      else if (JSON.stringify(a.fingerprints) !== JSON.stringify(b.fingerprints)) change = 'output-changed'
    }
    return { id, change, before: a?.structure ?? null, after: b?.structure ?? null,
      humanReview: { reviewer: null, category: null, severity: null, reason: null, correction: null, notes: '' } }
  })
  return { schemaVersion: 1, kind: 'offline-comparison', baselineCommit: baseline.project.commit,
    candidateCommit: candidate.project.commit, baselineManifest: baseline.manifestSha256,
    candidateManifest: candidate.manifestSha256, baselineApproval: { status: 'pending-human', reviewer: null, rationale: null }, rows }
}
