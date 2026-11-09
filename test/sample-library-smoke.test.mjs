import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFrozenFixture, parseArguments, smokeSampleLibrary, checkout } from '../scripts/smoke-sample-library.mjs'

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
})

test('sample-library arguments require explicit tool, checkout and new output directory', () => {
  for (const args of [[], ['--python', 'python3'], ['--samplelib-root', '.', '--python', 'python3', '--output'],
    ['--samplelib-root', '.', '--python', 'python3', '--output', 'out', '--output', 'other'],
    ['--samplelib-root', '.', '--python', 'python3', '--output', 'out', '--download', 'true']])
    assert.throws(() => parseArguments(args))
  assert.equal(parseArguments(['--python', 'python3', '--output', 'out', '--samplelib-root', '.']).python, 'python3')
})

test('a nested extracted source does not report its parent repository commit', () => {
  assert.deepEqual(checkout(fileURLToPath(new URL('../src', import.meta.url))),
    { commit: null, workingTreeChanges: null })
})
