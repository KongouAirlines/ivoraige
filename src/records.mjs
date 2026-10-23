// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { randomUUID } from 'node:crypto'
import { Service, StorageDomain, z } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { basisFor, digest, sameBasis } from './basis.mjs'
import { documentRequiresRetention, importRequiresRetention } from './retention-payload.mjs'
import { managedPathKey } from './managed-path.mjs'

const clone = value => structuredClone(value)
const now = () => new Date().toISOString()
const id = () => randomUUID().replaceAll('-', '')
const language = value => typeof value === 'string' && value !== 'auto' &&
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)
const required = (condition, message) => { if (!condition) throw new KernelError('INVALID_ARGUMENT', message) }
const missing = (kind, value) => { throw new KernelError('NOT_FOUND', `${kind} not found`, { [kind]: value }) }
const keyFor = (unitId, targetLang) => `${unitId}\u0000${targetLang}`
const sourceIdentity = (format, language, units, chapters, resources) =>
  digest({ format, language, units, chapters, resources })
const activeTask = state => ['queued', 'running', 'paused'].includes(state)
const taskSchema = z.object({
  id: z.string(), kind: z.literal('translate'), docId: z.string(), targetLang: z.string(),
  mode: z.enum(['fast', 'careful']), unitIds: z.array(z.string()),
  state: z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'canceled', 'abandoned']),
  progress: z.object({ stage: z.string(), done: z.number(), total: z.number() }),
  cursor: z.number(), checkpoints: z.array(z.object({ unitId: z.string(), revisionId: z.string(), reused: z.boolean(),
    tokens: z.object({ input: z.number().nullable(), output: z.number().nullable() }).optional() })),
  stats: z.object({ stageDurationsMs: z.record(z.string(), z.number()), llmCalls: z.number(),
    reusedUnits: z.number(), reuseRatio: z.number(), tokens: z.record(z.string(),
      z.object({ input: z.number().nullable(), output: z.number().nullable() })) }),
  artifacts: z.array(z.unknown()), createdAt: z.string(), updatedAt: z.string(),
  warnings: z.array(z.string()).optional(),
  profileId: z.string().optional(), error: z.object({ stage: z.string(), unitId: z.string().optional(), message: z.string(), traceId: z.string().optional() }).optional(),
})
const operationTaskSchema = taskSchema.omit({ mode: true, unitIds: true, checkpoints: true, profileId: true })
  .extend({ kind: z.enum(['import', 'export']), targetLang: z.string().optional(),
    adapterId: z.string().optional(), adapterVersion: z.string().optional(),
    snapshotId: z.string().optional(), outputs: z.array(z.object({ format: z.string(), adapterId: z.string().optional(),
      adapterVersion: z.string().optional(),
      out: z.string().optional() })).optional() })
const defaultConstraints = (units, index) => ({
  effectiveContext: { before: units[index - 1]?.sourceText ?? null, after: units[index + 1]?.sourceText ?? null },
  effectiveTarget: { purpose: 'scientific translation', style: 'faithful' },
  termConstraintSetId: 'none',
})
function assertJson(value, path = '$', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || seen.has(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
    throw new KernelError('INVALID_ARGUMENT', `Value at ${path} is not JSON data`)
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertJson(item, `${path}[${index}]`, seen)
  } else {
    for (const [key, item] of Object.entries(value)) assertJson(item, `${path}.${key}`, seen)
  }
  seen.delete(value)
}
const generic = z.record(z.string(), z.unknown())
const recordSchema = z.object({
  document: z.object({ id: z.string(), sourceId: z.string(), format: z.string().min(1), language: z.string(),
    title: z.string(), origin: z.enum(['manual', 'zotero', 'cli', 'mcp']), externalRef: z.string().optional(), unitCount: z.number(),
    translatableCount: z.number(), availableOutputs: z.array(z.string()), importedAt: z.string(),
    sourceAdapterId: z.string().optional(), sourceAdapterVersion: z.string().optional(),
    bindingSchemaVersion: z.number().int().optional(),
    warnings: z.array(z.string()).optional(), sourceCoverage: generic.optional() }),
  schemaVersion: z.number().int().optional(), sourceIR: generic.optional(),
  fingerprint: z.string(), sourceBinding: generic, sourceBindingRef: z.string(),
  sourceBindingDigest: z.string().optional(),
  resourceVersions: z.record(z.string(), z.string()),
  units: z.array(z.object({ id: z.string(), docId: z.string(), order: z.number(), kind: z.enum(['heading', 'body', 'caption', 'formula', 'code', 'reference', 'other']),
    sourceText: z.string(), context: z.string().optional(), locator: generic.optional(), translatable: z.boolean() })),
  revisions: z.array(z.object({ id: z.string(), unitId: z.string(), targetLang: z.string(), text: z.string(),
    origin: z.enum(['human', 'machine', 'imported']), modelId: z.string().optional(), promptVersion: z.string().optional(),
    reuseKey: z.string(), basis: generic, createdAt: z.string() })),
  latest: z.record(z.string(), z.string()), accepted: z.record(z.string(), z.string()),
  constraints: z.record(z.string(), generic), snapshots: z.array(z.object({ id: z.string(), docId: z.string(),
    contentMode: z.enum(['source', 'accepted-translation']).optional(), targetLang: z.string().optional(),
    sourceBindingRef: z.string(), resourceVersions: z.record(z.string(), z.string()),
    items: z.array(z.object({ unitId: z.string(), decision: z.discriminatedUnion('type', [
      z.object({ type: z.literal('revision'), revisionId: z.string() }),
      z.object({ type: z.literal('skip') }), z.object({ type: z.literal('keepOriginal') }),
      z.object({ type: z.literal('source') }),
    ]) })), revisionSetHash: z.string(), createdAt: z.string() })),
  artifacts: z.array(z.object({ id: z.string(), docId: z.string(), contentMode: z.enum(['source', 'accepted-translation']).optional(),
    targetLang: z.string().optional(), format: z.string(), adapterId: z.string().optional(),
    adapterVersion: z.string().optional(),
    path: z.string(), snapshotId: z.string(), revisionSetHash: z.string(), createdAt: z.string(),
    warnings: z.array(z.string()).optional(),
    taskId: z.string().optional(), outputIndex: z.number().optional(), managedFile: z.boolean().optional(),
    fileDigest: z.string().optional() })),
  artifactCleanup: z.array(z.object({ artifactId: z.string(), snapshotId: z.string(), path: z.string(), managedFile: z.literal(true),
    fileDigest: z.string(), state: z.enum(['pending', 'failed']), createdAt: z.string(), error: z.string().optional() })).optional(),
  tasks: z.array(taskSchema).optional(),
  operationTasks: z.array(operationTaskSchema).optional(),
})
const importTaskSchema = operationTaskSchema.omit({ docId: true }).extend({ kind: z.literal('import'),
  docId: z.string().optional(), preparedDocId: z.string().optional(), label: z.string(), result: generic.optional(),
  schemaVersion: z.number().int().optional() })
const spec = version => StorageDomain.defineDomain({ name: 'ivoraige_records', version, layout: 'per-record',
  tables: { documents: StorageDomain.domainTable(recordSchema), imports: StorageDomain.domainTable(importTaskSchema) } })

export class Records {
  static inject = ['storageDomain']

