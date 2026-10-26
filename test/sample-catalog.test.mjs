// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertUseAllowed, catalogFile, compareReports, loadCatalog, validateManifest } from '../scripts/evaluation/catalog.mjs'

const catalog = new URL('../evaluation/catalog-0.1.x/', import.meta.url)
const cli = fileURLToPath(new URL('../scripts/evaluate-samples.mjs', import.meta.url))
const copy = value => structuredClone(value)

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-catalog-'))
  const root = join(directory, 'catalog')
  await cp(catalog, root, { recursive: true })
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, root, manifestPath: join(root, 'manifest.json') }
}

async function editManifest(path, update) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  update(manifest)
  await writeFile(path, JSON.stringify(manifest))
  return manifest
}

test('checked-in catalog loads 10 text and 2 PDF dev cases, plus 2 heldout text cases', async () => {
  const root = fileURLToPath(catalog)
  const dev = await loadCatalog(root)
  const heldout = await loadCatalog(root, { split: 'heldout' })
  assert.equal(dev.inputs.length, 12)
  assert.equal(dev.inputs.filter(({ sample }) => sample.format === 'pdf').length, 2)
  assert.equal(dev.inputs.filter(({ sample }) => ['txt', 'md'].includes(sample.format)).length, 10)
  assert.deepEqual(heldout.inputs.map(({ sample }) => sample.id), ['T11', 'T12'])
  assert.ok(dev.manifestSha256.match(/^[a-f0-9]{64}$/))
  assert.ok(dev.inputs.filter(({ sample }) => sample.referencePath !== null)
    .every(({ reference }) => reference?.status === 'agent-authored-pending-human' && reference.reviewer === null))
})

test('manifest validation rejects schema errors, duplicate IDs and cross-split source leakage', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', catalog), 'utf8'))
  assert.throws(() => validateManifest({ ...manifest, schemaVersion: 2 }), /INVALID_MANIFEST_SCHEMA/)
  const duplicate = copy(manifest)
  duplicate.samples[1].id = duplicate.samples[0].id
  assert.throws(() => validateManifest(duplicate), /DUPLICATE_SAMPLE_ID/)
  const reserved = copy(manifest)
  reserved.samples[0].id = 'G01'
  assert.throws(() => validateManifest(reserved), /RESERVED_SAMPLE_ID/)
  const leaked = copy(manifest)
  leaked.samples.find(sample => sample.split === 'heldout').sha256 = leaked.samples[0].sha256
  assert.throws(() => validateManifest(leaked), /SPLIT_LEAKAGE/)
})

test('source and reference tampering fail their hash checks', async t => {
  const source = await fixture(t)
  await writeFile(join(source.root, 'inputs/T01.txt'), 'tampered input')
  await assert.rejects(loadCatalog(source.root), /SOURCE_HASH_MISMATCH/)

  const reference = await fixture(t)
  await writeFile(join(reference.root, 'references/T01.json'), '{"texts":["tampered"]}')
  await assert.rejects(loadCatalog(reference.root), /REFERENCE_HASH_MISMATCH/)
})

test('non-offline mode is denied before probing a nonexistent catalog root', async () => {
  await assert.rejects(loadCatalog('/no-such-ivoraige-catalog-root', { mode: 'external' }),
    /EXTERNAL_EXECUTION_DISABLED/)
})

test('permission-pending sample is denied before opening its missing input', async t => {
  const { root, manifestPath } = await fixture(t)
  await editManifest(manifestPath, manifest => {
    manifest.visibility = 'private'
    manifest.samples[0].source.kind = 'permission-pending'
    manifest.samples[0].path = 'inputs/missing.txt'
  })
  await assert.rejects(loadCatalog(root), /SAMPLE_USE_NOT_AUTHORIZED/)
  const sample = JSON.parse(await readFile(manifestPath, 'utf8')).samples[0]
  assert.throws(() => assertUseAllowed(sample), /SAMPLE_USE_NOT_AUTHORIZED/)
  assert.throws(() => assertUseAllowed(sample, 'external'), /EXTERNAL_EXECUTION_DISABLED/)
})

test('catalogFile rejects traversal, absolute paths, and symlinks escaping the root', async t => {
  const { directory, root } = await fixture(t)
  const outsideDir = join(directory, 'outside')
  await mkdir(outsideDir)
  const outside = join(outsideDir, 'outside.txt')
  await writeFile(outside, 'private')
  await symlink(outsideDir, join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const unsafe of ['../outside.txt', outside, 'inputs\\T01.txt', 'outside-link/outside.txt']) {
    await assert.rejects(catalogFile(root, unsafe), /UNSAFE_CATALOG_PATH/)
  }
  assert.equal(await catalogFile(root, 'inputs/T01.txt'), await realpath(join(root, 'inputs/T01.txt')))
})

