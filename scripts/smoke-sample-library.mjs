import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createApp } from '../src/app.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function checkout(directory) {
  const top = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5_000 })
  // An extracted source tree inside another repository does not inherit its commit.
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(directory))
    return { commit: null, workingTreeChanges: null }
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5_000 })
  if (result.status !== 0) return { commit: null, workingTreeChanges: null }
  const status = spawnSync('git', ['-C', directory, 'status', '--porcelain', '--untracked-files=normal'],
    { encoding: 'utf8', timeout: 5_000 })
  return { commit: result.stdout.trim(), workingTreeChanges: status.status === 0 ? Boolean(status.stdout.trim()) : null }
}

// This is a synthetic integration smoke, not a sample catalog or observation exporter.
// It deliberately uses a real temporary store, manual revisions, task exports and restart.
export async function createFrozenFixture(directory) {
  directory = resolve(directory)
  await mkdir(dirname(directory), { recursive: true })
  // A prior run must never be mistaken for this run or overwritten.
  await mkdir(directory)
  const options = { store: join(directory, 'records.sqlite'), exportDir: join(directory, 'exports') }
  let app
  try {
    app = await createApp(options)
    assert.equal(app.ctx.get('llm'), undefined)
    assert.equal(app.ctx.get('ivoraige.translationModel'), undefined)
    const content = '# Contract example\n\nThis original sentence is deliberately retained.\n\n```js\nconst answer = 42\n```\n'
    const { document } = await app.records.importDocument({ format: 'md', content },
      { sourceId: 'original:samplelib-contract-0.1.x', language: 'en' })
    const units = app.records.listUnits(document.id, { targetLang: 'zh-CN' })
    assert.equal(units.length, 3)
    const revision = await app.records.writeRevision(units[0].id,
      { targetLang: 'zh-CN', text: '契约示例', baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })

    async function exported(name, settings) {
      const submitted = await app.tasks.exportDocument(document.id,
        { ...settings, outputs: [{ format: 'json' }] })
      const task = await app.tasks.wait(submitted.taskId)
      assert.equal(task.state, 'succeeded')
      assert.equal(task.stats.llmCalls, 0)
      const bytes = await readFile(task.artifacts[0].path)
      await writeFile(join(directory, `${name}.json`), bytes, { flag: 'wx' })
      return { snapshotId: submitted.snapshotId, bytes }
    }

    const source = await exported('source', { contentMode: 'source' })
    const translated = await exported('translated', { targetLang: 'zh-CN', onMissingAccepted: 'skip' })
    assert.deepEqual(JSON.parse(translated.bytes).units.map(unit => unit.decision.type),
      ['revision', 'skip', 'keepOriginal'])
    await app.dispose()
    app = await createApp(options)
    assert.equal(app.ctx.get('llm'), undefined)
    const sourceReplay = await exported('source-replay', { contentMode: 'source', snapshotId: source.snapshotId })
    const translatedReplay = await exported('translated-replay',
      { targetLang: 'zh-CN', snapshotId: translated.snapshotId })
    assert.deepEqual(sourceReplay.bytes, source.bytes)
    assert.deepEqual(translatedReplay.bytes, translated.bytes)
    const summary = { ivoraige: checkout(root), node: process.version,
      input: 'original synthetic Markdown', units: 3,
      decisions: { revision: 1, skip: 1, keepOriginal: 1 },
      llmCalls: 0, restartReplay: 'byte-identical', pdf: 'not_run', ocr: 'not_run',
      translationQuality: 'not_assessed', visualQuality: 'not_assessed' }
    await writeFile(join(directory, 'kernel-check.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
    return summary
  } finally { await app?.dispose() }
}

export function parseArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--samplelib-root', '--python', '--output'].includes(key) ||
        !value || value.startsWith('--') || Object.hasOwn(options, key))
      throw new Error('Expected --samplelib-root PATH --python PYTHON --output NEW_DIRECTORY')
    options[key] = value
  }
  if (Object.keys(options).length !== 3)
    throw new Error('Expected --samplelib-root PATH --python PYTHON --output NEW_DIRECTORY')
  return { samplelibRoot: resolve(options['--samplelib-root']), python: options['--python'], output: resolve(options['--output']) }
}

export async function smokeSampleLibrary({ samplelibRoot, python, output }) {
  const summary = await createFrozenFixture(output)
  const reportPath = join(output, 'samplelib-report.json')
  const result = spawnSync(python, ['-m', 'samplelib.cli', '--root', samplelibRoot, 'ivoraige-exports',
    '--source-export', join(output, 'source.json'), '--translation-export', join(output, 'translated.json'),
    '--output', reportPath], { cwd: samplelibRoot,
    env: { ...process.env, PYTHONPATH: join(samplelibRoot, 'src') },
    encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`samplelib ivoraige-exports failed (exit ${result.status}). Inspect the retained run directory.`)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.scope, 'ivoraige_frozen_export_integrity')
  assert.equal(report.status, 'pass')
  assert.equal(report.explicit_skips, true)
  assert.equal(report.counts?.source_units, 3)
  assert.deepEqual(report.counts?.decisions, summary.decisions)
  const complete = { ...summary, samplelib: checkout(samplelibRoot), integrity: 'pass' }
  await writeFile(join(output, 'summary.json'), JSON.stringify(complete, null, 2) + '\n', { flag: 'wx' })
  return complete
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await smokeSampleLibrary(parseArguments(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