  constructor(ctx, { storageVersion = 2, activateRetention } = {}) {
    if (![1, 2].includes(storageVersion) ||
        (storageVersion === 1 && typeof activateRetention !== 'function') ||
        (activateRetention !== undefined && typeof activateRetention !== 'function')) {
      throw new KernelError('INVALID_ARGUMENT', 'Records storage version and retention activation are invalid')
    }
    this.ctx = ctx
    this.activateRetention = activateRetention ?? (() => {})
    this.leases = new Map()
    this.artifactLeases = new Map()
    this.deletingArtifacts = new Set()
    this.deletingPaths = new Set()
    this.pendingArtifactPaths = new Map()
    this.reuse = new Map()
    this.imports = new Map()
    this.ready = ctx.get('storageDomain').open(spec(storageVersion)).then(domain => {
      this.domain = domain
      this.table = domain.table('documents')
      this.importTable = domain.table('imports')
      for (const [docId, record] of this.table.entries()) this.indexAccepted(docId, record)
    })
  }

  async [Service.init]() {
    await this.ready
    // Unregistering the service awaits injected dependents before the domain closes.
    // Both disposers belong to one effect because Cordis unloads sibling effects concurrently.
    this.ctx.effect(function* () {
      yield () => this.domain.close()
      yield this.ctx.reflect.provide('ivoraige.records', this)
    }.bind(this), 'ivoraige.records lifecycle')
  }

  requireReady() { if (!this.table) throw new KernelError('INTERNAL', 'Records service is not ready') }
  validateTranslation(record, unit, text) {
    const parse = this.ctx.get('ivoraige.parse')
    if (!parse) throw new KernelError('COMPONENT_MISSING', 'Source validation adapter is unavailable')
    parse.validateTranslation(record.sourceBinding, unit, text, record.document)
  }
  record(docId) { this.requireReady(); return this.table.get(docId) ?? missing('docId', docId) }
  async update(docId, transform) {
    this.record(docId)
    return this.table.update(docId, current => {
      if (![1, 2, 3].includes(current.schemaVersion ?? 1) ||
          (current.sourceIR && current.sourceIR.version !== 1)) throw new KernelError('PRECONDITION_FAILED',
        'Record schema or source IR version is unsupported',
        { schemaVersion: current.schemaVersion, sourceIRVersion: current.sourceIR?.version })
      let next = transform(current)
      if ((current.schemaVersion ?? 1) === 1) {
        const units = current.units.map(({ id: unitId, docId: owner, ...unit }) => unit)
        const binding = current.sourceBinding
        const reconstructable = (current.document.format === 'txt' && binding?.adapterId === 'txt' &&
          Object.keys(binding).length === 1) ||
          (current.document.format === 'md' && binding?.adapterId === 'markdown' &&
            typeof binding.raw === 'string' && Array.isArray(binding.spans))
        next = { ...next, schemaVersion: next.schemaVersion === 3 ? 3 : 2, sourceIR: next.sourceIR ?? { version: 1, legacy: true,
          identityScope: reconstructable ? 'reconstructed-text' : 'approximate-legacy',
          identity: reconstructable
            ? sourceIdentity(current.document.format, current.document.language, units, [], [])
            : digest({ format: current.document.format, language: current.document.language, units }) } }
      }
      assertJson(next)
      recordSchema.parse(next)
      if (documentRequiresRetention(next)) this.activateRetention()
      return next
    })
  }
  locateOwned(collections, key, value, expectedDocId) {
    this.requireReady()
    let found
    for (const [docId, record] of this.table.entries()) {
      for (const collection of collections) {
        const item = (record[collection] ?? []).find(row => row.id === value)
        if (!item) continue
        if (found) throw new KernelError('CONFLICT', 'Resource identity is ambiguous', { [key]: value })
        found = { docId, record, item }
      }
    }
    if (!found || (expectedDocId !== undefined && found.docId !== expectedDocId)) missing(key, value)
    return found
  }
  locateUnit(unitId, { docId: expectedDocId } = {}) {
    const { docId, record, item: unit } = this.locateOwned(['units'], 'unitId', unitId, expectedDocId)
    return { docId, record, unit }
  }
  locateRevision(revisionId) {
    const { docId, record, item: revision } = this.locateOwned(['revisions'], 'revisionId', revisionId)
    return { docId, record, revision }
  }
  locateTask(taskId) {
    this.requireReady()
    const imported = this.importTable.get(taskId)
    if (imported) return { docId: imported.docId, task: imported, importTask: true }
    const { docId, record, item: task } = this.locateOwned(['tasks', 'operationTasks'], 'taskId', taskId)
    return { docId, record, task, importTask: false }
  }
  locateArtifact(artifactId, { docId: expectedDocId } = {}) {
    const { docId, record, item: artifact } = this.locateOwned(['artifacts'], 'artifactId', artifactId, expectedDocId)
    return { docId, record, artifact }
  }
  constraintsFor(record, unit, targetLang) {
    return record.constraints[keyFor(unit.id, targetLang)] ?? defaultConstraints(record.units, unit.order)
  }
  basis(record, unit, targetLang) {
    return basisFor({ ...record.document, sourceBinding: record.sourceBinding,
      sourceBindingDigest: record.sourceBindingDigest }, unit, targetLang,
      this.constraintsFor(record, unit, targetLang))
  }
  applicable(record, unit, revision) {
    return sameBasis(revision.basis, this.basis(record, unit, revision.targetLang))
  }
  viewRevision(record, revision) {
    const accepted = record.accepted[keyFor(revision.unitId, revision.targetLang)]
    const latest = record.latest[keyFor(revision.unitId, revision.targetLang)]
    const { basis, ...publicRevision } = revision
    return clone({ ...publicRevision, status: accepted === revision.id ? 'accepted' :
      latest === revision.id ? 'draft' : 'superseded' })
  }
  viewUnit(record, unit, targetLang) {
    const key = keyFor(unit.id, targetLang)
    return clone({ ...unit, targetLang, ...(record.accepted[key] ? { acceptedRevisionId: record.accepted[key] } : {}),
      ...(record.latest[key] && record.latest[key] !== record.accepted[key] ? { draftRevisionId: record.latest[key] } : {}) })
  }
  indexAccepted(docId, record) {
    for (const candidates of this.reuse.values()) for (const candidate of [...candidates]) {
      if (candidate.docId === docId) candidates.delete(candidate)
    }
    for (const revisionId of Object.values(record.accepted)) {
      const revision = record.revisions.find(item => item.id === revisionId)
      if (!revision) continue
      const candidate = { docId, revisionId }
      if (!this.reuse.has(revision.reuseKey)) this.reuse.set(revision.reuseKey, new Set())
      this.reuse.get(revision.reuseKey).add(candidate)
    }
  }