const report = () => ({
  schemaVersion: 1, catalogId: 'catalog', split: 'dev', mode: 'offline', manifestSha256: 'manifest-a',
  project: { commit: 'commit-a' }, results: [
    { id: 'T01', sourceSha256: 'source', referenceSha256: 'reference', structure: 'pass',
      fingerprints: { md: 'one', json: 'two' }, evidence: { snapshotId: 'volatile-1', path: '/tmp/run-1' } },
  ],
})

test('comparison ignores volatile evidence but flags regressions, changed inputs and missing rows', () => {
  const baseline = report()
  const equivalent = copy(baseline)
  equivalent.project.commit = 'commit-b'
  equivalent.results[0].evidence = { snapshotId: 'volatile-2', path: '/tmp/run-2' }
  const same = compareReports(baseline, equivalent)
  assert.equal(same.rows[0].change, 'unchanged')
  assert.equal(same.baselineApproval.status, 'pending-human')

  const regressed = copy(equivalent)
  regressed.results[0].structure = 'fail'
  assert.equal(compareReports(baseline, regressed).rows[0].change, 'regression')
  const changedInput = copy(regressed)
  changedInput.results[0].sourceSha256 = 'different-source'
  assert.equal(compareReports(baseline, changedInput).rows[0].change, 'input-changed')
  const changedOutput = copy(equivalent)
  changedOutput.results[0].fingerprints.md = 'different-output'
  assert.equal(compareReports(baseline, changedOutput).rows[0].change, 'output-changed')
  const missing = copy(equivalent)
  missing.results = []
  assert.equal(compareReports(baseline, missing).rows[0].change, 'removed')
  assert.equal(compareReports(missing, baseline).rows[0].change, 'added')
  const duplicateBaseline = copy(baseline)
  duplicateBaseline.results.push(copy(duplicateBaseline.results[0]))
  assert.throws(() => compareReports(duplicateBaseline, equivalent), /DUPLICATE_REPORT_ID/)
  const duplicateCandidate = copy(equivalent)
  duplicateCandidate.results.push(copy(duplicateCandidate.results[0]))
  assert.throws(() => compareReports(baseline, duplicateCandidate), /DUPLICATE_REPORT_ID/)
})

test('comparison retains change labels but exits nonzero for new or changed failing samples', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-compare-exit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const baseline = join(directory, 'baseline.json')
  const candidate = join(directory, 'candidate.json')
  const original = report()
  await writeFile(baseline, JSON.stringify(original))
  const cases = [
    { name: 'changed-failure', rows: [{ ...original.results[0], sourceSha256: 'changed', structure: 'fail' }],
      change: 'input-changed', after: 'fail', exit: 1 },
    { name: 'added-failure', rows: [...original.results, { ...original.results[0], id: 'T02', structure: 'fail' }],
      change: 'added', after: 'fail', exit: 1 },
    { name: 'changed-input-pass', rows: [{ ...original.results[0], sourceSha256: 'changed' }],
      change: 'input-changed', after: 'pass', exit: 0 },
    { name: 'added-pass', rows: [...original.results, { ...original.results[0], id: 'T02' }],
      change: 'added', after: 'pass', exit: 0 },
  ]
  for (const item of cases) {
    await writeFile(candidate, JSON.stringify({ ...original, results: item.rows }))
    const out = join(directory, `${item.name}.json`)
    const run = spawnSync(process.execPath, [cli, 'compare', '--baseline', baseline,
      '--candidate', candidate, '--out', out], { encoding: 'utf8' })
    assert.equal(run.status, item.exit, `${item.name}: ${run.stderr || run.stdout}`)
    const comparison = JSON.parse(await readFile(out, 'utf8'))
    assert.ok(comparison.rows.some(row => row.change === item.change && row.after === item.after), item.name)
  }
})

