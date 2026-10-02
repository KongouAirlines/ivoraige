import { randomUUID } from 'node:crypto'
import { Service, StorageDomain, z } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { basisFor, digest, sameBasis } from './basis.mjs'

const clone = value => structuredClone(value)
const now = () => new Date().toISOString()
const id = () => randomUUID().replaceAll('-', '')
const language = value => typeof value === 'string' && value !== 'auto' &&
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)
const required = (condition, message) => { if (!condition) throw new KernelError('INVALID_ARGUMENT', message) }
const missing = (kind, value) => { throw new KernelError('NOT_FOUND', `${kind} not found`, { [kind]: value }) }
const keyFor = (unitId, targetLang) => `${unitId}\u0000${targetLang}`
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
  document: z.object({ id: z.string(), sourceId: z.string(), format: z.literal('txt'), language: z.string(),
    title: z.string(), origin: z.enum(['manual', 'zotero', 'cli', 'mcp']), externalRef: z.string().optional(), unitCount: z.number(),
    translatableCount: z.number(), availableOutputs: z.array(z.string()), importedAt: z.string() }),
  fingerprint: z.string(), sourceBinding: generic, sourceBindingRef: z.string(),
  resourceVersions: z.record(z.string(), z.string()),
  units: z.array(z.object({ id: z.string(), docId: z.string(), order: z.number(), kind: z.enum(['heading', 'body', 'caption', 'formula', 'code', 'reference', 'other']),
    sourceText: z.string(), context: z.string().optional(), locator: generic.optional(), translatable: z.boolean() })),
  revisions: z.array(z.object({ id: z.string(), unitId: z.string(), targetLang: z.string(), text: z.string(),
    origin: z.enum(['human', 'machine', 'imported']), modelId: z.string().optional(), promptVersion: z.string().optional(),
    reuseKey: z.string(), basis: generic, createdAt: z.string() })),
  latest: z.record(z.string(), z.string()), accepted: z.record(z.string(), z.string()),
  constraints: z.record(z.string(), generic), snapshots: z.array(z.object({ id: z.string(), docId: z.string(),
    targetLang: z.string(), sourceBindingRef: z.string(), resourceVersions: z.record(z.string(), z.string()),
    items: z.array(z.object({ unitId: z.string(), decision: z.discriminatedUnion('type', [
      z.object({ type: z.literal('revision'), revisionId: z.string() }),
      z.object({ type: z.literal('skip') }), z.object({ type: z.literal('keepOriginal') }),
    ]) })), revisionSetHash: z.string(), createdAt: z.string() })),
  artifacts: z.array(z.object({ id: z.string(), docId: z.string(), targetLang: z.string(), format: z.string(),
    path: z.string(), snapshotId: z.string(), revisionSetHash: z.string(), createdAt: z.string() })),
})
const spec = StorageDomain.defineDomain({ name: 'ivoraige_records', version: 1, layout: 'per-record',
  tables: { documents: StorageDomain.domainTable(recordSchema) } })

export class Records extends Service {
  static inject = ['storageDomain', 'ivoraige.parse', 'ivoraige.outputs']

  constructor(ctx) {
    super(ctx, 'ivoraige.records')
    this.parse = ctx.get('ivoraige.parse')
    this.outputs = ctx.get('ivoraige.outputs')
    this.leases = new Map()
    this.reuse = new Map()
    this.imports = new Map()
    this.ready = ctx.get('storageDomain').open(spec).then(domain => {
      this.domain = domain
      this.table = domain.table('documents')
      for (const [docId, record] of this.table.entries()) this.indexAccepted(docId, record)
      ctx.effect(() => () => domain.close())
    })
  }

