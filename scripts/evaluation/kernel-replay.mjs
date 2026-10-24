// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createApp } from '../../src/app.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const outputFormats = [{ format: 'md' }, { format: 'json' }]
const sourceIdentity = frozen => ({
  documentId: frozen.document.id,
  sourceId: frozen.document.sourceId,
  sourceBindingRef: frozen.snapshot.sourceBindingRef,
  sourceBindingSha256: hash(JSON.stringify(frozen.sourceBinding)),
  units: frozen.units.map(({ unit }) => ({ id: unit.id, order: unit.order,
    sourceText: unit.sourceText, locator: unit.locator, translatable: unit.translatable })),
})

async function outputEvidence(result) {
  return Object.fromEntries(await Promise.all(result.artifacts.map(async artifact => {
    const bytes = await readFile(artifact.path)
    const body = bytes.toString('utf8')
    // The TXT Markdown header and JSON document/unit IDs contain run-local IDs.
    // The semantic digest permits comparison between independent sample runs.
    const normalized = artifact.format === 'json'
      ? JSON.stringify(JSON.parse(body).units.map(unit => unit.text))
      : body.replace(/^<!-- ivoraige snapshot:[^\n]* -->\n\n/, '')
    return [artifact.format, {
      path: artifact.path,
      sha256: hash(bytes), normalizedSha256: hash(normalized),
      snapshotId: artifact.snapshotId,
      revisionSetHash: artifact.revisionSetHash,
    }]
  })))
}