test('CLI rejects duplicate result IDs in either report before writing a comparison', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-compare-duplicates-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const baseline = join(directory, 'baseline.json')
  const candidate = join(directory, 'candidate.json')
  const out = join(directory, 'comparison.json')
  const original = report()
  const duplicate = { ...original, results: [...original.results, copy(original.results[0])] }
  for (const [left, right] of [[duplicate, original], [original, duplicate]]) {
    await writeFile(baseline, JSON.stringify(left))
    await writeFile(candidate, JSON.stringify(right))
    const run = spawnSync(process.execPath, [cli, 'compare', '--baseline', baseline,
      '--candidate', candidate, '--out', out], { encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.match(run.stderr, /DUPLICATE_REPORT_ID/)
    await assert.rejects(readFile(out), { code: 'ENOENT' })
  }
})

test('CLI denies external execution before catalog access', () => {
  const result = spawnSync(process.execPath, [cli, 'run', '--mode', 'external',
    '--catalog', '/no-such-ivoraige-catalog-root'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /EXTERNAL_EXECUTION_DISABLED/)
})

test('CLI init refuses to overwrite a local private skeleton', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-private-init-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'private-catalog')
  const args = [cli, 'init', '--root', root]
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  const manifest = await readFile(join(root, 'manifest.json'), 'utf8')
  assert.match(await readFile(join(root, '.gitattributes'), 'utf8'), /^# .*\n\* -text\n$/)
  const second = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(second.status, 1)
  assert.equal(await readFile(join(root, 'manifest.json'), 'utf8'), manifest)
})

test('private scaffold keeps catalog hashes stable after an autocrlf Git checkout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-private-checkout-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'private-catalog')
  const initialized = spawnSync(process.execPath, [cli, 'init', '--root', root], { encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  await mkdir(join(root, 'inputs'))
  await mkdir(join(root, 'references'))
  const sample = copy(JSON.parse(await readFile(new URL('manifest.json', catalog), 'utf8')).samples[0])
  await cp(new URL('inputs/T01.txt', catalog), join(root, sample.path))
  await cp(new URL('references/T01.json', catalog), join(root, sample.referencePath))
  await cp(new URL('LICENSE.txt', catalog), join(root, sample.source.licenseEvidence))
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
    catalogId: 'private-0.1.x-v1', visibility: 'private', samples: [sample] }))
  assert.equal((await loadCatalog(root)).inputs.length, 1)
  const git = (...args) => {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    return run.stdout.trim()
  }
  git('init', '-q')
  git('config', 'core.autocrlf', 'true')
  const emptyHooks = join(directory, 'empty-hooks')
  await mkdir(emptyHooks)
  git('config', 'core.hooksPath', emptyHooks)
  git('config', 'commit.gpgsign', 'false')
  git('add', '.')
  git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-qm', 'catalog fixture')
  assert.match(git('check-attr', 'text', '--', sample.path), /text: unset$/)
  await rm(join(root, sample.path))
  await rm(join(root, sample.referencePath))
  git('restore', '--', sample.path, sample.referencePath)
  assert.equal((await loadCatalog(root)).inputs.length, 1)
})

test('CLI keeps private comparison output outside the project', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-private-compare-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const baseline = join(directory, 'baseline.json')
  const candidate = join(directory, 'candidate.json')
  const privateReport = { ...report(), visibility: 'private' }
  await writeFile(baseline, JSON.stringify(privateReport))
  await writeFile(candidate, JSON.stringify(privateReport))
  const out = fileURLToPath(new URL('../evaluation/forbidden-private-comparison.json', import.meta.url))
  const result = spawnSync(process.execPath, [cli, 'compare', '--baseline', baseline,
    '--candidate', candidate, '--out', out], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PRIVATE_OUTPUT_MUST_BE_OUTSIDE_PROJECT/)
})

test('CLI dev report exercises all real catalog samples without model calls', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-catalog-run-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const out = join(directory, 'run')
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT // CLI invokes its own fixed node:test PDF regressions.
  const result = spawnSync(process.execPath, [cli, 'run', '--out', out],
    { encoding: 'utf8', env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'))
  assert.equal(report.results.length, 13)
  assert.equal(report.model.calls, 0)
  const textRows = report.results.filter(row => /^T\d+$/.test(row.id))
  assert.equal(textRows.length, 10)
  assert.ok(textRows.every(row => row.structure === 'pass' &&
    row.evidence.checks.protectedSpansPreserved === true))
  const pdfRows = report.results.filter(row => /^P\d+$/.test(row.id))
  assert.equal(pdfRows.length, 2)
  assert.ok(pdfRows.every(row => row.structure === 'not-run' && row.pdfDisplay === 'not-run'))
  assert.equal(report.results.find(row => row.id === 'G01')?.structure, 'pass')
})