  requireReady() { if (!this.table) throw new KernelError('INTERNAL', 'Records service is not ready') }
  record(docId) { this.requireReady(); return this.table.get(docId) ?? missing('docId', docId) }
  async update(docId, transform) {
    this.record(docId)
    return this.table.update(docId, current => {
      const next = transform(current)
      assertJson(next)
      recordSchema.parse(next)
      return next
    })
  }
  locateUnit(unitId) {
    const docId = typeof unitId === 'string' ? unitId.split('.')[0] : ''
    const record = this.record(docId)
    const unit = record.units.find(item => item.id === unitId) ?? missing('unitId', unitId)
    return { docId, record, unit }
  }
  locateRevision(revisionId) {
    const docId = typeof revisionId === 'string' ? revisionId.split('.')[0] : ''
    const record = this.record(docId)
    const revision = record.revisions.find(item => item.id === revisionId) ?? missing('revisionId', revisionId)
    return { docId, record, revision }
  }
  constraintsFor(record, unit, targetLang) {
    return record.constraints[keyFor(unit.id, targetLang)] ?? defaultConstraints(record.units, unit.order)
  }
  basis(record, unit, targetLang) {
    return basisFor({ ...record.document, sourceBinding: record.sourceBinding }, unit, targetLang,
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

  async importDocument(file, { sourceId, language: sourceLang, origin = 'manual', externalRef } = {}) {
    await this.ready
    required(language(sourceLang), 'language must be a real BCP-47 tag')
    required(['manual', 'zotero', 'cli', 'mcp'].includes(origin), 'Invalid origin')
    required(sourceId === undefined || (typeof sourceId === 'string' && sourceId.trim()), 'sourceId must be nonempty')
    required(externalRef === undefined || typeof externalRef === 'string', 'externalRef must be a string')
    const parsed = await this.parse.parse(file)
    required(parsed.format === 'txt' && (!parsed.resources || parsed.resources.length === 0),
      'Persistent import currently supports TXT without external resources')
    assertJson(parsed)
    const businessSourceId = sourceId ?? (file.path ? `path:${file.path}` : `manual:${id()}`)
    const fingerprint = digest({ format: parsed.format, language: sourceLang, units: parsed.units,
      chapters: parsed.chapters, resources: parsed.resources, sourceBinding: parsed.sourceBinding })
    const docId = digest({ sourceId: businessSourceId, fingerprint }).slice(0, 32)
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
  async insertDocument(docId, businessSourceId, sourceLang, origin, externalRef, fingerprint, parsed) {
    const units = parsed.units.map((unit, order) => ({ ...clone(unit), id: `${docId}.${order.toString(36)}`,
      docId, order }))
    const document = { id: docId, sourceId: businessSourceId, format: parsed.format, language: sourceLang,
      title: parsed.title, origin, ...(externalRef === undefined ? {} : { externalRef }),
      unitCount: units.length, translatableCount: units.filter(unit => unit.translatable).length,
      availableOutputs: clone(parsed.availableOutputs), importedAt: now() }
    const record = { document, fingerprint, sourceBinding: clone(parsed.sourceBinding),
      sourceBindingRef: digest({ docId, fingerprint, binding: parsed.sourceBinding }), resourceVersions: {}, units, revisions: [],
      latest: {}, accepted: {}, constraints: {}, snapshots: [], artifacts: [] }
    assertJson(record)
    recordSchema.parse(record)
    await this.table.put(docId, record)
    return clone(this.table.get(docId).document)
  }

  getDocument(docId) {
    const record = this.record(docId)
    return clone({ ...record.document, availableOutputs: this.outputs.availableFor(record.sourceBinding) })
  }
  listDocuments() { this.requireReady(); return [...this.table.keys()].map(docId => this.getDocument(docId)) }
  listUnits(docId, { targetLang } = {}) {
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    const record = this.record(docId)
    return record.units.map(unit => this.viewUnit(record, unit, targetLang))
  }
  getUnit(unitId, { targetLang } = {}) {
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    const { record, unit } = this.locateUnit(unitId)
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
    const candidates = this.reuse.get(basis.reuseKey) ?? []
    for (const { docId, revisionId } of candidates) {
      const record = this.table.get(docId)
      const revision = record?.revisions.find(r => r.id === revisionId)
      if (revision && record.accepted[keyFor(revision.unitId, revision.targetLang)] === revisionId &&
          sameBasis(revision.basis, basis)) return this.viewRevision(record, revision)
    }
    return null
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

  async createSnapshot(docId, { targetLang, onMissingAccepted = 'fail' } = {}) {
    await this.ready
    required(language(targetLang), 'targetLang must be a real BCP-47 tag')
    required(['fail', 'skip'].includes(onMissingAccepted), 'Invalid onMissingAccepted')
    let snapshot
    await this.update(docId, current => {
      const items = current.units.map(unit => {
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
      snapshot = { id: `${docId}.${id()}`, docId, targetLang, sourceBindingRef: current.sourceBindingRef,
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
    if (this.leases.get(key) === -1) {
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
      if (artifactIds.length) throw new KernelError('CONFLICT', 'Snapshot is in use',
        { snapshotId, artifactIds, inUse: false })
      return { ...current, snapshots: current.snapshots.filter(s => s.id !== snapshotId) }
    }) } finally { this.leases.delete(key) }
  }
  resolveSnapshot(docId, snapshotId) {
    const record = this.record(docId)
    const snapshot = record.snapshots.find(s => s.id === snapshotId) ?? missing('snapshotId', snapshotId)
    if (snapshot.sourceBindingRef !== record.sourceBindingRef) throw new KernelError('PRECONDITION_FAILED',
      'Pinned source binding unavailable', { snapshotId })
    const units = snapshot.items.map(item => {
      const unit = record.units.find(u => u.id === item.unitId)
      if (!unit) throw new KernelError('PRECONDITION_FAILED', 'Pinned source unit unavailable', { unitId: item.unitId })
      const revision = item.decision.type === 'revision' ?
        record.revisions.find(r => r.id === item.decision.revisionId) : undefined
      if (item.decision.type === 'revision' && (!revision || revision.unitId !== unit.id || revision.targetLang !== snapshot.targetLang)) throw new KernelError('PRECONDITION_FAILED',
        'Pinned revision unavailable', { revisionId: item.decision.revisionId })
      return { unit: { ...clone(unit), targetLang: snapshot.targetLang,
        ...(revision ? { acceptedRevisionId: revision.id } : {}) },
        decision: clone(item.decision), text: revision?.text ?? unit.sourceText,
        ...(revision ? { revision: { ...clone((({ basis, ...publicRevision }) => publicRevision)(revision)), status: 'accepted' } } : {}) }
    })
    return clone({ snapshot, document: record.document, sourceBinding: record.sourceBinding, units })
  }
  async addArtifact(docId, { snapshotId, targetLang, format, path } = {}) {
    await this.ready
    required(language(targetLang) && typeof format === 'string' && format &&
      typeof path === 'string' && path, 'Artifact requires targetLang, format and path')
    let artifact
    await this.update(docId, current => {
      const snapshot = current.snapshots.find(s => s.id === snapshotId) ?? missing('snapshotId', snapshotId)
      required(snapshot.targetLang === targetLang, 'Snapshot targetLang mismatch')
      artifact = { id: `${docId}.${id()}`, docId, targetLang, format, path, snapshotId,
        revisionSetHash: snapshot.revisionSetHash, createdAt: now() }
      return { ...current, artifacts: [...current.artifacts, artifact] }
    })
    return clone(artifact)
  }
  listArtifacts(docId) { return clone(this.record(docId).artifacts) }
  async deleteArtifact(docId, artifactId) {
    await this.ready
    await this.update(docId, current => {
      if (!current.artifacts.some(a => a.id === artifactId)) missing('artifactId', artifactId)
      return { ...current, artifacts: current.artifacts.filter(a => a.id !== artifactId) }
    })
  }
}
