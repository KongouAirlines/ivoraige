import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createFrozenFixture, parseArguments, smokeSampleLibrary, checkout } from '../scripts/smoke-sample-library.mjs'

function selectPython(probe = command => spawnSync(command,
  ['-I', '-c', 'import sys; sys.exit(sys.version_info < (3, 9))'],
  { encoding: 'utf8', timeout: 5_000 })) {
  return ['python', 'python3'].find(command => probe(command).status === 0) ?? null
}
const python = selectPython()
const pythonSkip = python ? false : 'Python 3.9+ is not available for external CLI tests'

test('external CLI tests select an available Python 3.9+ interpreter', () => {
  assert.equal(selectPython(command => ({ status: command === 'python3' ? 0 : 1 })), 'python3')
  assert.equal(selectPython(() => ({ status: 1 })), null)
})

async function fakeSamplelib(root, cli) {
  const packageDir = join(root, 'src', 'samplelib')
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, '__init__.py'), '')
  await writeFile(join(packageDir, 'cli.py'), cli)
}

async function isolatedGit(parent) {
  const emptyTemplate = join(parent, 'empty-template')
  await mkdir(emptyTemplate)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(parent, 'no-global-config'),
    GIT_TEMPLATE_DIR: emptyTemplate })
  function gitAt(path, ...args) {
    const result = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', env })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  return { gitAt, emptyTemplate }
}

const passingCli = `import json, sys
from pathlib import Path
args = sys.argv
report = Path(args[args.index('--output') + 1])
print('samplelib passed')
report.write_text(json.dumps({'scope': 'ivoraige_frozen_export_integrity', 'status': 'pass',
    'explicit_skips': True, 'counts': {'source_units': 3,
    'decisions': {'revision': 1, 'skip': 1, 'keepOriginal': 1}}}))
`

test('sample-library fixture uses real frozen exports and byte-identical restart replay without a model', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const output = join(parent, 'run')
  const summary = await createFrozenFixture(output)
  assert.equal(summary.llmCalls, 0)
  assert.equal(summary.restartReplay, 'byte-identical')
  const source = JSON.parse(await readFile(join(output, 'source.json'), 'utf8'))
  const translated = JSON.parse(await readFile(join(output, 'translated.json'), 'utf8'))
  assert.equal(source.document.targetLang, undefined)
  assert.equal(translated.document.targetLang, 'zh-CN')
  assert.equal(translated.units[1].text, source.units[1].text)
  assert.equal(translated.units[2].text, source.units[2].text)
  assert.deepEqual(await readFile(join(output, 'translated.json')), await readFile(join(output, 'translated-replay.json')))
})

test('existing run directory is preserved, including a prior success summary', async t => {
  const output = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-existing-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  const bytes = '{"integrity":"pass"}\n'
  await writeFile(join(output, 'summary.json'), bytes)
  await assert.rejects(createFrozenFixture(output), { code: 'EEXIST' })
  assert.equal(await readFile(join(output, 'summary.json'), 'utf8'), bytes)
})

test('missing Python leaves diagnostic artifacts without creating a passed combined summary', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-failed-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const output = join(parent, 'run')
  await assert.rejects(smokeSampleLibrary({ samplelibRoot: parent, python: join(parent, 'missing-python'), output }))
  await assert.rejects(readFile(join(output, 'summary.json')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(join(output, 'kernel-check.json'), 'utf8')).llmCalls, 0)
  assert.equal(JSON.parse(await readFile(join(output, 'samplelib-execution.json'), 'utf8')).error.code, 'ENOENT')
  assert.equal(await readFile(join(output, 'samplelib.stdout.log'), 'utf8'), '')
})

