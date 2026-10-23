import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { digest, sameBasis } from '../src/basis.mjs'
import { renderMarkdown } from '../src/adapters/markdown-output.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-records-'))
  const store = join(directory, 'records.sqlite')
  let app = await createApp({ store })
  t.after(async () => { if (app) await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { get app() { return app }, async restart() { await app.dispose(); app = await createApp({ store }) } }
}
const source = { format: 'txt', content: 'First sentence.\n\nSecond sentence.' }
const options = { sourceId: 'paper:42', language: 'en' }

test('Markdown metadata persists as nontranslatable and survives a frozen export after restart', async t => {
  const f = await fixture(t)
  const header = '---\r\ntitle: "Original title"\r\nabstract: >-\r\n  Original abstract.\r\n---\r\n'
  const { document } = await f.app.records.importDocument(
    { format: 'md', content: header + '\r\nBody text.\r\n' }, options)
  const [metadata, body] = f.app.records.listUnits(document.id, { targetLang: 'zh' })
  assert.equal(metadata.translatable, false)
  await assert.rejects(f.app.records.writeRevision(metadata.id,
    { targetLang: 'zh', text: '修改头部', baseRevisionId: null }), { code: 'INVALID_ARGUMENT' })
  const revision = await f.app.records.writeRevision(body.id,
    { targetLang: 'zh', text: '正文。', baseRevisionId: null })
  await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  const snapshot = await f.app.records.createSnapshot(document.id, { targetLang: 'zh' })
  assert.deepEqual(snapshot.items.map(item => item.decision.type), ['keepOriginal', 'revision'])
  await f.restart()
  assert.equal(f.app.records.listUnits(document.id, { targetLang: 'zh' })[0].translatable, false)
  assert.equal(renderMarkdown(f.app.records.resolveSnapshot(document.id, snapshot.id)),
    header + '\r\n正文。\r\n')
})

test('import is durable, idempotent under concurrency, and returns copies', async t => {
  const f = await fixture(t)
  const [a, b] = await Promise.all([f.app.records.importDocument(source, options),
    f.app.records.importDocument(source, options)])
  assert.equal(a.document.id, b.document.id)
  assert.equal([a.deduplicated, b.deduplicated].filter(Boolean).length, 1)
  assert.equal(f.app.records.listDocuments().length, 1)
  a.document.title = 'mutated'
  assert.equal(f.app.records.getDocument(b.document.id).title, 'Untitled')
  await f.restart()
  const repeat = await f.app.records.importDocument(source, options)
  assert.equal(repeat.deduplicated, true)
  assert.equal(f.app.records.listUnits(repeat.document.id, { targetLang: 'zh-CN' }).length, 2)
  assert.equal(f.app.records.listDocuments().length, 1)
  const changed = await f.app.records.importDocument({ ...source, content: 'Changed' }, options)
  assert.notEqual(changed.document.id, repeat.document.id)
})

test('revision locks are atomic, language scoped, and persisted', async t => {
  const f = await fixture(t)
  const { document } = await f.app.records.importDocument(source, options)
  const [unit] = f.app.records.listUnits(document.id, { targetLang: 'zh-CN' })
  const writes = await Promise.allSettled([
    f.app.records.writeRevision(unit.id, { targetLang: 'zh-CN', text: '第一句。', baseRevisionId: null }),
    f.app.records.writeRevision(unit.id, { targetLang: 'zh-CN', text: '首句。', baseRevisionId: null }),
  ])
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(writes.find(r => r.status === 'rejected').reason.code, 'CONFLICT')
  const revision = writes.find(r => r.status === 'fulfilled').value
  const accepted = await Promise.allSettled([
    f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null }),
    f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null }),
  ])
  assert.equal(accepted.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(accepted.find(r => r.status === 'rejected').reason.code, 'CONFLICT')
  assert.equal(f.app.records.getUnit(unit.id, { targetLang: 'fr' }).accepted, undefined)
  const french = await f.app.records.writeRevision(unit.id, { targetLang: 'fr', text: 'Première phrase.', baseRevisionId: null })
  await f.app.records.acceptRevision(french.id, { expectedAcceptedRevisionId: null })
  assert.equal(f.app.records.getUnit(unit.id, { targetLang: 'zh-CN' }).accepted.id, revision.id)
  await f.restart()
  assert.equal(f.app.records.getUnit(unit.id, { targetLang: 'zh-CN' }).accepted.text, revision.text)
  assert.equal(f.app.records.findReusable(unit.id, { targetLang: 'zh-CN' }).id, revision.id)
  assert.equal(f.app.records.getUnit(unit.id, { targetLang: 'fr' }).accepted.id, french.id)
  assert.deepEqual(await f.app.records.unaccept(unit.id,
    { targetLang: 'zh-CN', expectedAcceptedRevisionId: revision.id }), { accepted: null })
  assert.equal(f.app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }).length, 1)
  assert.equal(f.app.records.getUnit(unit.id, { targetLang: 'fr' }).accepted.id, french.id)
})