  importDocument(file, metadata, options) {
    const importer = this.ctx.get('ivoraige.import')
    if (!importer) throw new KernelError('COMPONENT_MISSING', 'Import coordinator is unavailable')
    return importer.importDocument(file, metadata, options)
  }
  referencesSourcePath(sourcePath) {
    this.requireReady()
    return [...this.table.keys()].some(docId => this.table.get(docId)?.sourceBinding?.sourcePath === sourcePath)
  }
  async persistParsed(file, { sourceId, language: sourceLang, origin, externalRef }, parsed, { taskId } = {}) {
    await this.ready
    {
      required(typeof parsed.format === 'string' && parsed.format, 'Parsed format required')
      assertJson(parsed)
      const resources = parsed.resources ?? []
      required(Array.isArray(resources) && resources.every(resource => resource &&
        typeof resource.id === 'string' && resource.id &&
        typeof resource.contentDigest === 'string' && /^[a-f0-9]{64}$/.test(resource.contentDigest) &&
        typeof resource.version === 'string' && resource.version),
      'Resources require id, contentDigest and version')
      required(new Set(resources.map(resource => resource.id)).size === resources.length,
        'Resource ids must be unique')
      const businessSourceId = sourceId ?? (file.path ? `path:${file.path}` : `manual:${id()}`)
      const fingerprint = digest({ format: parsed.format, language: sourceLang, units: parsed.units,
        chapters: parsed.chapters, resources: parsed.resources, sourceBinding: parsed.sourceBinding })
      const legacyDocId = digest({ sourceId: businessSourceId, fingerprint }).slice(0, 32)
      // Keep the established content fingerprint unchanged. Versioned parses
      // receive a separate document namespace so replacing an implementation
      // cannot silently deduplicate against its older private binding contract.
      const docId = parsed.sourceAdapterVersion && parsed.sourceAdapterVersion !== 'unversioned'
        ? digest({ sourceId: businessSourceId, fingerprint, sourceAdapterId: parsed.sourceAdapterId,
          sourceAdapterVersion: parsed.sourceAdapterVersion,
          bindingSchemaVersion: parsed.bindingSchemaVersion }).slice(0, 32) : legacyDocId
      // A pre-P03 record has no implementation provenance; preserve its old
      // idempotent reimport identity rather than silently rewriting that record.
      const legacy = this.table.get(legacyDocId)
      const retainedLegacy = legacy && !legacy.document.sourceAdapterVersion
      const destination = retainedLegacy ? legacyDocId : docId
      // Persist the deterministic destination before inserting the document, so
      // startup can reconcile a crash between document commit and task completion.
      if (taskId) await this.updateTask(taskId, task => ({ ...task, preparedDocId: destination }))
      file.signal?.throwIfAborted()
      if (retainedLegacy) return { document: clone(legacy.document), deduplicated: true }
      const existing = this.table.get(docId)
      if (existing) return { document: clone(existing.document), deduplicated: true }
      const pending = this.imports.get(docId)
      if (pending) {
        const document = await pending
        return { document: clone(document), deduplicated: true }
      }
      const operation = this.insertDocument(docId, businessSourceId, sourceLang, origin, externalRef, fingerprint, parsed)
      this.imports.set(docId, operation)
      try { return { document: clone(await operation), deduplicated: false } }
      finally { this.imports.delete(docId) }
    }
  }
  async insertDocument(docId, businessSourceId, sourceLang, origin, externalRef, fingerprint, parsed) {
    const units = parsed.units.map((unit, order) => ({ ...clone(unit), id: `${docId}.${order.toString(36)}`,
      docId, order }))
    const document = { id: docId, sourceId: businessSourceId, format: parsed.format, language: sourceLang,
      title: parsed.title, origin, ...(externalRef === undefined ? {} : { externalRef }),
      unitCount: units.length, translatableCount: units.filter(unit => unit.translatable).length,
      availableOutputs: clone(parsed.availableOutputs), importedAt: now(),
      sourceAdapterId: parsed.sourceAdapterId, sourceAdapterVersion: parsed.sourceAdapterVersion,
      bindingSchemaVersion: parsed.bindingSchemaVersion,
      ...(parsed.warnings?.length ? { warnings: clone(parsed.warnings) } : {}),
      ...(parsed.sourceCoverage ? { sourceCoverage: clone(parsed.sourceCoverage) } : {}) }
    const resources = (parsed.resources ?? []).map(resource => Object.fromEntries(
      ['id', 'mediaType', 'contentDigest', 'version'].filter(key => resource[key] !== undefined)
        .map(key => [key, resource[key]])))
    const sourceIR = { version: 1, units: clone(parsed.units), chapters: clone(parsed.chapters ?? []),
      resources: clone(resources), identity: sourceIdentity(parsed.format, sourceLang,
        parsed.units, parsed.chapters ?? [], resources) }
    const record = { schemaVersion: 2, sourceIR, document, fingerprint, sourceBinding: clone(parsed.sourceBinding),
      sourceBindingRef: digest({ docId, fingerprint, binding: parsed.sourceBinding }),
      sourceBindingDigest: digest(parsed.sourceBinding),
      resourceVersions: Object.fromEntries(resources.map(resource => [resource.id,
        `${resource.version}:${resource.contentDigest}`])), units, revisions: [],
      latest: {}, accepted: {}, constraints: {}, snapshots: [], artifacts: [], tasks: [] }
    assertJson(record)
    recordSchema.parse(record)
    await this.table.put(docId, record)
    return clone(this.table.get(docId).document)
  }

  getDocument(docId) {
    const record = this.record(docId)
    return clone({ ...record.document,
      availableOutputs: this.ctx.get('ivoraige.outputs')?.availableFor(record.sourceBinding) ?? [] })
  }
  listDocuments() { this.requireReady(); return [...this.table.keys()].map(docId => this.getDocument(docId)) }
  listUnits(docId, { targetLang } = {}) {
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    const record = this.record(docId)
    return record.units.map(unit => this.viewUnit(record, unit, targetLang))
  }
  getUnit(unitId, { targetLang, docId } = {}) {
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    const { record, unit } = this.locateUnit(unitId, { docId })
    const key = keyFor(unitId, targetLang)
    const accepted = record.revisions.find(r => r.id === record.accepted[key])
    const draft = record.revisions.find(r => r.id === record.latest[key] && r.id !== record.accepted[key])
    return { unit: this.viewUnit(record, unit, targetLang),
      ...(accepted ? { accepted: this.viewRevision(record, accepted) } : {}),
      ...(draft ? { draft: this.viewRevision(record, draft) } : {}) }
  }
  listRevisions(unitId, { targetLang } = {}) {
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    const { record } = this.locateUnit(unitId)
    return record.revisions.filter(r => r.unitId === unitId && r.targetLang === targetLang)
      .map(r => this.viewRevision(record, r))
  }
  getBasis(unitId, { targetLang } = {}) {
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    const { record, unit } = this.locateUnit(unitId)
    return clone(this.basis(record, unit, targetLang))
  }
  findReusable(unitId, { targetLang } = {}) {
    const basis = this.getBasis(unitId, { targetLang })
    const { record: local, unit } = this.locateUnit(unitId)
    const localAccepted = local.revisions.find(revision =>
      revision.id === local.accepted[keyFor(unitId, targetLang)])
    if (localAccepted && sameBasis(localAccepted.basis, basis) &&
      this.applicable(local, unit, localAccepted)) return this.viewRevision(local, localAccepted)
    const candidates = this.reuse.get(basis.reuseKey) ?? []
    for (const { docId, revisionId } of candidates) {
      const record = this.table.get(docId)
      const revision = record?.revisions.find(r => r.id === revisionId)
      const sourceUnit = record?.units.find(item => item.id === revision?.unitId)
      if (revision && sourceUnit && record.accepted[keyFor(revision.unitId, revision.targetLang)] === revisionId &&
          sameBasis(revision.basis, basis) && this.applicable(record, sourceUnit, revision)) {
        return this.viewRevision(record, revision)
      }
    }
    return null
  }

