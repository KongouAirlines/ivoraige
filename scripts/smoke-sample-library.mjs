import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createApp } from '../src/app.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const unknownCheckout = reason => ({ commit: null, workingTreeChanges: null, kind: 'unknown', reason })
const gitFailure = (step, result) => ({ commit: null, workingTreeChanges: null, kind: 'error',
  reason: result.error?.code === 'ETIMEDOUT' ? 'git_timeout' : result.error ? 'git_spawn_failed'
    : result.signal ? 'git_signal' : 'git_command_failed', step,
  detail: result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}` })

// The runner boundary permits deterministic spawn and timeout regressions without changing Git.
export function checkout(directory, { runner = spawnSync } = {}) {
  const run = (step, args) => runner('git', ['-C', directory, ...args],
    { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' } })
  const top = run('top', ['rev-parse', '--show-toplevel'])
  if (top.error || top.signal) return gitFailure('top', top)
  if (top.status !== 0) {
    if (top.status === 128 && /^fatal: not a git repository\b/.test(top.stderr?.trim() ?? ''))
      return unknownCheckout('not_repository')
    return gitFailure('top', top)
  }
  if (!top.stdout?.trim()) return gitFailure('top', { ...top, stderr: 'empty Git top-level path' })
  // An extracted source tree inside another repository does not inherit its commit.
  // Native canonicalization also resolves Windows short-name aliases (RUNNER~1).
  if (realpathSync.native(top.stdout.trim()) !== realpathSync.native(directory))
    return unknownCheckout('nested_source_tree')
  const head = run('head', ['rev-parse', 'HEAD'])
  if (head.error || head.signal) return gitFailure('head', head)
  if (head.status !== 0) return gitFailure('head', head)
  const status = run('status', ['status', '--porcelain', '--untracked-files=normal'])
  if (status.error || status.signal || status.status !== 0) return gitFailure('status', status)
  return { commit: head.stdout.trim(), workingTreeChanges: Boolean(status.stdout.trim()), kind: 'git' }
}

// -I ignores PYTHONPATH and the current directory. Resolve both module files from the
// explicitly supplied source tree before running the CLI, so a global install cannot pass.
const boundSamplelib = String.raw`
import importlib.util
import json
from pathlib import Path
import runpy
import sys

root = Path(sys.argv[1]).resolve(strict=True)
source = root / 'src'
package = (source / 'samplelib' / '__init__.py').resolve()
cli = (source / 'samplelib' / 'cli.py').resolve()
for target in (package, cli):
    if not target.is_relative_to(source):
        raise RuntimeError(f'samplelib module escapes supplied root: {target}')
    if not target.is_file():
        raise RuntimeError(f'missing samplelib module in supplied root: {target}')
sys.path.insert(0, str(source))
for name, expected in (('samplelib', package), ('samplelib.cli', cli)):
    spec = importlib.util.find_spec(name)
    actual = Path(spec.origin).resolve() if spec and spec.origin else None
    if actual != expected:
        raise RuntimeError(f'{name} origin mismatch: expected {expected}, got {actual}')
Path(sys.argv[2]).write_text(json.dumps({'packageFile': str(package), 'moduleFile': str(cli)}) + '\n')
sys.argv = [str(cli), *sys.argv[3:]]
runpy.run_module('samplelib.cli', run_name='__main__')
`

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
  samplelibRoot = resolve(samplelibRoot)
  output = resolve(output)
  const summary = await createFrozenFixture(output)
  const reportPath = join(output, 'samplelib-report.json')
  const result = spawnSync(python, ['-I', '-B', '-c', boundSamplelib, samplelibRoot,
    join(output, 'samplelib-module.json'), '--root', samplelibRoot, 'ivoraige-exports',
    '--source-export', join(output, 'source.json'), '--translation-export', join(output, 'translated.json'),
    '--output', reportPath], { cwd: samplelibRoot,
    encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 1024 * 1024 })
  await writeFile(join(output, 'samplelib.stdout.log'), result.stdout ?? '', { flag: 'wx' })
  await writeFile(join(output, 'samplelib.stderr.log'), result.stderr ?? '', { flag: 'wx' })
  const execution = { exitCode: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code, message: result.error.message } : null }
  await writeFile(join(output, 'samplelib-execution.json'), JSON.stringify(execution, null, 2) + '\n', { flag: 'wx' })
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`samplelib ivoraige-exports failed (${result.error?.code ?? result.signal ?? `exit ${result.status}`}). Inspect samplelib-execution.json and retained stdout/stderr in the run directory.`)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.scope, 'ivoraige_frozen_export_integrity')
  assert.equal(report.status, 'pass')
  assert.equal(report.explicit_skips, true)
  assert.equal(report.counts?.source_units, 3)
  assert.deepEqual(report.counts?.decisions, summary.decisions)
  const complete = { ...summary, samplelib: checkout(samplelibRoot),
    samplelibModule: JSON.parse(await readFile(join(output, 'samplelib-module.json'), 'utf8')),
    integrity: 'pass' }
  await writeFile(join(output, 'summary.json'), JSON.stringify(complete, null, 2) + '\n', { flag: 'wx' })
  return complete
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await smokeSampleLibrary(parseArguments(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