test('constraints invalidate acceptance but preserve historical snapshots and revisions', async t => {
  const f = await fixture(t)
  const { document } = await f.app.records.importDocument({ format: 'txt', content: 'Hello' }, options)
  const [unit] = f.app.records.listUnits(document.id, { targetLang: 'zh-CN' })
  const original = await f.app.records.writeRevision(unit.id,
    { targetLang: 'zh-CN', text: '你好', baseRevisionId: null })
  await f.app.records.acceptRevision(original.id, { expectedAcceptedRevisionId: null })
  const first = await f.app.records.createSnapshot(document.id, { targetLang: 'zh-CN' })
  const basis = f.app.records.getBasis(unit.id, { targetLang: 'zh-CN' })
  await f.app.records.setConstraints(unit.id, { targetLang: 'zh-CN',
    effectiveContext: basis.effectiveContext, effectiveTarget: { style: 'formal' },
    termConstraintSetId: 'terms:v2' })
  assert.equal(f.app.records.findReusable(unit.id, { targetLang: 'zh-CN' }), null)
  await assert.rejects(f.app.records.createSnapshot(document.id, { targetLang: 'zh-CN' }),
    { code: 'PRECONDITION_FAILED' })
  await assert.rejects(f.app.records.acceptRevision(original.id,
    { expectedAcceptedRevisionId: original.id }), { code: 'PRECONDITION_FAILED' })
  const skipped = await f.app.records.createSnapshot(document.id,
    { targetLang: 'zh-CN', onMissingAccepted: 'skip' })
  assert.equal(skipped.items[0].decision.type, 'skip')
  const pinned = f.app.records.resolveSnapshot(document.id, first.id)
  assert.equal(pinned.units[0].text, '你好')
  assert.equal(pinned.units[0].revision.status, 'accepted')
  await f.app.records.unaccept(unit.id, { targetLang: 'zh-CN', expectedAcceptedRevisionId: original.id })
  assert.deepEqual(f.app.records.resolveSnapshot(document.id, first.id), pinned)
  await f.restart()
  assert.equal(f.app.records.resolveSnapshot(document.id, first.id).units[0].text, '你好')
  assert.equal(f.app.records.listRevisions(unit.id, { targetLang: 'zh-CN' })[0].id, original.id)
})

test('snapshot deletion respects artifact references and export leases', async t => {
  const f = await fixture(t)
  const { document } = await f.app.records.importDocument({ format: 'txt', content: 'Hello' }, options)
  const snapshot = await f.app.records.createSnapshot(document.id,
    { targetLang: 'zh-CN', onMissingAccepted: 'skip' })
  const release = f.app.records.retainSnapshot(document.id, snapshot.id)
  await assert.rejects(f.app.records.deleteSnapshot(document.id, snapshot.id),
    error => error.code === 'CONFLICT' && error.details.inUse)
  release(); release()
  const artifact = await f.app.records.addArtifact(document.id,
    { snapshotId: snapshot.id, targetLang: 'zh-CN', format: 'json', path: 'output.json' })
  await assert.rejects(f.app.records.deleteSnapshot(document.id, snapshot.id),
    error => error.code === 'CONFLICT' && error.details.artifactIds.includes(artifact.id))
  await f.app.records.deleteArtifact(document.id, artifact.id)
  await f.app.records.deleteSnapshot(document.id, snapshot.id)
  assert.equal(f.app.records.listSnapshots(document.id).length, 0)
})

