import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm, readdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createApp } from '../src/app.mjs'
import { resolveBasis } from '../src/terms.mjs'

const runFile = promisify(execFile)
const original = 'The spin wave travels through a magnetic film.\n\nThe final state preserves magnetization.'
async function setup(t, { responder, terms = true, builder = true, model = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-m2-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const requests = [], responses = new Set()
  const server = createServer(async (req, res) => {
    responses.add(res); res.once('close', () => responses.delete(res))
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ url: req.url, body })
    const choice = responder ? await responder(body, requests.length, req, res) : { text: body.model === 'builder-model' ? '[{"en":"spin wave","zh":"自旋波","sense":"magnetic excitation","context":["magnetic"],"quote":"spin wave"}]' : body.model === 'review-model' ? '经审校的译文。' : '自旋波在磁性薄膜中传播。' }
    if (choice === null || res.destroyed) return
    if (choice.error) { res.writeHead(choice.error, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'mock upstream failure', type: 'server_error' } })); return }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    chunk({ role: 'assistant', content: choice.text }); chunk({}, 'stop'); res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { for (const response of responses) response.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`
  const config = { network: false, roles: Object.fromEntries(['translation', 'builder', 'review'].map(role => [role, { provider: 'local', model: role === 'translation' ? 'text-model' : `${role}-model`, baseURL, maxTokens: 128 }])) }
  const store = join(root, 'store')
  const app = await createApp({ store, terms, builder, ...(model ? { model: config } : {}) })
  t.after(() => app.dispose())
  return { root, store, app, requests, config, server }
}
async function importDocument(app, extra = {}) { return app.records.importText({ documentId: 'sample', text: original, ...extra }) }
async function acceptDrafts(app, docId = 'sample') {
  const doc = app.records.getDocument(docId)
  for (const unit of doc.units) { const revision = unit.revisions.at(-1); assert.equal(revision.status, 'draft'); const { basis } = resolveBasis(app.records, app.terms, docId, unit.id); await app.records.accept(docId, unit.id, revision.id, basis, { expectedAcceptedId: unit.acceptedId }) }
}
const term = (en = 'spin wave', zh = '自旋波', sense = 'magnetic excitation', context = []) => ({ en, zh, sense, context, sources: [{ source: 'original test text', quote: en }] })

test('real DSH → HTTP → drafts → acceptance → same revision in both exports; rerun sends no requests', async t => {
  const { app, root, requests } = await setup(t, { terms: false, builder: false })
  const doc = await importDocument(app)
  const initial = await app.task.start(doc.id).done
  assert.equal(initial.status, 'completed'); assert.equal(requests.length, 2)
  assert.equal(requests[0].url, '/v1/chat/completions'); assert.equal(requests[0].body.model, 'text-model')
  assert.match(requests[0].body.messages.at(-1).content, /English into Chinese/)
  for (const unit of app.records.getDocument(doc.id).units) { assert.equal(unit.acceptedId, null); assert.equal(unit.revisions[0].usage.status, 'unknown'); assert.equal(unit.revisions[0].usage.totalTokens, null) }
  assert.throws(() => app.records.manifest(doc.id), /Missing applicable/)
  await acceptDrafts(app)
  const before = requests.length; const rerun = await app.task.start(doc.id).done
  assert.equal(requests.length, before); assert.equal(rerun.calls.length, 0); assert.ok(rerun.units.every(u => u.status === 'reused'))
  const md = join(root, 'translation.md'), json = join(root, 'translation.json')
  const manifest = await app.exporter.write(doc.id, [{ format: 'md', path: md }, { format: 'json', path: json }])
  const parsed = JSON.parse(await readFile(json, 'utf8')); const markdown = await readFile(md, 'utf8')
  assert.deepEqual(parsed, manifest); for (const unit of parsed.units) { assert.ok(markdown.includes(unit.revisionId)); assert.ok(markdown.includes(unit.unitId)); assert.ok(markdown.includes(unit.text)) }
  assert.equal(requests.length, before)
})

test('persistent records reopen; unload all model providers then confirm, edit and export', async t => {
  const { app, store, root, requests, config } = await setup(t)
  const doc = await importDocument(app); await app.task.start(doc.id).done
  for (const fiber of [...app.modelFibers].reverse()) await fiber.dispose()
  const units = app.records.getDocument(doc.id).units; const first = units[0]
  await app.records.accept(doc.id, first.id, first.revisions[0].id, resolveBasis(app.records, app.terms, doc.id, first.id).basis, { expectedAcceptedId: null })
  const second = units[1]
  const edited = await app.records.accept(doc.id, second.id, second.revisions[0].id, resolveBasis(app.records, app.terms, doc.id, second.id).basis, { expectedAcceptedId: null, text: '人工修改的译文。' })
  assert.equal(edited.provenance.kind, 'human'); assert.equal(requests.length, 2)
  await app.exporter.write(doc.id, [{ format: 'md', path: join(root, 'without-model.md') }]); await app.dispose()
  const reopened = await createApp({ store }); t.after(() => reopened.dispose())
  assert.equal(reopened.records.getDocument(doc.id).units[0].id, first.id)
  assert.equal(reopened.records.manifest(doc.id).units[1].revisionId, edited.id)
  assert.equal(reopened.ctx.get('ivoraige.model'), undefined)
  await reopened.dispose()
  const changedModel = await createApp({ store, model: { ...config, roles: { ...config.roles, translation: { ...config.roles.translation, model: 'replacement-model' } } } }); t.after(() => changedModel.dispose())
  const rerun = await changedModel.task.start(doc.id).done
  assert.equal(rerun.calls.length, 0); assert.equal(requests.length, 2)
  assert.equal(changedModel.records.manifest(doc.id).units[1].revisionId, edited.id)
})

test('source/context and target changes reject direct export and retain old revisions', async t => {
  const { app, root } = await setup(t)
  const doc = await importDocument(app); await app.task.start(doc.id).done; await acceptDrafts(app)
  const old = app.records.manifest(doc.id); const first = doc.units[0]
  await app.records.updateSource(doc.id, first.id, 'The spin wave travels slowly.')
  assert.equal(app.records.getDocument(doc.id).units[0].id, first.id); assert.equal(app.records.getDocument(doc.id).units[0].sourceRevision, 2)
  await assert.rejects(app.exporter.write(doc.id, [{ format: 'json', path: join(root, 'stale.json') }]), /Missing applicable/)
  for (const unit of app.records.getDocument(doc.id).units) { const check = await app.records.recordCheck(doc.id, unit.id, resolveBasis(app.records, app.terms, doc.id, unit.id).basis); assert.equal(check.reusable, false) }
  assert.equal(app.records.getDocument(doc.id).units[0].acceptedId, old.units[0].revisionId)
  await app.records.updateTarget(doc.id, { style: 'concise prose' })
  assert.throws(() => app.records.manifest(doc.id), /Missing applicable/)
})

test('unrelated term changes recheck and reuse; relevant changes require reconfirmation without overwriting human text', async t => {
  const { app, requests } = await setup(t)
  await app.terms.createLibrary('shared'); const entry = await app.terms.put('shared', term(), { confirm: true })
  const doc = await importDocument(app, { libraries: ['shared'] }); await app.task.start(doc.id).done; await acceptDrafts(app)
  const prior = app.records.manifest(doc.id); await app.terms.put('shared', term('phonon', '声子', 'lattice excitation'), { confirm: true })
  assert.throws(() => app.records.manifest(doc.id), /Missing applicable/)
  const before = requests.length; const reused = await app.task.start(doc.id).done
  assert.equal(reused.calls.length, 0); assert.equal(requests.length, before); assert.deepEqual(app.records.manifest(doc.id).units.map(u => u.revisionId), prior.units.map(u => u.revisionId))
  await app.terms.confirm('shared', entry.id, { zh: '自旋波模式' })
  assert.throws(() => app.records.manifest(doc.id), /Missing applicable/)
  const first = app.records.getDocument(doc.id).units[0]; const resolved = resolveBasis(app.records, app.terms, doc.id, first.id)
  assert.equal((await app.records.recordCheck(doc.id, first.id, resolved.basis)).reusable, false)
  assert.equal(first.acceptedId, prior.units[0].revisionId)
  const reconfirmed = await app.records.accept(doc.id, first.id, first.acceptedId, resolved.basis, { expectedAcceptedId: first.acceptedId, text: '人工保留并复核的译文。' })
  assert.notEqual(reconfirmed.id, first.acceptedId); assert.equal(reconfirmed.provenance.kind, 'human')
})

test('bidirectional terms, contextual senses and project priority retain explicit conflict evidence', async t => {
  const { app } = await setup(t, { model: false })
  await app.terms.createLibrary('shared'); await app.terms.createLibrary('project', 'project')
  await app.terms.put('shared', term(), { confirm: true }); await app.terms.put('project', term('spin wave', '磁性自旋波'), { confirm: true })
  const doc = await importDocument(app, { libraries: ['shared', 'project'] }); const resolved = resolveBasis(app.records, app.terms, doc.id, doc.units[0].id)
  assert.equal(resolved.constraints[0].target, '磁性自旋波'); assert.equal(resolved.conflicts[0].kind, 'project-priority')
  await app.terms.put('shared', term('bank', '银行', 'finance'), { confirm: true }); await app.terms.put('shared', term('bank', '河岸', 'river'), { confirm: true })
  const ambiguous = await app.records.importText({ documentId: 'ambiguous', text: 'The bank is nearby.', libraries: ['shared'] })
  assert.throws(() => resolveBasis(app.records, app.terms, ambiguous.id, ambiguous.units[0].id), /Ambiguous/)
  await app.terms.put('shared', term('excitation', '激发', 'excitation'), { confirm: true }); await app.terms.put('shared', term('stimulation', '激发', 'stimulation'), { confirm: true })
  const reverse = await app.records.importText({ documentId: 'reverse', text: '激发产生变化。', sourceLanguage: 'zh', targetLanguage: 'en', libraries: ['shared'] })
  assert.throws(() => resolveBasis(app.records, app.terms, reverse.id, reverse.units[0].id), /Ambiguous/)
  const reverseClear = await app.records.importText({ documentId: 'reverse-clear', text: '自旋波传播。', sourceLanguage: 'zh', targetLanguage: 'en', libraries: ['shared'] })
  assert.equal(resolveBasis(app.records, app.terms, reverseClear.id, reverseClear.units[0].id).constraints[0].target, 'spin wave')
  const banks = app.terms.exportLibrary('shared').entries.filter(e => e.en === 'bank')
  for (const bank of banks) await app.terms.confirm('shared', bank.id, { context: bank.sense === 'finance' ? ['money'] : ['river'] })
  assert.throws(() => resolveBasis(app.records, app.terms, ambiguous.id, ambiguous.units[0].id), /Ambiguous/)
  const river = await app.records.importText({ documentId: 'river', text: 'The river bank is nearby.', libraries: ['shared'] })
  assert.equal(resolveBasis(app.records, app.terms, river.id, river.units[0].id).constraints[0].target, '河岸')
})

test('builder candidates have exact source provenance, require confirmation, and use a distinct role; merge/import/export work', async t => {
  const { app, requests } = await setup(t)
  await app.terms.createLibrary('terms'); const built = await app.termBuilder.build('terms', original, 'original-control-text')
  assert.equal(requests[0].body.model, 'builder-model'); assert.equal(built.entries[0].status, 'candidate'); assert.equal(built.entries[0].sources[0].quote, 'spin wave'); assert.equal(built.entries[0].provenance.role, 'builder')
  const doc = await importDocument(app, { libraries: ['terms'] }); assert.equal(resolveBasis(app.records, app.terms, doc.id, doc.units[0].id).constraints.length, 0)
  await app.terms.confirm('terms', built.entries[0].id); assert.equal(resolveBasis(app.records, app.terms, doc.id, doc.units[0].id).constraints.length, 1)
  await app.task.start(doc.id, { review: true }).done
  assert.deepEqual(requests.map(r => r.body.model), ['builder-model', 'text-model', 'review-model', 'text-model', 'review-model'])
  const alias = await app.terms.put('terms', term('spin waves', '自旋波', 'magnetic excitation'), { confirm: true }); await app.terms.merge('terms', built.entries[0].id, alias.id)
  const exported = app.terms.exportLibrary('terms'); assert.ok(exported.entries[0].aliases.en.includes('spin waves'))
  await app.terms.importLibrary({ ...exported, id: 'imported' }); assert.equal(app.terms.exportLibrary('imported').entries[0].status, 'confirmed')
})

test('cancel in-flight HTTP closes request and prevents later unit dispatch', async t => {
  let startedResolve; const started = new Promise(resolve => { startedResolve = resolve })
  let closedResolve; const closed = new Promise(resolve => { closedResolve = resolve })
  const { app, requests } = await setup(t, { responder: async (body, count, req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); res.once('close', closedResolve); startedResolve(); return null } })
  const doc = await importDocument(app); const run = app.task.start(doc.id); await started; run.cancel(); const outcome = await run.done
  await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('HTTP remained open after cancellation')), 2000); timer.unref() })])
  assert.equal(outcome.status, 'cancelled'); assert.equal(requests.length, 1); assert.ok(outcome.units.every(u => u.status === 'cancelled'))
  assert.ok(app.records.getDocument(doc.id).units.every(u => u.revisions.length === 0 && u.acceptedId === null))
})

test('upstream error saves no draft or accepted revision; failed review records both requests', async t => {
  const { app, requests } = await setup(t, { responder: body => body.model === 'review-model' ? { error: 503 } : { text: '正文译文。' } })
  const doc = await importDocument(app, { text: 'The magnetic film supports a spin wave.' }); const result = await app.task.start(doc.id, { review: true }).done
  assert.equal(result.status, 'failed'); assert.equal(requests.length, 2); assert.equal(result.calls.length, 2)
  assert.deepEqual(result.calls.map(c => c.provenance.role), ['translation', 'review'])
  assert.equal(app.records.getDocument(doc.id).units[0].revisions.length, 0)
  assert.throws(() => app.records.manifest(doc.id), /Missing applicable/)
})

test('real JSON backend write failure never reports or mutates accepted success', async t => {
  const { app, store } = await setup(t)
  const doc = await importDocument(app, { text: 'One scientific sentence.' }); await app.task.start(doc.id).done
  const unit = app.records.getDocument(doc.id).units[0]; const basis = resolveBasis(app.records, app.terms, doc.id, unit.id).basis
  const before = app.records.snapshot(); await rename(store, `${store}-saved`); await writeFile(store, 'not a directory')
  await assert.rejects(app.records.accept(doc.id, unit.id, unit.revisions[0].id, basis, { expectedAcceptedId: null }))
  assert.deepEqual(app.records.snapshot(), before); assert.equal(app.records.getDocument(doc.id).units[0].acceptedId, null)
  await rm(store); await rename(`${store}-saved`, store)
})

test('explicit model network gate and missing selected terms fail without HTTP', async t => {
  const { app, config, store, requests } = await setup(t)
  await assert.rejects(createApp({ store: `${store}-network`, model: { network: false, roles: { translation: { ...config.roles.translation, baseURL: 'https://example.invalid/v1', apiKeyEnv: 'TEST_UNUSED_KEY' } } } }), /network:true/)
  await assert.rejects(app.records.selectLibraries('missing', ['missing']), /Unknown document/)
  const withoutTerms = await createApp({ store: `${store}-without-terms`, terms: false, builder: false, model: config }); t.after(() => withoutTerms.dispose())
  const doc = await importDocument(withoutTerms, { libraries: ['selected-but-unavailable'] })
  assert.throws(() => withoutTerms.task.start(doc.id), /require ivoraige.terms/); assert.equal(requests.length, 0)
})

test('explicit DSH reasoning profile disables DeepSeek-style thinking; invalid candidate preserves diagnostic without writes', async t => {
  const { store, config, requests } = await setup(t, { model: false, responder: () => ({ text: '[{"en":"spin wave","zh":["自旋波"],"sense":"magnetic excitation","context":[],"quote":"spin wave"}]' }) })
  const roles = Object.fromEntries(Object.entries(config.roles).map(([role, value]) => [role, { ...value, reasoningEfforts: { off: null, low: 'low' }, compat: { thinkingFormat: 'deepseek' } }]))
  const app = await createApp({ store: `${store}-reasoning`, model: { network: false, roles } }); t.after(() => app.dispose())
  await app.terms.createLibrary('invalid')
  await assert.rejects(app.termBuilder.build('invalid', 'A spin wave propagates.', 'original'), error => /Invalid candidate field types/.test(error.message) && error.output.text.includes('自旋波'))
  assert.equal(app.terms.exportLibrary('invalid').entries.length, 0)
  assert.deepEqual(requests[0].body.thinking, { type: 'disabled' })
})

test('CLI import/show/terms/export commands do not mount invalid model config; explicit revision is required', async t => {
  const { root, store } = await setup(t, { model: false })
  const input = join(root, 'input.txt'), config = join(root, 'config.json'); await writeFile(input, original); await writeFile(config, JSON.stringify({ store: `${store}-cli`, model: { roles: { invalid: {} } } }))
  const imported = await runFile(process.execPath, ['src/cli.mjs', 'import', input, '--id', 'cli-doc', '--config', config]); const doc = JSON.parse(imported.stdout)
  const shown = await runFile(process.execPath, ['src/cli.mjs', 'show', 'cli-doc', '--config', config]); assert.equal(JSON.parse(shown.stdout).units[0].id, doc.units[0].id)
  await assert.rejects(runFile(process.execPath, ['src/cli.mjs', 'confirm', 'cli-doc', doc.units[0].id, '--config', config]), error => /Missing arguments/.test(error.stderr))
  await assert.rejects(runFile(process.execPath, ['src/cli.mjs', 'export', 'cli-doc', '--json', join(root, 'absent.json'), '--config', config]), error => /Missing applicable/.test(error.stderr))
  assert.ok(!(await readdir(root)).includes('absent.json'))
  const working = await createApp({ store: `${store}-cli` })
  const unit = doc.units[0]; const { basis } = resolveBasis(working.records, working.terms, doc.id, unit.id)
  const draft = await working.records.saveDraft(doc.id, unit.id, { text: '工程控制译文。', basis, provenance: { kind: 'engineering-control' }, usage: { status: 'unknown' }, finish: { kind: 'stop' } })
  await working.dispose()
  const accepted = await runFile(process.execPath, ['src/cli.mjs', 'confirm', doc.id, unit.id, draft.id, '--config', config, '--actor', 'agent-engineering-check'])
  assert.equal(JSON.parse(accepted.stdout).acceptedBy, 'agent-engineering-check')
})
