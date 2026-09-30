import { randomUUID } from 'node:crypto'
import { Service } from '../dist/dsh.mjs'
import { resolveBasis } from './terms.mjs'

export class TextTask extends Service {
  static inject = ['ivoraige.records', 'ivoraige.translation']
  constructor(ctx) { super(ctx, 'ivoraige.textTask'); this.ctx = ctx; this.records = ctx.get('ivoraige.records'); this.translation = ctx.get('ivoraige.translation'); this.runs = new Set(); ctx.effect(() => async () => { for (const run of this.runs) run.cancel(); await Promise.allSettled([...this.runs].map(r => r.done)) }) }
  start(documentId, { review = false, force = false, onProgress = () => {} } = {}) {
    if (this.runs.size) throw new Error('A text task is already running; cancel or wait before starting another')
    if (!this.translation.model.config.roles.translation) throw new Error('Translation role is not configured')
    if (review && !this.translation.model.config?.roles?.review) throw new Error('Review role is not configured')
    const document = this.records.getDocument(documentId); const terms = this.ctx.get('ivoraige.terms'); if (document.libraries.length && !terms) throw new Error('Selected libraries require ivoraige.terms')
    for (const libraryId of document.libraries) terms.exportLibrary(libraryId)
    const controller = new AbortController(); const run = { id: `run-${randomUUID()}`, status: 'running', calls: [], units: document.units.map(u => ({ unitId: u.id, status: 'pending' })), cancel: () => controller.abort('user cancellation') }; this.runs.add(run)
    run.done = (async () => {
      try {
        for (const item of run.units) {
          if (controller.signal.aborted) break
          try {
            const current = this.records.getDocument(documentId); const unit = current.units.find(u => u.id === item.unitId); const { basis, conflicts } = resolveBasis(this.records, terms, documentId, item.unitId); item.conflicts = conflicts
            const reuse = await this.records.recordCheck(documentId, item.unitId, basis)
            if (reuse.reusable && !force) { item.status = 'reused'; item.revisionId = reuse.revisionId; onProgress(item); continue }
            item.status = 'translating'; onProgress(item)
            const callStart = this.translation.model.calls.length
            let generated
            const structureHint = this.records.sources.get(current)?.structureHint?.(unit) ?? ''
            try { generated = await this.translation.translate({ ...unit, structureHint }, basis, controller.signal, { review }) }
            finally { run.calls.push(...this.translation.model.calls.slice(callStart).map(call => ({ ...structuredClone(call), unitId: unit.id }))) }
            if (controller.signal.aborted) { item.status = 'cancelled'; onProgress(item); break }
            const draft = await this.records.saveDraft(documentId, unit.id, generated); item.status = 'draft'; item.revisionId = draft.id; onProgress(item)
          } catch (error) { item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.error = error.message; onProgress(item); if (controller.signal.aborted) break }
        }
        for (const item of run.units) if (item.status === 'pending' && controller.signal.aborted) item.status = 'cancelled'
        run.status = controller.signal.aborted ? 'cancelled' : run.units.some(u => u.status === 'failed') ? 'failed' : 'completed'
        return { id: run.id, status: run.status, units: run.units, calls: run.calls }
      } finally { this.runs.delete(run) }
    })()
    return run
  }
}