// References are locally supplied fixture text. Their acceptance proves only
// the kernel's record/export mechanics, not translation quality or human review.
export async function replayTextSample({ sample, content, references, directory }) {
  assert.ok(sample && typeof sample === 'object', 'sample is required')
  assert.ok(typeof sample.id === 'string' && sample.id.trim(), 'sample.id is required')
  assert.ok(['txt', 'md'].includes(sample.format), 'sample.format must be txt or md')
  assert.ok(typeof sample.sourceLanguage === 'string' && sample.sourceLanguage.trim(), 'sourceLanguage is required')
  assert.ok(typeof sample.targetLanguage === 'string' && sample.targetLanguage.trim(), 'targetLanguage is required')
  assert.ok(typeof content === 'string' && content.trim(), 'content is required')
  assert.ok(Array.isArray(references) && references.every(value =>
    typeof value === 'string' && value.trim()), 'references must be nonempty strings')
  assert.ok(typeof directory === 'string' && directory.trim(), 'directory is required')
  const protectedSpans = sample.acceptance?.protectedSpans ?? []
  assert.ok(Array.isArray(protectedSpans) && protectedSpans.every(span =>
    typeof span === 'string' && span.length), 'protectedSpans must be strings')
  for (const span of protectedSpans) assert.ok(content.includes(span), `source lacks protected span: ${span}`)

  await mkdir(directory, { recursive: true })
  const sampleDirectory = await mkdtemp(join(resolve(directory),
    `${sample.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}-`))
  const store = join(sampleDirectory, 'records.sqlite')
  const exportDir = join(sampleDirectory, 'exports')
  const config = { store, exportDir, mcp: false }
  let app
  try {
    app = await createApp(config)
    assert.equal(app.ctx.get('llm'), undefined, 'replay must start without an LLM')
    const { document } = await app.records.importDocument(
      { format: sample.format, content, title: sample.id },
      { sourceId: `evaluation:${sample.id}`, language: sample.sourceLanguage })
    const units = app.records.listUnits(document.id, { targetLang: sample.targetLanguage })
    const translatable = units.filter(unit => unit.translatable)
    assert.equal(references.length, translatable.length,
      `reference count differs from translatable unit count for ${sample.id}`)
    const acceptedIds = []
    for (const [index, unit] of translatable.entries()) {
      const revision = await app.records.writeRevision(unit.id, {
        targetLang: sample.targetLanguage, text: references[index], baseRevisionId: null,
        origin: 'imported',
      })
      await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
      acceptedIds.push(revision.id)
    }
    assert.ok(acceptedIds.length, 'sample must contain at least one translatable unit')

    const first = await app.exporter.exportDocument(document.id, {
      targetLang: sample.targetLanguage, outputs: outputFormats,
    })
    const initial = await outputEvidence(first)
    const initialMarkdown = await readFile(initial.md.path, 'utf8')
    for (const span of protectedSpans) assert.ok(initialMarkdown.includes(span),
      `Markdown export lost protected span: ${span}`)
    const frozenBefore = app.records.resolveSnapshot(document.id, first.snapshotId)
    const identityBefore = sourceIdentity(frozenBefore)
    const initialJson = JSON.parse(await readFile(initial.json.path, 'utf8'))
    assert.equal(initialJson.snapshotId, first.snapshotId)
    assert.deepEqual(initialJson.units.map(unit => unit.id), units.map(unit => unit.id))
    assert.deepEqual(initialJson.units.map(unit => unit.sourceText), units.map(unit => unit.sourceText))
    assert.deepEqual(initialJson.units.filter(unit => unit.decision.type === 'revision').map(unit => unit.text), references)
    assert.deepEqual(initialJson.units.filter(unit => unit.decision.type === 'revision')
      .map(unit => unit.decision.revisionId), acceptedIds)
    assert.equal(initial.md.snapshotId, first.snapshotId)
    assert.equal(initial.json.snapshotId, first.snapshotId)
    assert.equal(initial.md.revisionSetHash, initial.json.revisionSetHash)

    const firstUnit = translatable[0]
    const changedText = `${references[0]} [edited after snapshot]`
    const changed = await app.records.writeRevision(firstUnit.id, {
      targetLang: sample.targetLanguage, text: changedText, baseRevisionId: acceptedIds[0],
      origin: 'imported',
    })
    await app.records.acceptRevision(changed.id, { expectedAcceptedRevisionId: acceptedIds[0] })
    await app.dispose()
    app = undefined

    app = await createApp(config)
    assert.equal(app.ctx.get('llm'), undefined, 'replay must restart without an LLM')
    const frozenAfter = app.records.resolveSnapshot(document.id, first.snapshotId)
    assert.deepEqual(sourceIdentity(frozenAfter), identityBefore)
    assert.deepEqual(frozenAfter.units.filter(item => item.decision.type === 'revision')
      .map(item => item.text), references)
    assert.equal(app.records.getUnit(firstUnit.id, { targetLang: sample.targetLanguage }).accepted.id, changed.id)
    const replay = await app.exporter.exportDocument(document.id, {
      targetLang: sample.targetLanguage, snapshotId: first.snapshotId, outputs: outputFormats,
    })
    const replayed = await outputEvidence(replay)
    const replayMarkdown = await readFile(replayed.md.path, 'utf8')
    for (const span of protectedSpans) assert.ok(replayMarkdown.includes(span),
      `Markdown replay lost protected span: ${span}`)
    for (const format of ['md', 'json']) {
      assert.equal(replayed[format].sha256, initial[format].sha256,
        `${format} replay bytes changed after revision and restart`)
      assert.equal(replayed[format].normalizedSha256, initial[format].normalizedSha256)
      assert.equal(replayed[format].snapshotId, first.snapshotId)
      assert.equal(replayed[format].revisionSetHash, initial[format].revisionSetHash)
    }
    const replayJson = JSON.parse(await readFile(replayed.json.path, 'utf8'))
    assert.deepEqual(replayJson, initialJson)
    assert.equal(app.ctx.get('llm'), undefined, 'replay installed an LLM')

    return {
      sampleId: sample.id, format: sample.format, sampleDirectory,
      documentId: document.id, snapshotId: first.snapshotId,
      sourceBindingRef: identityBefore.sourceBindingRef,
      sourceBindingSha256: identityBefore.sourceBindingSha256,
      unitCount: units.length, translatableUnitCount: translatable.length,
      outputs: { initial, replay: replayed },
      checks: {
        sourceIdentityPreserved: true, acceptedTextPreserved: true,
        frozenReplayByteIdentical: true, editedRevisionSurvivedRestart: true,
        protectedSpansPreserved: true,
        llmInstalled: false, llmCalls: 0,
      },
    }
  } finally {
    if (app) await app.dispose()
  }
}
