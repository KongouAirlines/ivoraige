import { randomUUID } from 'node:crypto'
import { Service } from '../dist/dsh.mjs'
import { basisFor } from './records.mjs'

export class Terms extends Service {
  static inject = ['ivoraige.records']
  constructor(ctx) { super(ctx, 'ivoraige.terms'); this.records = ctx.get('ivoraige.records') }
  async createLibrary(id, scope = 'shared') { if (!['shared', 'project'].includes(scope)) throw new Error('Scope must be shared or project'); return this.records.mutate(s => { if (s.libraries[id]) throw new Error('Library already exists'); return s.libraries[id] = { id, scope, revision: 1, entries: [] } }) }
  async put(libraryId, entry, { confirm = false } = {}) {
    if (!entry.en?.trim() || !entry.zh?.trim() || !entry.sense?.trim()) throw new Error('Term requires en, zh and sense')
    if (entry.context !== undefined && (!Array.isArray(entry.context) || entry.context.some(v => typeof v !== 'string'))) throw new Error('Term context must be an array of strings')
    if (entry.aliases !== undefined && ['en', 'zh'].some(language => !Array.isArray(entry.aliases[language]) || entry.aliases[language].some(v => typeof v !== 'string'))) throw new Error('Term aliases require en and zh string arrays')
    return this.records.mutate(s => { const lib = s.libraries[libraryId]; if (!lib) throw new Error('Unknown library'); const old = lib.entries.find(e => e.id === entry.id); const next = { aliases: { en: [], zh: [] }, context: [], sources: [], ...entry, id: entry.id ?? `sense-${randomUUID()}`, revision: (old?.revision ?? 0) + 1, status: confirm ? 'confirmed' : 'candidate' }; if (old) lib.entries[lib.entries.indexOf(old)] = next; else lib.entries.push(next); lib.revision++; for (const doc of Object.values(s.documents)) if (doc.libraries.includes(libraryId)) doc.units.forEach(u => u.needsCheck = true); return next })
  }
  async confirm(libraryId, entryId, changes = {}) { const entry = this.records.snapshot().libraries[libraryId]?.entries.find(e => e.id === entryId); if (!entry) throw new Error('Unknown term'); return this.put(libraryId, { ...entry, ...changes }, { confirm: true }) }
  async merge(libraryId, keepId, removeId) { return this.records.mutate(s => { const lib = s.libraries[libraryId]; const keep = lib?.entries.find(e => e.id === keepId); const remove = lib?.entries.find(e => e.id === removeId); if (!keep || !remove || keepId === removeId || keep.sense !== remove.sense) throw new Error('Merge requires two entries of the same sense'); keep.sources = [...keep.sources, ...remove.sources]; for (const lang of ['en', 'zh']) keep.aliases[lang] = [...new Set([...keep.aliases[lang], ...remove.aliases[lang], remove[lang]])].filter(t => t !== keep[lang]); keep.revision++; lib.entries = lib.entries.filter(e => e.id !== removeId); lib.revision++; for (const doc of Object.values(s.documents)) if (doc.libraries.includes(libraryId)) doc.units.forEach(u => u.needsCheck = true); return keep }) }
  exportLibrary(id) { const lib = this.records.snapshot().libraries[id]; if (!lib) throw new Error('Unknown library'); return lib }
  async importLibrary(data) { if (!data.id || !Array.isArray(data.entries)) throw new Error('Invalid term library'); if (!this.records.snapshot().libraries[data.id]) await this.createLibrary(data.id, data.scope); const entries = []; for (const entry of data.entries) entries.push(await this.put(data.id, entry, { confirm: entry.status === 'confirmed' })); return entries }
  resolve(doc, unit) {
    const state = this.records.snapshot(); const language = doc.sourceLanguage; const target = doc.target.language
    const text = [unit.text, doc.units[unit.index - 1]?.text ?? '', doc.units[unit.index + 1]?.text ?? ''].join(' ').toLowerCase()
    const candidates = []; const potential = new Map(); const versions = {}; const conflicts = []
    for (const libraryId of doc.libraries) {
      const lib = state.libraries[libraryId]; if (!lib) throw new Error(`Unknown selected library: ${libraryId}`); versions[libraryId] = lib.revision
      for (const entry of lib.entries.filter(e => e.status === 'confirmed')) {
        const forms = [entry[language], ...(entry.aliases?.[language] ?? [])]
        const source = forms.find(term => language === 'zh' ? unit.text.includes(term) : new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(unit.text))
        if (!source) continue
        const possible = potential.get(source) ?? new Set(); possible.add(entry[target]); potential.set(source, possible)
        if (entry.context?.length && !entry.context.some(c => text.includes(c.toLowerCase()))) continue
        candidates.push({ sense: entry.sense, source, target: entry[target], libraryId, scope: lib.scope, entryId: entry.id, entryRevision: entry.revision, context: entry.context ?? [] })
      }
    }
    const selected = new Map()
    for (const c of candidates) { const key = `${c.source.toLowerCase()}|${c.sense}`; const old = selected.get(key); if (!old || c.scope === 'project' && old.scope !== 'project') { if (old && old.target !== c.target) conflicts.push({ kind: 'project-priority', selected: c, overridden: old }); selected.set(key, c) } else if (old.target !== c.target) conflicts.push({ kind: 'conflict', selected: old, other: c }) }
    const constraints = [...selected.values()].sort((a, b) => `${a.source}|${a.sense}`.localeCompare(`${b.source}|${b.sense}`))
    const bySource = new Map(); for (const c of constraints) { const list = bySource.get(c.source) ?? []; list.push(c); bySource.set(c.source, list) }
    const ambiguity = [...bySource.values()].filter(list => new Set(list.map(c => c.target)).size > 1)
    for (const [source, targets] of potential) if (targets.size > 1 && !bySource.has(source)) ambiguity.push([{ source, targets: [...targets], reason: 'No applicable sense context' }])
    if (ambiguity.length || conflicts.some(c => c.kind === 'conflict')) { const error = new Error(`Ambiguous terms require sense/context confirmation: ${ambiguity.map(list => list[0].source).join(', ') || 'same-sense conflict'}`); error.details = { ambiguity, conflicts }; throw error }
    return { basis: basisFor(doc, unit, constraints, versions), constraints, conflicts }
  }
}
export function resolveBasis(records, terms, documentId, unitId) { const doc = records.getDocument(documentId); const unit = doc.units.find(u => u.id === unitId); if (!unit) throw new Error('Unknown unit'); if (doc.libraries.length && !terms) throw new Error('Selected term libraries require ivoraige.terms'); return terms ? terms.resolve(doc, unit) : { basis: basisFor(doc, unit, [], {}), constraints: [], conflicts: [] } }
