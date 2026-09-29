import { randomUUID } from 'node:crypto'
import { Service, StorageDomain, z } from '../dist/dsh.mjs'

const copy = value => structuredClone(value)
const id = prefix => `${prefix}-${randomUUID()}`
const spec = StorageDomain.defineDomain({ name: 'ivoraige', version: 1, tables: {
  workspace: StorageDomain.domainTable(z.object({ version: z.literal(1), documents: z.record(z.string(), z.object({ id: z.string(), revision: z.number().int(), units: z.array(z.object({ id: z.string(), text: z.string(), sourceRevision: z.number().int(), revisions: z.array(z.object({ id: z.string(), text: z.string(), status: z.enum(['draft', 'accepted', 'superseded']) }).passthrough()) }).passthrough()) }).passthrough()), libraries: z.record(z.string(), z.object({ id: z.string(), revision: z.number().int(), entries: z.array(z.object({ id: z.string(), status: z.enum(['candidate', 'confirmed']), en: z.string(), zh: z.string() }).passthrough()) }).passthrough()) })),
} })
const initial = () => ({ version: 1, documents: {}, libraries: {} })
export const contextOf = (doc, index) => ({ previous: doc.units[index - 1]?.text ?? '', next: doc.units[index + 1]?.text ?? '' })
export const basisFor = (doc, unit, constraints, libraryVersions) => ({ sourceRevision: unit.sourceRevision, direction: `${doc.sourceLanguage}-${doc.target.language}`, target: copy(doc.target), context: contextOf(doc, doc.units.findIndex(u => u.id === unit.id)), libraries: [...doc.libraries], constraints: copy(constraints), libraryVersions: copy(libraryVersions) })
export function compatible(a, b) {
  if (!a) return false
  const relevant = v => { const { libraryVersions, ...rest } = v; return rest }
  return JSON.stringify(relevant(a)) === JSON.stringify(relevant(b))
}