test('a supplied local CLI succeeds even with a conflicting PYTHONPATH, and records its module file',
  { skip: pythonSkip }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-module-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const samplelibRoot = join(parent, 'chosen')
  const decoy = join(parent, 'decoy')
  await fakeSamplelib(samplelibRoot, passingCli)
  await fakeSamplelib(decoy, 'raise RuntimeError("wrong global module")\n')
  const prior = process.env.PYTHONPATH
  process.env.PYTHONPATH = join(decoy, 'src')
  t.after(() => { if (prior === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = prior })
  const output = join(parent, 'run')
  const summary = await smokeSampleLibrary({ samplelibRoot, python, output })
  assert.equal(summary.integrity, 'pass')
  assert.equal(summary.samplelib.kind, 'unknown')
  assert.equal(summary.samplelib.reason, 'not_repository')
  assert.equal(realpathSync.native(summary.samplelibModule.moduleFile),
    realpathSync.native(join(samplelibRoot, 'src', 'samplelib', 'cli.py')))
  assert.equal(JSON.parse(await readFile(join(output, 'samplelib-execution.json'), 'utf8')).exitCode, 0)
  assert.match(await readFile(join(output, 'samplelib.stdout.log'), 'utf8'), /samplelib passed/)
})

test('a missing module in the supplied root cannot borrow a PYTHONPATH installation',
  { skip: pythonSkip }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-wrong-root-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const samplelibRoot = join(parent, 'wrong')
  await mkdir(samplelibRoot)
  const decoy = join(parent, 'decoy')
  await fakeSamplelib(decoy, passingCli)
  const prior = process.env.PYTHONPATH
  process.env.PYTHONPATH = join(decoy, 'src')
  t.after(() => { if (prior === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = prior })
  const output = join(parent, 'run')
  await assert.rejects(smokeSampleLibrary({ samplelibRoot, python, output }), /failed/)
  assert.match(await readFile(join(output, 'samplelib.stderr.log'), 'utf8'), /samplelib.*__init__\.py/)
  assert.notEqual(JSON.parse(await readFile(join(output, 'samplelib-execution.json'), 'utf8')).exitCode, 0)
  await assert.rejects(readFile(join(output, 'summary.json')), { code: 'ENOENT' })
})

test('an external CLI failure retains exit, stdout and stderr without a success summary',
  { skip: pythonSkip }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-exit-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const samplelibRoot = join(parent, 'source')
  await fakeSamplelib(samplelibRoot, 'import sys\nprint("partial output")\nprint("reason for failure", file=sys.stderr)\nsys.exit(4)\n')
  const output = join(parent, 'run')
  await assert.rejects(smokeSampleLibrary({ samplelibRoot, python, output }), /exit 4/)
  assert.deepEqual(JSON.parse(await readFile(join(output, 'samplelib-execution.json'), 'utf8')),
    { exitCode: 4, signal: null, error: null })
  assert.match(await readFile(join(output, 'samplelib.stdout.log'), 'utf8'), /partial output/)
  assert.match(await readFile(join(output, 'samplelib.stderr.log'), 'utf8'), /reason for failure/)
  await assert.rejects(readFile(join(output, 'summary.json')), { code: 'ENOENT' })
})

test('samplelib Git metadata is sampled before output and again after execution',
  { skip: pythonSkip }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-provenance-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const samplelibRoot = join(parent, 'source')
  await fakeSamplelib(samplelibRoot, passingCli)
  const { gitAt, emptyTemplate } = await isolatedGit(parent)
  const git = (...args) => gitAt(samplelibRoot, ...args)
  git('init', '-q')
  git('add', 'src')
  git('-c', `core.hooksPath=${emptyTemplate}`, '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Sample Test', '-c', 'user.email=sample@example.invalid', 'commit', '-qm', 'fixture')
  const output = join(samplelibRoot, 'run')
  const summary = await smokeSampleLibrary({ samplelibRoot, python, output })
  assert.equal(summary.samplelib.commit, git('rev-parse', 'HEAD'))
  assert.equal(summary.samplelib.workingTreeChanges, false)
  assert.equal(summary.samplelibAfter.commit, summary.samplelib.commit)
  assert.equal(summary.samplelibAfter.workingTreeChanges, true)
})

test('sample-library arguments require explicit tool, checkout and new output directory', () => {
  for (const args of [[], ['--python', 'python'], ['--samplelib-root', '.', '--python', 'python', '--output'],
    ['--samplelib-root', '.', '--python', 'python', '--output', 'out', '--output', 'other'],
    ['--samplelib-root', '.', '--python', 'python', '--output', 'out', '--download', 'true']])
    assert.throws(() => parseArguments(args))
  assert.equal(parseArguments(['--python', 'python', '--output', 'out', '--samplelib-root', '.']).python, 'python')
})