test('nontranslatable source is kept and invalid persisted data is rejected', async t => {
  const f = await fixture(t)
  const unregister = f.app.parse.register({ id: 'mixed', match: file => file.format === 'mixed' ? 1 : 0,
    parse: async () => ({ format: 'txt', title: 'Mixed', units: [
      { order: 0, kind: 'formula', sourceText: 'E=mc²', translatable: false },
      { order: 1, kind: 'body', sourceText: 'Energy', translatable: true },
    ], chapters: [], resources: [], sourceBinding: { adapterId: 'mixed' } }) })
  t.after(unregister)
  const { document } = await f.app.records.importDocument({ format: 'mixed', content: 'ignored' },
    { sourceId: 'mixed:1', language: 'en' })
  const snapshot = await f.app.records.createSnapshot(document.id,
    { targetLang: 'zh-CN', onMissingAccepted: 'skip' })
  assert.deepEqual(snapshot.items.map(item => item.decision.type), ['keepOriginal', 'skip'])
  const [formula] = f.app.records.listUnits(document.id, { targetLang: 'zh-CN' })
  await assert.rejects(f.app.records.writeRevision(formula.id,
    { targetLang: 'zh-CN', text: 'x', baseRevisionId: null }), { code: 'INVALID_ARGUMENT' })
  const [, body] = f.app.records.listUnits(document.id, { targetLang: 'zh-CN' })
  const cycle = {}; cycle.loop = cycle
  await assert.rejects(f.app.records.setConstraints(body.id, { targetLang: 'zh-CN',
    effectiveContext: cycle, effectiveTarget: {}, termConstraintSetId: 'none' }), { code: 'INVALID_ARGUMENT' })
  assert.equal(f.app.records.getBasis(body.id, { targetLang: 'zh-CN' }).termConstraintSetId, 'none')
  const target = { style: 'formal' }
  await f.app.records.setConstraints(body.id, { targetLang: 'zh-CN',
    effectiveContext: {}, effectiveTarget: target, termConstraintSetId: 'terms:1' })
  target.style = 'mutated after saving'
  assert.equal(f.app.records.getBasis(body.id, { targetLang: 'zh-CN' }).effectiveTarget.style, 'formal')
})

