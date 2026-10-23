// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replayTextSample } from '../scripts/evaluation/kernel-replay.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-sample-replay-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('TXT duplicate paragraphs and formula tokens survive accepted revision replay', async t => {
  const directory = await fixture(t)
  const evidence = await replayTextSample({
    sample: { id: 'duplicate-txt', format: 'txt', sourceLanguage: 'en', targetLanguage: 'zh' },
    content: 'Dose 42 mg yields 7.\n\nDose 42 mg yields 7.\n\nE = mc^2 at 21 C.',
    references: ['剂量 42 mg 得到 7。', '剂量 42 mg 得到 7。', 'E = mc^2，在 21 C。'],
    directory,
  })
  assert.equal(evidence.unitCount, 3)
  assert.equal(evidence.translatableUnitCount, 3)
  assert.equal(evidence.checks.llmCalls, 0)
  assert.equal(evidence.checks.frozenReplayByteIdentical, true)
  assert.ok(evidence.sourceBindingRef)
  assert.notEqual(evidence.outputs.initial.md.path, evidence.outputs.replay.md.path)
  const output = JSON.parse(await readFile(evidence.outputs.replay.json.path, 'utf8'))
  assert.deepEqual(output.units.map(unit => unit.sourceText),
    ['Dose 42 mg yields 7.', 'Dose 42 mg yields 7.', 'E = mc^2 at 21 C.'])
  assert.notEqual(output.units[0].id, output.units[1].id)
  assert.deepEqual(output.units.map(unit => unit.text),
    ['剂量 42 mg 得到 7。', '剂量 42 mg 得到 7。', 'E = mc^2，在 21 C。'])
})

test('Markdown replay retains duplicate prose positions and protected formula bytes', async t => {
  const directory = await fixture(t)
  const source = '# Result 42\n\nRepeated $E=mc^2$ value 7.\n\nRepeated $E=mc^2$ value 7.\n'
  const evidence = await replayTextSample({
    sample: { id: 'formula-md', format: 'md', sourceLanguage: 'en', targetLanguage: 'zh' },
    content: source,
    references: ['结果 42', '重复', '值 7。', '重复', '值 7。'],
    directory,
  })
  assert.equal(evidence.translatableUnitCount, 5)
  const markdown = await readFile(evidence.outputs.replay.md.path, 'utf8')
  assert.equal(markdown, '# 结果 42\n\n重复 $E=mc^2$ 值 7。\n\n重复 $E=mc^2$ 值 7。\n')
  const output = JSON.parse(await readFile(evidence.outputs.replay.json.path, 'utf8'))
  assert.deepEqual(output.units.map(unit => unit.sourceText),
    ['Result 42', 'Repeated', 'value 7.', 'Repeated', 'value 7.'])
  assert.notEqual(output.units[1].id, output.units[3].id)
  assert.equal(evidence.checks.sourceIdentityPreserved, true)
})

test('reference count mismatch fails instead of silently skipping a unit', async t => {
  const directory = await fixture(t)
  await assert.rejects(replayTextSample({
    sample: { id: 'short-reference', format: 'txt', sourceLanguage: 'en', targetLanguage: 'zh' },
    content: 'First.\n\nSecond.', references: ['第一。'], directory,
  }), /reference count differs from translatable unit count/)
})

test('normalized hashes match across isolated runs with different snapshot IDs', async t => {
  const directory = await fixture(t)
  const content = 'Value 42.\n\nValue 42.'
  const references = ['值 42。', '值 42。']
  const sample = { id: 'repeatable', format: 'txt', sourceLanguage: 'en', targetLanguage: 'zh' }
  const first = await replayTextSample({
    sample,
    content, references, directory,
  })
  const second = await replayTextSample({
    sample,
    content, references, directory,
  })
  assert.notEqual(first.snapshotId, second.snapshotId)
  for (const format of ['md', 'json']) {
    assert.equal(first.outputs.initial[format].normalizedSha256,
      second.outputs.initial[format].normalizedSha256)
  }
})