  async createTranslationTask(docId, { targetLang, unitIds, mode = 'fast', profileId } = {}) {
    await this.ready
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    required(['fast', 'careful'].includes(mode), 'Invalid translation mode')
    required(profileId === undefined, 'Translation profiles are deferred')
    required(unitIds === undefined || (Array.isArray(unitIds) &&
      unitIds.every(unitId => typeof unitId === 'string') && new Set(unitIds).size === unitIds.length),
    'unitIds must be a unique string array')
    let created
    await this.update(docId, current => {
      const existing = (current.tasks ?? []).find(task => task.kind === 'translate' && activeTask(task.state))
      if (existing) throw new KernelError('CONFLICT', 'Translation task already active', { taskId: existing.id })
      const selected = unitIds ?? current.units.filter(unit => unit.translatable).map(unit => unit.id)
      required(selected.every(unitId => current.units.some(unit => unit.id === unitId && unit.translatable)),
        'unitIds must identify translatable units in the document')
      // Source order makes a cursor meaningful even when callers supply an unordered subset.
      const ordered = current.units.filter(unit => selected.includes(unit.id)).map(unit => unit.id)
      const timestamp = now()
      created = { id: `${docId}.${id()}`, kind: 'translate', docId, targetLang, mode,
        unitIds: ordered, state: 'queued',
        progress: { stage: 'translate', done: 0, total: ordered.length }, cursor: 0,
        checkpoints: [], stats: { stageDurationsMs: {}, llmCalls: 0, reusedUnits: 0,
          reuseRatio: 0, tokens: { translation: { input: null, output: null } } },
        artifacts: [], createdAt: timestamp, updatedAt: timestamp }
      return { ...current, tasks: [...(current.tasks ?? []), created] }
    })
    return clone(created)
  }
  getTask(taskId) {
    return clone(this.locateTask(taskId).task)
  }
  listTasks({ docId } = {}) {
    this.requireReady()
    const records = docId === undefined ? [...this.table.entries()].map(([, record]) => record) : [this.record(docId)]
    return clone([...records.flatMap(record => [...(record.tasks ?? []), ...(record.operationTasks ?? [])]),
      ...[...this.importTable.entries()].map(([, task]) => task).filter(task => docId === undefined || task.docId === docId)])
  }
  async createImportTask(label, adapter) {
    const stamp = now()
    const task = { id: `import.${id()}`, kind: 'import', label, state: 'queued',
      ...(adapter ? { adapterId: adapter.id, adapterVersion: adapter.version ?? 'unversioned' } : {}),
      progress: { stage: 'import', done: 0, total: 1 }, cursor: 0,
      stats: { stageDurationsMs: {}, llmCalls: 0, reusedUnits: 0, reuseRatio: 0, tokens: {} },
      artifacts: [], createdAt: stamp, updatedAt: stamp }
    importTaskSchema.parse(task)
    await this.importTable.put(task.id, task)
    return clone(task)
  }
  async recoverImportTask(taskId) {
    return this.updateTask(taskId, task => {
      const stored = task.preparedDocId ? this.table.get(task.preparedDocId) : null
      if (!stored) return { ...task, state: 'failed',
        error: { stage: 'import', message: 'Import interrupted; submit the source again' } }
      const document = this.getDocument(task.preparedDocId)
      return { ...task, state: 'succeeded', docId: document.id, cursor: 1,
        progress: { stage: 'complete', done: 1, total: 1 },
        result: { document, deduplicated: true, recovered: true, warnings: document.warnings ?? [] } }
    })
  }
  async createOperationTask(docId, { kind, targetLang, snapshotId, outputs, durationMs = 0,
    sourceAdapter } = {}) {
    required(['import', 'export'].includes(kind), 'Unsupported operation task')
    let task
    await this.update(docId, current => {
      const tasks = current.operationTasks ?? []
      const conflict = tasks.find(task => task.kind === kind && activeTask(task.state))
      if (conflict) throw new KernelError('CONFLICT', 'Operation already active', { taskId: conflict.id })
      if (kind === 'export') {
        required((targetLang === undefined || language(targetLang)) && Array.isArray(outputs) && outputs.length > 0,
          'Export parameters required')
        const snapshot = current.snapshots.find(item => item.id === snapshotId)
        required(snapshot && snapshot.targetLang === targetLang, 'Matching export snapshot required')
        if (this.leases.get(`${docId}\u0000${snapshotId}`) === -1 ||
            this.deletingArtifacts.has(`${docId}\u0000${snapshotId}`) ||
            (current.artifactCleanup ?? []).some(item => item.snapshotId === snapshotId))
          throw new KernelError('CONFLICT', 'Export snapshot is being deleted or cleaned up', { snapshotId })
      }
      const stamp = now()
      task = { id: `${docId}.${id()}`, kind, docId, state: kind === 'import' ? 'succeeded' : 'queued',
        ...(kind === 'import' && (sourceAdapter?.id ?? current.document.sourceAdapterId) ?
          { adapterId: sourceAdapter?.id ?? current.document.sourceAdapterId,
            adapterVersion: sourceAdapter?.version ?? current.document.sourceAdapterVersion ?? 'unversioned' } : {}),
        ...(targetLang ? { targetLang } : {}), ...(snapshotId ? { snapshotId, outputs: clone(outputs) } : {}),
        progress: { stage: kind === 'import' ? 'complete' : 'export', done: kind === 'import' ? 1 : 0,
          total: kind === 'import' ? 1 : outputs.length }, cursor: kind === 'import' ? 1 : 0,
        stats: { stageDurationsMs: kind === 'import' ? { import: durationMs } : {}, llmCalls: 0,
          reusedUnits: 0, reuseRatio: 0, tokens: {} }, artifacts: [], createdAt: stamp, updatedAt: stamp }
      return { ...current, operationTasks: [...tasks, task] }
    })
    return clone(task)
  }
  validateTaskCheckpoints(taskId) {
    const task = this.getTask(taskId)
    const record = this.record(task.docId)
    for (const checkpoint of task.checkpoints) {
      const unit = record.units.find(item => item.id === checkpoint.unitId)
      const revision = record.revisions.find(item => item.id === checkpoint.revisionId)
      if (!unit || !revision || revision.unitId !== checkpoint.unitId ||
        revision.targetLang !== task.targetLang || !this.applicable(record, unit, revision)) {
        throw new KernelError('PRECONDITION_FAILED', 'Completed task unit is no longer applicable',
          { taskId, unitId: checkpoint.unitId, revisionId: checkpoint.revisionId })
      }
    }
    return true
  }
  async updateTask(taskId, transform) {
    await this.ready
    if (this.locateTask(taskId).importTask) {
      this.getTask(taskId)
      const updated = await this.importTable.update(taskId, current => {
        if (![1, 3].includes(current.schemaVersion ?? 1)) throw new KernelError('PRECONDITION_FAILED',
          'Import task schema version is unsupported', { schemaVersion: current.schemaVersion })
        const next = { ...transform(clone(current)), updatedAt: now() }
        if (next.state === 'abandoned') next.schemaVersion = 3
        required(next.id === current.id && next.kind === 'import', 'Import task identity is immutable')
        assertJson(next)
        importTaskSchema.parse(next)
        if (importRequiresRetention(next)) this.activateRetention()
        return next
      })
      return clone(updated)
    }
    await this.ready
    required(typeof transform === 'function', 'Task transform must be a function')
    const { docId } = this.locateTask(taskId)
    let updated
    await this.update(docId, current => {
      const operation = (current.operationTasks ?? []).find(task => task.id === taskId)
      if (operation) {
        updated = transform(clone(operation))
        for (const key of ['id', 'docId', 'kind', 'targetLang', 'snapshotId', 'outputs', 'cursor', 'artifacts']) {
          required(JSON.stringify(updated[key]) === JSON.stringify(operation[key]), 'Operation identity and checkpoints are immutable')
        }
        updated.updatedAt = now()
        const conflict = (current.operationTasks ?? []).find(task => task.id !== taskId &&
          task.kind === operation.kind && activeTask(task.state))
        if (activeTask(updated.state) && conflict) throw new KernelError('CONFLICT', 'Operation already active', { taskId: conflict.id })
        return { ...current, ...(updated.state === 'abandoned' ? { schemaVersion: 3 } : {}),
          operationTasks: current.operationTasks.map(task => task.id === taskId ? updated : task) }
      }
      const tasks = current.tasks ?? []
      const index = tasks.findIndex(task => task.id === taskId)
      if (index < 0) missing('taskId', taskId)
      updated = transform(clone(tasks[index]))
      required(updated && updated.id === taskId && updated.docId === docId &&
        updated.kind === 'translate' && updated.targetLang === tasks[index].targetLang &&
        updated.mode === tasks[index].mode && updated.profileId === tasks[index].profileId &&
        updated.cursor === tasks[index].cursor &&
        updated.unitIds.length === tasks[index].unitIds.length &&
        updated.unitIds.every((value, i) => value === tasks[index].unitIds[i]) &&
        JSON.stringify(updated.checkpoints) === JSON.stringify(tasks[index].checkpoints) &&
        updated.progress.done === tasks[index].cursor,
      'Task identity and cursor are immutable outside commitTaskUnit')
      if (activeTask(updated.state) && tasks.some((task, i) => i !== index && activeTask(task.state))) {
        throw new KernelError('CONFLICT', 'Translation task already active',
          { taskId: tasks.find((task, i) => i !== index && activeTask(task.state)).id })
      }
      updated.updatedAt = now()
      return { ...current, ...(updated.state === 'abandoned' ? { schemaVersion: 3 } : {}),
        tasks: tasks.map((task, i) => i === index ? updated : task) }
    })
    return clone(updated)
  }
  async incrementTaskCall(taskId) {
    return this.updateTask(taskId, task => {
      if (task.state !== 'running') throw new KernelError('CONFLICT', 'Task is not running', { taskId })
      const llmCalls = task.stats.llmCalls + 1
      return { ...task, stats: { ...task.stats, llmCalls,
        reuseRatio: task.stats.reusedUnits / (task.stats.reusedUnits + llmCalls),
        tokens: { ...task.stats.tokens, translation: { input: null, output: null } } } }
    })
  }
  async commitTaskUnit(taskId, { unitId, expectedBasis, baseRevisionId, expectedAcceptedRevisionId,
    result, reusedRevisionId } = {}) {
    await this.ready
    required((result === undefined) !== (reusedRevisionId === undefined),
      'Exactly one of result or reusedRevisionId is required')
    required(baseRevisionId === null || typeof baseRevisionId === 'string', 'baseRevisionId is required')
    required(expectedAcceptedRevisionId === null || typeof expectedAcceptedRevisionId === 'string',
      'expectedAcceptedRevisionId is required')
    required(expectedBasis && typeof expectedBasis === 'object', 'expectedBasis is required')
    if (result !== undefined) {
      required(result && typeof result.text === 'string' && result.text.trim(), 'Translation text must be nonempty')
      required(result.modelId === undefined || typeof result.modelId === 'string', 'Invalid modelId')
      required(result.promptVersion === undefined || typeof result.promptVersion === 'string', 'Invalid promptVersion')
      if (result.tokens !== undefined) required(result.tokens &&
        ['input', 'output'].every(key => result.tokens[key] === null ||
          (Number.isSafeInteger(result.tokens[key]) && result.tokens[key] >= 0)), 'Invalid token usage')
    }
    const { docId } = this.locateTask(taskId)
    let committed, revision
    const next = await this.update(docId, current => {
      const tasks = current.tasks ?? []
      const taskIndex = tasks.findIndex(task => task.id === taskId)
      if (taskIndex < 0) missing('taskId', taskId)
      const task = tasks[taskIndex]
      if (task.state !== 'running') throw new KernelError('CONFLICT', 'Task is not running', { taskId })
      if (task.unitIds[task.cursor] !== unitId) throw new KernelError('CONFLICT', 'Task cursor changed',
        { taskId, cursor: task.cursor })
      const unit = current.units.find(item => item.id === unitId) ?? missing('unitId', unitId)
      const basis = this.basis(current, unit, task.targetLang)
      if (result) this.validateTranslation(current, unit, result.text)
      if (!sameBasis(expectedBasis, basis)) throw new KernelError('PRECONDITION_FAILED',
        'Translation basis changed', { unitId })
      const key = keyFor(unitId, task.targetLang)
      const latestId = current.latest[key] ?? null
      const acceptedId = current.accepted[key] ?? null
      if (latestId !== baseRevisionId || acceptedId !== expectedAcceptedRevisionId) {
        throw new KernelError('CONFLICT', 'Revision changed during translation',
          { latestRevisionId: latestId, acceptedRevisionId: acceptedId })
      }
      let textValue, origin = 'machine', modelId, promptVersion, reused = false, sameUnit = false
      if (result) ({ text: textValue, modelId, promptVersion } = result)
      else {
        const source = [...this.table.entries()].find(([, row]) => row.revisions.some(item => item.id === reusedRevisionId))
        const sourceDocId = source?.[0]
        const sourceRecord = sourceDocId === docId ? current : source?.[1]
        const candidate = sourceRecord?.revisions.find(item => item.id === reusedRevisionId)
        if (!candidate || sourceRecord.accepted[keyFor(candidate.unitId, candidate.targetLang)] !== candidate.id ||
          !sameBasis(candidate.basis, basis) || !this.applicable(sourceRecord,
            sourceRecord.units.find(item => item.id === candidate.unitId), candidate)) {
          throw new KernelError('PRECONDITION_FAILED', 'Reusable revision is no longer applicable',
            { revisionId: reusedRevisionId })
        }
        textValue = candidate.text; origin = candidate.origin; modelId = candidate.modelId
        promptVersion = candidate.promptVersion; reused = true
        sameUnit = sourceDocId === docId && candidate.unitId === unitId
      }
      revision = sameUnit ? current.revisions.find(item => item.id === reusedRevisionId) :
        { id: `${docId}.${unit.order.toString(36)}.${id()}`, unitId, targetLang: task.targetLang,
        text: textValue, origin, ...(modelId ? { modelId } : {}),
        ...(promptVersion ? { promptVersion } : {}), reuseKey: basis.reuseKey, basis, createdAt: now() }
      const stats = clone(task.stats)
      if (reused) stats.reusedUnits++
      else {
        const usage = result.tokens ?? { input: null, output: null }
        const successfulCallsBefore = task.checkpoints.filter(checkpoint => !checkpoint.reused).length
        const unaccountedAttempt = stats.llmCalls !== successfulCallsBefore + 1
        for (const token of ['input', 'output']) {
          const prior = task.checkpoints.filter(checkpoint => !checkpoint.reused)
            .map(checkpoint => checkpoint.tokens?.[token] ?? null)
          stats.tokens.translation[token] = unaccountedAttempt || usage[token] === null ||
            prior.some(value => value === null) ? null : prior.reduce((sum, value) => sum + value, usage[token])
        }
      }
      stats.reuseRatio = stats.reusedUnits / (stats.reusedUnits + stats.llmCalls) || 0
      committed = { ...task, cursor: task.cursor + 1,
        progress: { ...task.progress, done: task.cursor + 1 },
        checkpoints: [...task.checkpoints, { unitId, revisionId: revision.id, reused,
          ...(!reused ? { tokens: result.tokens ?? { input: null, output: null } } : {}) }],
        stats, updatedAt: now() }
      return { ...current, revisions: sameUnit ? current.revisions : [...current.revisions, revision],
        latest: sameUnit ? current.latest : { ...current.latest, [key]: revision.id },
        accepted: sameUnit || task.mode !== 'fast' ? current.accepted :
          { ...current.accepted, [key]: revision.id },
        tasks: tasks.map((item, index) => index === taskIndex ? committed : item) }
    })
    if (committed.mode === 'fast') this.indexAccepted(docId, next)
    return { task: clone(committed), revision: this.viewRevision(next, revision), reused: committed.checkpoints.at(-1).reused }
  }

