// SPDX-License-Identifier: LGPL-3.0-or-later
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareReports, inside, loadCatalog, sha256 } from './evaluation/catalog.mjs'
import { DSH_COMMIT } from './setup-dsh.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const command = args.shift()
const options = {}
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith('--') || !args[i + 1] || options[args[i]]) throw new Error('INVALID_OPTIONS')
  options[args[i]] = args[i + 1]
}
const allowed = { run: ['--catalog', '--out', '--split', '--mode'],
  compare: ['--baseline', '--candidate', '--out'], init: ['--root'] }
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const json = value => JSON.stringify(value, null, 2) + '\n'
async function newDirectory(path) {
  const parent = await realpath(dirname(resolve(path)))
  const target = resolve(parent, resolve(path).split(/[\\/]/).at(-1))
  await mkdir(target) // No overwrite of prior evidence or baselines.
  return target
}
function markdown(report) {
  const lines = ['# Offline sample report', '',
    `Commit: ${report.project.commit}; dirty tree: ${report.project.dirty}.`,
    `Catalog: ${report.catalogId}; split: ${report.split}; manifest SHA-256: ${report.manifestSha256}.`,
    '', 'Seeded fixture acceptance tests software mechanics. It is not human approval or translation quality.',
    'PDF inputs are integrity-checked only; PDF engine and display quality are not tested here.', '',
    '| ID | Structure | Translation quality | PDF display | Human notes |', '| --- | --- | --- | --- | --- |']
  for (const row of report.results) lines.push(`| ${row.id} | ${row.structure} | ${row.translationQuality} | ${row.pdfDisplay} | |`)
  lines.push('', 'For each issue record sample/unit or page, category, severity, reason, correction, reviewer and allowed alternatives in report.json humanReview.',
    'Never publish private report directories: they include local stores, source text and exports.', '')
  return lines.join('\n')
}