test('a matching reuse key still requires the same source structure and contextual applicability', async t => {
  const f = await fixture(t)
  const { document } = await f.app.records.importDocument({ format: 'txt', content: 'Field H.' }, options)
  const unit = f.app.records.listUnits(document.id, { targetLang: 'zh' })[0]
  const rev = await f.app.records.writeRevision(unit.id, { targetLang: 'zh', text: '场 H。', baseRevisionId: null, modelId: 'model-a' })
  await f.app.records.acceptRevision(rev.id, { expectedAcceptedRevisionId: null })
  const originalBasis = f.app.records.getBasis(unit.id, { targetLang: 'zh' })
  // A different locator/source payload has the same key but must fail the applicability check.
  const unregister = f.app.parse.register({ id: 'other-binding', match: file => file.format === 'other' ? 1 : 0,
    parse: async () => ({ format: 'txt', title: 'Other source', units: [{ order: 0, kind: 'body',
      sourceText: 'Field H.', locator: { paragraph: 3 }, translatable: true }],
    chapters: [], resources: [], sourceBinding: { adapterId: 'other-binding', structureVersion: 'other' } }) })
  t.after(unregister)
  const { document: other } = await f.app.records.importDocument({ format: 'other', content: 'Field H.' },
    { sourceId: 'different:source', language: 'en' })
  const otherUnit = f.app.records.listUnits(other.id, { targetLang: 'zh' })[0]
  assert.equal(f.app.records.getBasis(otherUnit.id, { targetLang: 'zh' }).reuseKey, rev.reuseKey)
  assert.equal(f.app.records.findReusable(otherUnit.id, { targetLang: 'zh' }), null)
  // A later model is provenance, not an implicit replacement of accepted text.
  const draft = await f.app.records.writeRevision(unit.id, { targetLang: 'zh', text: 'H 场。', baseRevisionId: rev.id, modelId: 'model-b' })
  assert.equal(draft.reuseKey, rev.reuseKey)
  assert.equal(f.app.records.findReusable(unit.id, { targetLang: 'zh' }).id, rev.id)
  await f.app.records.setConstraints(unit.id, { targetLang: 'zh', effectiveContext: { before: 'Changed context' },
    effectiveTarget: originalBasis.effectiveTarget, termConstraintSetId: originalBasis.termConstraintSetId })
  assert.equal(f.app.records.findReusable(unit.id, { targetLang: 'zh' }), null)
})

test('Markdown revision bases retain a compact binding and scale with units', async t => {
  const f = await fixture(t)
  const content = Array.from({ length: 1000 }, (_, index) =>
    `${String(index).padStart(4, '0')} ${'A'.repeat(85)}`).join('\n\n')
  assert.ok(Buffer.byteLength(content) > 90_000 && Buffer.byteLength(content) < 100_000)
  const { document } = await f.app.records.importDocument({ format: 'md', content }, options)
  const units = f.app.records.listUnits(document.id, { targetLang: 'zh' })
  assert.equal(units.length, 1000)
  const bases = units.map(unit => f.app.records.getBasis(unit.id, { targetLang: 'zh' }))
  assert.ok(bases.every(basis => !Object.hasOwn(basis, 'sourceBinding')))
  assert.equal(new Set(bases.map(basis => basis.sourceBindingDigest)).size, 1)
  assert.ok(Buffer.byteLength(JSON.stringify(bases)) < Buffer.byteLength(content) * 10)
  const first = await f.app.records.writeRevision(units[0].id,
    { targetLang: 'zh', text: '译文一', baseRevisionId: null })
  const second = await f.app.records.writeRevision(units[1].id,
    { targetLang: 'zh', text: '译文二', baseRevisionId: null })
  const saved = f.app.records.record(document.id)
  assert.ok(saved.revisions.every(revision => !Object.hasOwn(revision.basis, 'sourceBinding')))
  assert.equal(saved.revisions[0].basis.sourceBindingDigest, saved.revisions[1].basis.sourceBindingDigest)
  await f.app.records.acceptRevision(first.id, { expectedAcceptedRevisionId: null })
  await f.app.records.acceptRevision(second.id, { expectedAcceptedRevisionId: null })
  await f.restart()
  assert.equal(f.app.records.findReusable(units[0].id, { targetLang: 'zh' }).id, first.id)
  const { document: other } = await f.app.records.importDocument({ format: 'md', content },
    { ...options, sourceId: 'paper:other' })
  const [otherUnit] = f.app.records.listUnits(other.id, { targetLang: 'zh' })
  assert.equal(f.app.records.findReusable(otherUnit.id, { targetLang: 'zh' }).id, first.id)
})