  async writeRevision(unitId, { targetLang, text, baseRevisionId, origin = 'human', modelId, promptVersion } = {}) {
    await this.ready
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    required(typeof text === 'string' && text.trim(), 'text must be nonempty')
    required(Object.hasOwn(arguments[1] ?? {}, 'baseRevisionId') &&
      (baseRevisionId === null || typeof baseRevisionId === 'string'), 'baseRevisionId is required')
    required(['human', 'machine', 'imported'].includes(origin), 'Invalid revision origin')
    required(modelId === undefined || typeof modelId === 'string', 'modelId must be a string')
    required(promptVersion === undefined || typeof promptVersion === 'string', 'promptVersion must be a string')
    const { docId } = this.locateUnit(unitId)
    let created
    const next = await this.update(docId, current => {
      const unit = current.units.find(u => u.id === unitId) ?? missing('unitId', unitId)
      required(unit.translatable, 'Unit is not translatable')
      this.validateTranslation(current, unit, text)
      const key = keyFor(unitId, targetLang)
      const latestId = current.latest[key] ?? null
      if (baseRevisionId !== latestId) throw new KernelError('CONFLICT', 'Latest revision changed',
        { latestRevision: current.revisions.find(r => r.id === latestId) ?
          this.viewRevision(current, current.revisions.find(r => r.id === latestId)) : null })
      const basis = this.basis(current, unit, targetLang)
      created = { id: `${docId}.${unit.order.toString(36)}.${id()}`, unitId, targetLang, text,
        origin, ...(modelId ? { modelId } : {}), ...(promptVersion ? { promptVersion } : {}),
        reuseKey: basis.reuseKey, basis, createdAt: now() }
      return { ...current, revisions: [...current.revisions, created], latest: { ...current.latest, [key]: created.id } }
    })
    return this.viewRevision(next, created)
  }
  async acceptRevision(revisionId, { expectedAcceptedRevisionId } = {}) {
    await this.ready
    required(Object.hasOwn(arguments[1] ?? {}, 'expectedAcceptedRevisionId') &&
      (expectedAcceptedRevisionId === null || typeof expectedAcceptedRevisionId === 'string'),
    'expectedAcceptedRevisionId is required')
    const { docId } = this.locateRevision(revisionId)
    let acceptedRevision
    const next = await this.update(docId, current => {
      const revision = current.revisions.find(r => r.id === revisionId) ?? missing('revisionId', revisionId)
      const key = keyFor(revision.unitId, revision.targetLang)
      const actual = current.accepted[key] ?? null
      if (actual !== expectedAcceptedRevisionId) throw new KernelError('CONFLICT', 'Accepted revision changed',
        { acceptedRevision: current.revisions.find(r => r.id === actual) ?
          this.viewRevision(current, current.revisions.find(r => r.id === actual)) : null })
      const unit = current.units.find(u => u.id === revision.unitId)
      this.validateTranslation(current, unit, revision.text)
      if (!this.applicable(current, unit, revision)) throw new KernelError('PRECONDITION_FAILED',
        'Revision is no longer applicable', { revisionId })
      acceptedRevision = revision
      return { ...current, accepted: { ...current.accepted, [key]: revisionId } }
    })
    this.indexAccepted(docId, this.table.get(docId))
    return this.viewRevision(next, acceptedRevision)
  }
  async unaccept(unitId, { targetLang, expectedAcceptedRevisionId } = {}) {
    await this.ready
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    required(Object.hasOwn(arguments[1] ?? {}, 'expectedAcceptedRevisionId') &&
      (expectedAcceptedRevisionId === null || typeof expectedAcceptedRevisionId === 'string'),
    'expectedAcceptedRevisionId is required')
    const { docId } = this.locateUnit(unitId)
    const next = await this.update(docId, current => {
      const key = keyFor(unitId, targetLang)
      const actual = current.accepted[key] ?? null
      if (actual !== expectedAcceptedRevisionId) throw new KernelError('CONFLICT', 'Accepted revision changed',
        { acceptedRevisionId: actual })
      const accepted = { ...current.accepted }; delete accepted[key]
      return { ...current, accepted }
    })
    this.indexAccepted(docId, this.table.get(docId))
    return { accepted: null }
  }
  async setConstraints(unitId, { targetLang, effectiveContext, effectiveTarget, termConstraintSetId } = {}) {
    await this.ready
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    required(effectiveContext !== undefined && effectiveTarget !== undefined &&
      typeof termConstraintSetId === 'string' && termConstraintSetId, 'Complete effective constraints required')
    const { docId } = this.locateUnit(unitId)
    assertJson({ effectiveContext, effectiveTarget, termConstraintSetId })
    const constraints = clone({ effectiveContext, effectiveTarget, termConstraintSetId })
    await this.update(docId, current => ({ ...current,
      constraints: { ...current.constraints, [keyFor(unitId, targetLang)]: constraints } }))
    return clone(constraints)
  }