async function main() {
  if (!allowed[command] || Object.keys(options).some(key => !allowed[command].includes(key))) throw new Error('INVALID_COMMAND_OR_OPTION')
  if (command === 'init') {
    if (!options['--root']) throw new Error('ROOT_REQUIRED')
    const requested = resolve(options['--root'])
    const parent = await realpath(dirname(requested))
    if (inside(await realpath(repo), resolve(parent, requested.split(/[\\/]/).at(-1)))) throw new Error('PRIVATE_ROOT_MUST_BE_OUTSIDE_PROJECT')
    const root = await newDirectory(requested)
    await writeFile(resolve(root, 'manifest.json'), json({ schemaVersion: 1, catalogId: 'private-0.1.x-v1', visibility: 'private', samples: [] }))
    await writeFile(resolve(root, '.gitattributes'), '# Manifest digests cover exact bytes; never rewrite them on checkout.\n* -text\n')
    await writeFile(resolve(root, '.gitignore'), 'runs/\n.env*\ncredentials*\n')
    await writeFile(resolve(root, 'README.md'), '# Private sample catalog\n\nLocal skeleton only; no remote repository or sharing is configured. Keep inputs and references separate. Add each sample using the main repository catalog.schema.json. Unconfirmed rights must use permission-pending and denied externalModel. Keep heldout references out of prompts, retrieval and translation memory. All run directories contain private derived data and must stay local.\n')
    console.log('Created local private skeleton; no remote configured.')
    return
  }
  if (command === 'compare') {
    if (!options['--baseline'] || !options['--candidate'] || !options['--out']) throw new Error('COMPARISON_PATHS_REQUIRED')
    const baseline = JSON.parse(await readFile(options['--baseline']))
    const candidate = JSON.parse(await readFile(options['--candidate']))
    const comparison = compareReports(baseline, candidate)
    comparison.baselineReport = { path: resolve(options['--baseline']), sha256: sha256(await readFile(options['--baseline'])) }
    comparison.candidateReport = { path: resolve(options['--candidate']), sha256: sha256(await readFile(options['--candidate'])) }
    // Reports may include private stable IDs and hashes; keep comparison beside
    // the candidate's local run, never silently redirect it into the project.
    const targetParent = await realpath(dirname(resolve(options['--out'])))
    if ((baseline.visibility === 'private' || candidate.visibility === 'private') && inside(await realpath(repo), targetParent)) throw new Error('PRIVATE_OUTPUT_MUST_BE_OUTSIDE_PROJECT')
    await writeFile(options['--out'], json(comparison), { flag: 'wx' })
    console.log(`Comparison written; ${comparison.rows.filter(row => row.change !== 'unchanged').length} changed rows. Human baseline approval pending.`)
    if (comparison.rows.some(row => ['regression', 'removed'].includes(row.change) ||
        (['added', 'input-changed'].includes(row.change) && row.after === 'fail'))) process.exitCode = 1
    return
  }
  const root = resolve(options['--catalog'] ?? resolve(repo, 'evaluation/catalog-0.1.x'))
  const split = options['--split'] ?? 'dev'
  const mode = options['--mode'] ?? 'offline'
  // All authorization and immutable-byte checks finish before a kernel opens.
  const catalog = await loadCatalog(root, { split, mode })
  if (!options['--out']) throw new Error('OUTPUT_DIRECTORY_REQUIRED')
  const outputParent = await realpath(dirname(resolve(options['--out'])))
  const target = resolve(outputParent, resolve(options['--out']).split(/[\\/]/).at(-1))
  if (inside(await realpath(root), target)) throw new Error('OUTPUT_CANNOT_BE_INSIDE_CATALOG')
  if (catalog.manifest.visibility === 'private' && inside(await realpath(repo), target)) throw new Error('PRIVATE_OUTPUT_MUST_BE_OUTSIDE_PROJECT')
  const out = await newDirectory(target)
  const pkg = JSON.parse(await readFile(resolve(repo, 'package.json')))
  const report = { schemaVersion: 1, mode, catalogId: catalog.manifest.catalogId,
    visibility: catalog.manifest.visibility, split, manifestSha256: catalog.manifestSha256,
    project: { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'),
      node: process.version, platform: process.platform, arch: process.arch, dshCommit: DSH_COMMIT,
      lockSha256: sha256(await readFile(resolve(repo, 'package-lock.json'))), dependencies: pkg.dependencies },
    model: { provider: null, id: null, promptVersion: null, parameters: null,
      mode: 'seeded-reference-no-model', scope: 'catalog-text-replay', calls: 0, externalCalls: 0, usage: null, cost: null }, results: [] }
  const { replayTextSample } = await import('./evaluation/kernel-replay.mjs')
  for (const { sample, content, reference } of catalog.inputs) {
    const row = { id: sample.id, sourceSha256: sample.sha256, referenceSha256: sample.referenceSha256,
      structure: 'not-run', translationQuality: 'not-reviewed', pdfDisplay: sample.format === 'pdf' ? 'not-run' : 'not-applicable',
      referenceStatus: reference?.status ?? null,
      fingerprints: {}, evidence: {}, humanReview: { reviewer: null, unitOrPage: null, category: null, severity: null, reason: null, correction: null, notes: '' } }
    try {
      if (sample.format === 'pdf') {
        if (!content.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('INVALID_PDF_HEADER')
        row.evidence = { inputIntegrity: 'pass', engineParse: 'not-run', frozenPdfRebuild: 'not-run' }
      } else {
        if (!reference) throw new Error('REFERENCE_REQUIRED')
        for (const span of sample.acceptance.protectedSpans) {
          if (!content.toString('utf8').includes(span)) throw new Error('PROTECTED_SPAN_MISSING')
        }
        row.evidence = await replayTextSample({ sample, content: content.toString('utf8'), references: reference.texts, directory: out })
        row.fingerprints = Object.fromEntries(Object.entries(row.evidence.outputs.initial).map(([format, value]) => [format, value.normalizedSha256]))
        row.structure = 'pass'
      }
    } catch (error) {
      row.structure = 'fail'
      // Assertion messages may embed sample text: never copy them into logs.
      row.evidence = { errorCode: /^[A-Z_]+$/.test(error.message) ? error.message : 'KERNEL_REPLAY_FAILED' }
    }
    report.results.push(row)
  }
  // Reuse the existing fixed regression cases rather than cloning their code.
  const files = ['test/pdf.test.mjs', 'test/pdf-import-tasks.test.mjs']
  const pattern = 'PDF bindings persist;|invalid PDF placeholders|reimport repairs missing|legacy shared-source snapshots|legacy snapshot recovers'
  const row = { id: 'G01', structure: 'pass', translationQuality: 'not-reviewed', pdfDisplay: 'not-run',
    sourceSha256: sha256((await Promise.all(files.map(file => readFile(resolve(repo, file))))).map(bytes => sha256(bytes)).join('')),
    referenceSha256: null, fingerprints: {}, evidence: { kind: 'existing-mock-pdf-regressions', files, pattern, translationStub: 'local-invalid-output', stubCalls: null },
    humanReview: { reviewer: null, notes: '' } }
  try {
    const log = execFileSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, ...files],
      { cwd: repo, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    // Guard against renamed cases silently reducing the suite.
    if (!/# pass 5\b/.test(log)) throw new Error('EXPECTED_FIVE_REGRESSIONS')
    await writeFile(resolve(out, 'regressions.tap'), log)
  } catch (error) {
    row.structure = 'fail'
    row.evidence.errorCode = 'REGRESSION_SUITE_FAILED'
    await writeFile(resolve(out, 'regressions.tap'), String(error.stdout ?? 'Suite could not start or expected test count changed.'))
  }
  report.results.push(row)
  await writeFile(resolve(out, 'report.json'), json(report))
  await writeFile(resolve(out, 'report.md'), markdown(report))
  const failures = report.results.filter(row => row.structure === 'fail').length
  console.log(`Offline report written: ${report.results.length} rows; ${failures} failures. Translation quality not reviewed; PDF display not tested.`)
  if (failures) process.exitCode = 1
}
main().catch(error => {
  // No paths, source text, credentials, or raw parser errors in console output.
  console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'EVALUATION_FAILED')
  process.exitCode = 1
})