test('legacy full-binding revisions remain applicable for acceptance, checkpoints and snapshots', async t => {
  const f = await fixture(t)
  const { document } = await f.app.records.importDocument({ format: 'md', content: 'First.\n\nSecond.' }, options)
  const [unit] = f.app.records.listUnits(document.id, { targetLang: 'zh' })
  const revision = await f.app.records.writeRevision(unit.id,
    { targetLang: 'zh', text: '第一。', baseRevisionId: null })
  await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  const task = await f.app.records.createTranslationTask(document.id,
    { targetLang: 'zh', unitIds: [unit.id] })
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'running' }))
  await f.app.records.commitTaskUnit(task.id, { unitId: unit.id,
    expectedBasis: f.app.records.getBasis(unit.id, { targetLang: 'zh' }),
    baseRevisionId: revision.id, expectedAcceptedRevisionId: revision.id,
    reusedRevisionId: revision.id })
  const snapshot = await f.app.records.createSnapshot(document.id,
    { targetLang: 'zh', onMissingAccepted: 'skip' })
  await f.app.records.update(document.id, current => {
    const { sourceBindingDigest, ...oldRecord } = current
    const revisions = oldRecord.revisions.map(item => {
      if (item.id !== revision.id) return item
      const { sourceBindingDigest, sourceKind, sourceLocator, sourceRevision, ...shared } = item.basis
      return { ...item, basis: { ...shared, sourceBinding: current.sourceBinding,
        sourceRevision: digest({ text: shared.sourceText, kind: sourceKind,
          locator: sourceLocator, binding: current.sourceBinding }) } }
    })
    return { ...oldRecord, revisions }
  })
  await f.restart()
  const oldBasis = f.app.records.record(document.id).revisions.find(item => item.id === revision.id).basis
  assert.equal(sameBasis(oldBasis, structuredClone(oldBasis)), true)
  assert.equal(f.app.records.findReusable(unit.id, { targetLang: 'zh' }).id, revision.id)
  const { document: other } = await f.app.records.importDocument(
    { format: 'md', content: 'First.\n\nSecond.' }, { ...options, sourceId: 'legacy:other' })
  const [otherUnit] = f.app.records.listUnits(other.id, { targetLang: 'zh' })
  assert.equal(f.app.records.findReusable(otherUnit.id, { targetLang: 'zh' }).id, revision.id)
  assert.equal(f.app.records.validateTaskCheckpoints(task.id), true)
  assert.equal(f.app.records.resolveSnapshot(document.id, snapshot.id).units[0].text, '第一。')
  await f.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: revision.id })
  await f.app.records.setConstraints(unit.id, { targetLang: 'zh', effectiveContext: {},
    effectiveTarget: {}, termConstraintSetId: 'changed' })
  assert.equal(f.app.records.findReusable(unit.id, { targetLang: 'zh' }), null)
  assert.equal(f.app.records.resolveSnapshot(document.id, snapshot.id).units[0].text, '第一。')
})

test('accepting an older applicable revision rolls back the current view without rewriting either snapshot', async t => {
  const f = await fixture(t)
  const { document } = await f.app.records.importDocument({ format: 'txt', content: 'Two measurements.' }, options)
  const [unit] = f.app.records.listUnits(document.id, { targetLang: 'zh' })
  const old = await f.app.records.writeRevision(unit.id, { targetLang: 'zh', text: '两次测量。', baseRevisionId: null })
  await f.app.records.acceptRevision(old.id, { expectedAcceptedRevisionId: null })
  const first = await f.app.records.createSnapshot(document.id, { targetLang: 'zh' })
  const newer = await f.app.records.writeRevision(unit.id, { targetLang: 'zh', text: '测量两次。', baseRevisionId: old.id })
  await f.app.records.acceptRevision(newer.id, { expectedAcceptedRevisionId: old.id })
  const second = await f.app.records.createSnapshot(document.id, { targetLang: 'zh' })
  await f.app.records.acceptRevision(old.id, { expectedAcceptedRevisionId: newer.id })
  assert.equal(f.app.records.getUnit(unit.id, { targetLang: 'zh' }).accepted.id, old.id)
  assert.equal(f.app.records.resolveSnapshot(document.id, first.id).units[0].text, old.text)
  assert.equal(f.app.records.resolveSnapshot(document.id, second.id).units[0].text, newer.text)
  assert.equal(f.app.records.listRevisions(unit.id, { targetLang: 'zh' }).length, 2)
})