  async createSnapshot(docId, { contentMode = 'accepted-translation', targetLang, onMissingAccepted = 'fail' } = {}) {
    await this.ready
    required(['source', 'accepted-translation'].includes(contentMode), 'Invalid contentMode')
    required(contentMode === 'source' ? targetLang === undefined : language(targetLang),
      contentMode === 'source' ? 'Source snapshot cannot have targetLang' : 'targetLang must be a real BCP-47 tag')
    required(contentMode !== 'source' || onMissingAccepted === 'fail', 'Source snapshot cannot use onMissingAccepted')
    required(['fail', 'skip'].includes(onMissingAccepted), 'Invalid onMissingAccepted')
    let snapshot
    await this.update(docId, current => {
      const items = current.units.map(unit => {
        if (contentMode === 'source') return { unitId: unit.id, decision: { type: 'source' } }
        if (!unit.translatable) return { unitId: unit.id, decision: { type: 'keepOriginal' } }
        const revisionId = current.accepted[keyFor(unit.id, targetLang)]
        const revision = current.revisions.find(r => r.id === revisionId)
        if (revision && this.applicable(current, unit, revision)) {
          return { unitId: unit.id, decision: { type: 'revision', revisionId } }
        }
        if (onMissingAccepted === 'skip') return { unitId: unit.id, decision: { type: 'skip' } }
        throw new KernelError('PRECONDITION_FAILED', 'Applicable accepted revision missing',
          { unitId: unit.id, targetLang })
      })
      snapshot = { id: `${docId}.${id()}`, docId, contentMode,
        ...(targetLang === undefined ? {} : { targetLang }), sourceBindingRef: current.sourceBindingRef,
        resourceVersions: clone(current.resourceVersions), items, revisionSetHash: digest(items), createdAt: now() }
      return { ...current, snapshots: [...current.snapshots, snapshot] }
    })
    return clone(snapshot)
  }
  getSnapshot(docId, snapshotId) {
    const snapshot = this.record(docId).snapshots.find(s => s.id === snapshotId) ?? missing('snapshotId', snapshotId)
    return clone(snapshot)
  }
  listSnapshots(docId, { targetLang } = {}) {
    const record = this.record(docId)
    if (targetLang !== undefined) required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    return clone(record.snapshots.filter(s => targetLang === undefined || s.targetLang === targetLang))
  }
  retainSnapshot(docId, snapshotId) {
    this.getSnapshot(docId, snapshotId)
    const key = `${docId}\u0000${snapshotId}`
    if (this.leases.get(key) === -1 || this.deletingArtifacts.has(key) ||
        this.record(docId).artifactCleanup?.some(item => item.snapshotId === snapshotId)) {
      throw new KernelError('CONFLICT', 'Snapshot deletion is in progress', { snapshotId })
    }
    this.leases.set(key, (this.leases.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.leases.get(key) ?? 0
      if (count <= 1) this.leases.delete(key)
      else this.leases.set(key, count - 1)
    }
  }
  async deleteSnapshot(docId, snapshotId) {
    await this.ready
    this.getSnapshot(docId, snapshotId)
    const key = `${docId}\u0000${snapshotId}`
    if (this.leases.has(key)) throw new KernelError('CONFLICT', 'Snapshot is in use', { snapshotId, inUse: true })
    // Reserve deletion before the durable write yields, so export cannot pin a stale view.
    this.leases.set(key, -1)
    try { await this.update(docId, current => {
      if (!current.snapshots.some(s => s.id === snapshotId)) missing('snapshotId', snapshotId)
      const artifactIds = current.artifacts.filter(a => a.snapshotId === snapshotId).map(a => a.id)
      const cleanupIds = (current.artifactCleanup ?? []).filter(a => a.snapshotId === snapshotId).map(a => a.artifactId)
      const taskIds = (current.operationTasks ?? []).filter(task => task.snapshotId === snapshotId &&
        ['queued', 'running', 'paused', 'failed'].includes(task.state)).map(task => task.id)
      if (taskIds.length) throw new KernelError('CONFLICT', 'Snapshot is retained by a resumable task', { snapshotId, taskIds })
      if (artifactIds.length) throw new KernelError('CONFLICT', 'Snapshot is in use',
        { snapshotId, artifactIds, inUse: false })
      if (cleanupIds.length) throw new KernelError('CONFLICT', 'Artifact file cleanup is pending',
        { snapshotId, artifactIds: cleanupIds })
      return { ...current, snapshots: current.snapshots.filter(s => s.id !== snapshotId) }
    }) } finally { this.leases.delete(key) }
  }
  resolveSnapshot(docId, snapshotId) {
    const record = this.record(docId)
    const snapshot = record.snapshots.find(s => s.id === snapshotId) ?? missing('snapshotId', snapshotId)
    if (snapshot.sourceBindingRef !== record.sourceBindingRef) throw new KernelError('PRECONDITION_FAILED',
      'Pinned source binding unavailable', { snapshotId })
    if (digest(snapshot.resourceVersions) !== digest(record.resourceVersions))
      throw new KernelError('PRECONDITION_FAILED', 'Pinned resource versions unavailable', { snapshotId })
    const units = snapshot.items.map(item => {
      const unit = record.units.find(u => u.id === item.unitId)
      if (!unit) throw new KernelError('PRECONDITION_FAILED', 'Pinned source unit unavailable', { unitId: item.unitId })
      const revision = item.decision.type === 'revision' ?
        record.revisions.find(r => r.id === item.decision.revisionId) : undefined
      if (item.decision.type === 'revision' && (!revision || revision.unitId !== unit.id || revision.targetLang !== snapshot.targetLang)) throw new KernelError('PRECONDITION_FAILED',
        'Pinned revision unavailable', { revisionId: item.decision.revisionId })
      return { unit: { ...clone(unit), ...(snapshot.targetLang ? { targetLang: snapshot.targetLang } : {}),
        ...(revision ? { acceptedRevisionId: revision.id } : {}) },
        decision: clone(item.decision), text: revision?.text ?? unit.sourceText,
        ...(revision ? { revision: { ...clone((({ basis, ...publicRevision }) => publicRevision)(revision)), status: 'accepted' } } : {}) }
    })
    return clone({ snapshot, document: record.document, sourceBinding: record.sourceBinding,
      ...(record.sourceIR ? { sourceIR: record.sourceIR } : {}), units })
  }
  async addArtifact(docId, { snapshotId, targetLang, format, adapterId, adapterVersion, path,
    warnings = [], taskId, outputIndex, managedFile = false, fileDigest } = {}) {
    await this.ready
    required((targetLang === undefined || language(targetLang)) && typeof format === 'string' && format &&
      typeof path === 'string' && path, 'Artifact requires targetLang, format and path')
    required(Array.isArray(warnings) && warnings.every(value => typeof value === 'string'),
      'Artifact warnings must be a string array')
    required(!managedFile || (typeof fileDigest === 'string' && /^[a-f0-9]{64}$/.test(fileDigest)),
      'Managed artifact requires a SHA-256 file digest')
    const pathKey = this.pathKey(path)
    if (this.deletingPaths.has(pathKey) || this.cleanupForPath(pathKey))
      throw new KernelError('CONFLICT', 'Artifact file cleanup is in progress', { path })
    this.pendingArtifactPaths.set(pathKey, (this.pendingArtifactPaths.get(pathKey) ?? 0) + 1)
    let artifact
    try { await this.update(docId, current => {
      if (this.deletingPaths.has(pathKey) || this.cleanupForPath(pathKey) ||
          this.deletingArtifacts.has(`${docId}\u0000${snapshotId}`) ||
          (current.artifactCleanup ?? []).some(item => item.snapshotId === snapshotId))
        throw new KernelError('CONFLICT', 'Artifact file cleanup is in progress', { path })
      const snapshot = current.snapshots.find(s => s.id === snapshotId) ?? missing('snapshotId', snapshotId)
      required(snapshot.targetLang === targetLang, 'Snapshot targetLang mismatch')
      artifact = { id: `${docId}.${id()}`, docId, contentMode: snapshot.contentMode ?? 'accepted-translation',
        ...(targetLang === undefined ? {} : { targetLang }), format,
        ...(adapterId ? { adapterId } : {}), ...(adapterVersion ? { adapterVersion } : {}), path, snapshotId,
        revisionSetHash: snapshot.revisionSetHash, createdAt: now(),
        ...(warnings.length ? { warnings: clone(warnings) } : {}),
        ...(taskId ? { taskId, outputIndex } : {}),
        ...(managedFile ? { managedFile: true, fileDigest } : {}) }
      let operationTasks = current.operationTasks
      if (taskId) {
        const task = operationTasks?.find(item => item.id === taskId)
        required(task && task.kind === 'export' && task.snapshotId === snapshotId && task.targetLang === targetLang,
          'Artifact must match its export task')
        if (task.state !== 'running' || task.cursor !== outputIndex) throw new KernelError('CONFLICT', 'Export checkpoint changed')
        operationTasks = operationTasks.map(item => item.id === taskId ? { ...item,
          cursor: item.cursor + 1, progress: { ...item.progress, done: item.cursor + 1 },
          artifacts: [...item.artifacts, artifact],
          ...(warnings.length ? { warnings: [...(item.warnings ?? []), ...warnings] } : {}),
          updatedAt: now() } : item)
      }
      return { ...current, ...(managedFile ? { schemaVersion: 3 } : {}),
        artifacts: [...current.artifacts, artifact], ...(operationTasks ? { operationTasks } : {}) }
    }) } finally {
      const count = this.pendingArtifactPaths.get(pathKey) ?? 0
      if (count <= 1) this.pendingArtifactPaths.delete(pathKey)
      else this.pendingArtifactPaths.set(pathKey, count - 1)
    }
    return clone(artifact)
  }
  listArtifacts(docId) { return clone(this.record(docId).artifacts) }
  pathKey(path) { return managedPathKey(path) }
  cleanupForPath(key) {
    return [...this.table.entries()].some(([, record]) => (record.artifactCleanup ?? [])
      .some(item => this.pathKey(item.path) === key))
  }
  artifactCandidate(docId, artifactId) {
    const record = this.record(docId)
    const artifact = record.artifacts.find(item => item.id === artifactId)
    const cleanup = (record.artifactCleanup ?? []).find(item => item.artifactId === artifactId)
    if (!artifact && !cleanup) missing('artifactId', artifactId)
    return clone(artifact ?? cleanup)
  }
  listArtifactCleanup(docId) { return clone(this.record(docId).artifactCleanup ?? []) }
  retainArtifact(docId, artifactId) {
    this.artifactCandidate(docId, artifactId)
    if (!this.record(docId).artifacts.some(item => item.id === artifactId) || this.deletingArtifacts.has(artifactId))
      throw new KernelError('CONFLICT', 'Artifact deletion is in progress', { artifactId })
    this.artifactLeases.set(artifactId, (this.artifactLeases.get(artifactId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.artifactLeases.get(artifactId) ?? 0
      if (count <= 1) this.artifactLeases.delete(artifactId)
      else this.artifactLeases.set(artifactId, count - 1)
    }
  }
  async abandonTask(taskId) {
    return this.updateTask(taskId, task => {
      if (task.state !== 'failed' && task.state !== 'abandoned')
        throw new KernelError('PRECONDITION_FAILED', 'Only a failed task can be abandoned', { taskId })
      return { ...task, state: 'abandoned' }
    })
  }
  async deleteArtifact(docId, artifactId, { deleteOwned = false, unlinkFile } = {}) {
    await this.ready
    const candidate = this.artifactCandidate(docId, artifactId)
    const key = this.pathKey(candidate.path)
    const snapshotKey = `${docId}\u0000${candidate.snapshotId}`
    if (this.deletingArtifacts.has(artifactId) || this.deletingArtifacts.has(snapshotKey) ||
        this.deletingPaths.has(key) ||
        this.pendingArtifactPaths.has(key))
      throw new KernelError('CONFLICT', 'Artifact deletion is in progress', { artifactId })
    if (this.artifactLeases.has(artifactId) || this.leases.has(snapshotKey))
      throw new KernelError('CONFLICT', 'Artifact or snapshot is in use', { artifactId })
    if (deleteOwned && !unlinkFile) throw new KernelError('INVALID_ARGUMENT', 'Owned-file deletion requires a file remover')
    if (deleteOwned && [...this.table.entries()].some(([, record]) => record.artifacts.some(item =>
      item.id !== artifactId && this.pathKey(item.path) === key)))
      throw new KernelError('CONFLICT', 'File is shared by another artifact', { artifactId })
    this.deletingArtifacts.add(artifactId)
    this.deletingArtifacts.add(snapshotKey)
    this.deletingPaths.add(key)
    try {
      if (candidate.state !== 'pending' && candidate.state !== 'failed') {
        await this.update(docId, current => {
          const artifact = current.artifacts.find(item => item.id === artifactId) ?? missing('artifactId', artifactId)
          if (deleteOwned && [...this.table.entries()].some(([, record]) => record.artifacts.some(item =>
            item.id !== artifactId && this.pathKey(item.path) === key)))
            throw new KernelError('CONFLICT', 'File is shared by another artifact', { artifactId })
          const linked = (current.operationTasks ?? []).filter(task => task.snapshotId === artifact.snapshotId &&
            ['queued', 'running', 'paused', 'failed'].includes(task.state))
          if (linked.length) throw new KernelError('CONFLICT', 'Artifact is retained by an active or failed task',
            { artifactId, taskIds: linked.map(item => item.id) })
          const cleanup = deleteOwned ? [{ artifactId, snapshotId: artifact.snapshotId,
            path: artifact.path, managedFile: true, fileDigest: artifact.fileDigest,
            state: 'pending', createdAt: now() }] : []
          return { ...current, schemaVersion: 3, artifacts: current.artifacts.filter(item => item.id !== artifactId),
            artifactCleanup: [...(current.artifactCleanup ?? []), ...cleanup],
            operationTasks: (current.operationTasks ?? []).map(task => ({ ...task,
              artifacts: task.artifacts.filter(item => item.id !== artifactId) })) }
        })
      } else if (!deleteOwned) throw new KernelError('PRECONDITION_FAILED', 'File cleanup requires explicit retry', { artifactId })
      if (!deleteOwned) return { recordDeleted: true, fileDeleted: false, retainedPath: candidate.path }
      try {
        await unlinkFile(candidate.path, candidate.fileDigest)
        await this.update(docId, current => ({ ...current,
          artifactCleanup: (current.artifactCleanup ?? []).filter(item => item.artifactId !== artifactId) }))
        return { recordDeleted: true, fileDeleted: true }
      } catch (error) {
        await this.update(docId, current => ({ ...current, artifactCleanup: (current.artifactCleanup ?? [])
          .map(item => item.artifactId === artifactId ? { ...item, state: 'failed', error: error.message } : item) }))
        return { recordDeleted: true, fileDeleted: false, cleanupPending: true, retainedPath: candidate.path,
          cleanupError: error.message }
      }
    } finally {
      this.deletingArtifacts.delete(artifactId)
      this.deletingArtifacts.delete(snapshotKey)
      this.deletingPaths.delete(key)
    }
  }
}