export class Records extends Service {
  static inject = ['storageDomain']
  constructor(ctx) { super(ctx, 'ivoraige.records'); this.ready = ctx.storageDomain.open(spec).then(async domain => { this.domain = domain; this.table = domain.table('workspace'); if (!this.table.get('main')) await this.table.put('main', initial()) }); ctx.effect(() => () => this.close()) }
  async close() { try { await this.ready } finally { if (this.domain) await this.domain.close() } }
  snapshot() { return copy(this.table.get('main') ?? initial()) }
  getDocument(documentId) { const doc = this.snapshot().documents[documentId]; if (!doc) throw new Error(`Unknown document: ${documentId}`); return doc }
  async mutate(fn) {
    await this.ready
    let result
    await this.table.update('main', current => { const next = copy(current); result = fn(next); return next })
    return copy(result)
  }
  async importText({ documentId, text, sourceLanguage = 'en', targetLanguage = 'zh', title = 'Untitled', libraries = [] }) {
    if (!['en', 'zh'].includes(sourceLanguage) || !['en', 'zh'].includes(targetLanguage) || sourceLanguage === targetLanguage) throw new Error('Only en→zh or zh→en is supported')
    const paragraphs = text.split(/\r?\n\s*\r?\n/).map(v => v.trim()).filter(Boolean)
    if (!paragraphs.length) throw new Error('Text is empty')
    return this.mutate(state => {
      if (documentId && state.documents[documentId]) {
        const doc = state.documents[documentId]
        if (doc.sourceLanguage !== sourceLanguage || doc.target.language !== targetLanguage) throw new Error('Document direction differs; import with the existing direction or a new document ID')
        if (doc.units.map(u => u.text).join('\n\n') !== paragraphs.join('\n\n')) throw new Error('Document already exists with different text; use source-edit')
        return doc
      }
      const doc = { id: documentId ?? id('doc'), title, revision: 1, sourceLanguage, target: { id: id('target'), revision: 1, language: targetLanguage, purpose: 'scientific translation', style: 'precise academic prose' }, libraries, units: paragraphs.map((text, index) => ({ id: id('unit'), index, location: { paragraph: index + 1 }, text, sourceRevision: 1, revisions: [], acceptedId: null, checkedBasis: null, needsCheck: true })) }
      state.documents[doc.id] = doc; return doc
    })
  }
  async updateSource(documentId, unitId, text) {
    if (!text.trim()) throw new Error('Source text is empty')
    return this.mutate(state => { const doc = state.documents[documentId]; const i = doc?.units.findIndex(u => u.id === unitId); if (i == null || i < 0) throw new Error('Unknown unit'); doc.units[i].text = text; doc.units[i].sourceRevision++; doc.revision++; for (const u of doc.units.slice(Math.max(0, i - 1), i + 2)) u.needsCheck = true; return doc })
  }
  async updateTarget(documentId, changes) { return this.mutate(state => { const doc = state.documents[documentId]; if (!doc) throw new Error('Unknown document'); if (changes.language && changes.language !== (doc.sourceLanguage === 'en' ? 'zh' : 'en')) throw new Error('Invalid target language'); doc.target = { ...doc.target, ...changes, revision: doc.target.revision + 1 }; doc.revision++; doc.units.forEach(u => u.needsCheck = true); return doc }) }
  async selectLibraries(documentId, libraries) { return this.mutate(state => { const doc = state.documents[documentId]; if (!doc) throw new Error('Unknown document'); for (const name of libraries) if (!state.libraries[name]) throw new Error(`Unknown library: ${name}`); doc.libraries = libraries; doc.revision++; doc.units.forEach(u => u.needsCheck = true); return doc }) }
  async saveDraft(documentId, unitId, { text, basis, provenance, usage, finish, cancelled = false }) {
    if (!text?.trim() || finish?.kind && finish.kind !== 'stop') throw new Error('Cannot save empty or incomplete translation')
    return this.mutate(state => { const doc = state.documents[documentId]; const unit = doc?.units.find(u => u.id === unitId); if (!unit || !compatible(basis, basisFor(doc, unit, basis.constraints, basis.libraryVersions))) throw new Error('Source, context or target changed during generation'); const revision = { id: id('rev'), text, basis, provenance, usage, finish, cancelled, status: 'draft', createdAt: new Date().toISOString() }; unit.revisions.push(revision); return revision })
  }
  async recordCheck(documentId, unitId, basis) { return this.mutate(state => { const doc = state.documents[documentId]; const unit = doc.units.find(u => u.id === unitId); const accepted = unit.revisions.find(r => r.id === unit.acceptedId); if (compatible(accepted?.basis, basis) && unit.sourceRevision === basis.sourceRevision) { unit.checkedBasis = basis; unit.needsCheck = false; return { reusable: true, revisionId: accepted.id } } unit.needsCheck = true; return { reusable: false, reason: accepted ? 'Source, target, context or applicable terms changed; review required' : 'No accepted revision' } }) }
  async accept(documentId, unitId, revisionId, basis, { expectedAcceptedId, actor = 'user', text } = {}) {
    return this.mutate(state => { const doc = state.documents[documentId]; const unit = doc?.units.find(u => u.id === unitId); if (!unit) throw new Error('Unknown unit'); if (unit.acceptedId !== expectedAcceptedId) throw new Error('Accepted revision changed; refresh before accepting'); if (!compatible(basis, basisFor(doc, unit, basis.constraints, basis.libraryVersions))) throw new Error('Constraints changed; refresh before accepting'); for (const [key, rev] of Object.entries(basis.libraryVersions)) if (state.libraries[key]?.revision !== rev) throw new Error('Terms changed; refresh before accepting'); let revision = unit.revisions.find(r => r.id === revisionId); if (!revision) throw new Error('Unknown revision'); if (text !== undefined || !compatible(revision.basis, basis)) { revision = { ...copy(revision), id: id('rev'), text: text ?? revision.text, basis, provenance: { kind: text !== undefined ? 'human' : 'human-reconfirmation', actor, parentRevisionId: revisionId }, createdAt: new Date().toISOString(), status: 'draft' }; unit.revisions.push(revision) } if (!revision.text.trim() || revision.cancelled) throw new Error('Cannot accept empty or cancelled draft'); for (const old of unit.revisions) if (old.status === 'accepted') old.status = 'superseded'; revision.status = 'accepted'; revision.acceptedBy = actor; unit.acceptedId = revision.id; unit.checkedBasis = basis; unit.needsCheck = false; return revision })
  }
  manifest(documentId) {
    const state = this.snapshot(); const doc = state.documents[documentId]; if (!doc) throw new Error('Unknown document')
    const units = doc.units.map(unit => { const revision = unit.revisions.find(r => r.id === unit.acceptedId); const checked = unit.checkedBasis; const staleLibrary = Object.entries(checked?.libraryVersions ?? {}).some(([key, rev]) => state.libraries[key]?.revision !== rev); if (unit.needsCheck || !revision || staleLibrary || !compatible(checked, basisFor(doc, unit, checked?.constraints ?? [], checked?.libraryVersions ?? {}))) throw new Error(`Missing applicable accepted revision: ${unit.id}`); return { unitId: unit.id, sourceRevision: unit.sourceRevision, revisionId: revision.id, source: unit.text, text: revision.text, location: unit.location } })
    return { schemaVersion: 1, documentId: doc.id, documentRevision: doc.revision, title: doc.title, sourceLanguage: doc.sourceLanguage, target: doc.target, units }
  }
}