test('a symlinked script entry still runs its argument validation', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-alias-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const alias = join(parent, 'smoke.mjs')
  try { await symlink(fileURLToPath(new URL('../scripts/smoke-sample-library.mjs', import.meta.url)), alias) }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable')
    throw error
  }
  const result = spawnSync(process.execPath, [alias], { encoding: 'utf8' })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Expected --samplelib-root/)
})

test('checkout distinguishes a clean or dirty root from a nested extraction and a non-repository', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-samplelib-git-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const repository = join(parent, 'repository')
  await mkdir(repository)
  const { gitAt, emptyTemplate } = await isolatedGit(parent)
  const git = (...args) => gitAt(repository, ...args)
  git('init', '-q')
  await writeFile(join(repository, 'tracked.txt'), 'clean\n')
  git('add', 'tracked.txt')
  git('-c', `core.hooksPath=${emptyTemplate}`, '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Sample Test', '-c', 'user.email=sample@example.invalid', 'commit', '-qm', 'fixture')
  const head = git('rev-parse', 'HEAD')
  assert.deepEqual(checkout(repository), { commit: head, workingTreeChanges: false, kind: 'git' })
  const other = join(parent, 'other-repository')
  await mkdir(other)
  gitAt(other, 'init', '-q')
  const excluded = join(parent, 'global-excludes')
  const hostConfig = join(parent, 'host-gitconfig')
  await writeFile(excluded, '*.tmp\n')
  await writeFile(hostConfig, `[core]\n  excludesFile = ${excluded}\n`)
  const overrides = { GIT_DIR: join(other, '.git'), GIT_WORK_TREE: repository,
    GIT_INDEX_FILE: join(other, '.git', 'index'), GIT_CONFIG_GLOBAL: hostConfig,
    GIT_CONFIG_SYSTEM: hostConfig }
  const originals = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, overrides)
    assert.deepEqual(checkout(repository), { commit: head, workingTreeChanges: false, kind: 'git' })
    assert.equal(process.env.GIT_DIR, overrides.GIT_DIR)
    await writeFile(join(repository, 'local.tmp'), 'untracked\n')
    assert.deepEqual(checkout(repository), { commit: head, workingTreeChanges: true, kind: 'git' })
    assert.equal(process.env.GIT_CONFIG_GLOBAL, hostConfig)
  } finally {
    for (const [key, value] of Object.entries(originals))
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  }
  await rm(join(repository, 'local.tmp'))
  await writeFile(join(repository, 'tracked.txt'), 'dirty\n')
  assert.deepEqual(checkout(repository), { commit: head, workingTreeChanges: true, kind: 'git' })
  const nested = join(repository, 'extracted')
  await mkdir(nested)
  assert.deepEqual(checkout(nested),
    { commit: null, workingTreeChanges: null, kind: 'unknown', reason: 'nested_source_tree' })
  assert.deepEqual(checkout(parent),
    { commit: null, workingTreeChanges: null, kind: 'unknown', reason: 'not_repository' })
})

test('Git spawn errors and timeouts retain their cause rather than becoming unknown', () => {
  const unavailable = checkout('/unused', { runner: () => ({ status: null, signal: null,
    error: Object.assign(new Error('git missing'), { code: 'ENOENT' }) }) })
  assert.equal(unavailable.kind, 'error')
  assert.equal(unavailable.reason, 'git_spawn_failed')
  assert.equal(unavailable.step, 'top')
  const timedOut = checkout('/unused', { runner: () => ({ status: null, signal: 'SIGTERM',
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }) })
  assert.equal(timedOut.kind, 'error')
  assert.equal(timedOut.reason, 'git_timeout')
  assert.match(timedOut.detail, /timed out/)
})

test('checkout isolates host Git configuration with a cleaned-up regular file', () => {
  let configFile
  const result = checkout('/unused', { runner: (_command, _args, { env }) => {
    configFile = env.GIT_CONFIG_GLOBAL
    assert.equal(env.GIT_CONFIG_SYSTEM, configFile)
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
    assert.equal(statSync(configFile).isFile(), true)
    assert.equal(readFileSync(configFile, 'utf8'), '')
    return { status: 128, stderr: 'fatal: not a git repository' }
  } })
  assert.equal(result.reason, 'not_repository')
  assert.throws(() => statSync(configFile), { code: 'ENOENT' })
})
