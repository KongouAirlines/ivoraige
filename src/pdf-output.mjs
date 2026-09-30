import { resolve } from 'node:path'
import { Service } from '../dist/dsh.mjs'

export class PdfOutput extends Service {
  static inject = ['ivoraige.records', 'ivoraige.textExport']
  constructor(ctx) { super(ctx, 'ivoraige.pdfOutput'); this.records = ctx.get('ivoraige.records'); this.textExport = ctx.get('ivoraige.textExport'); this.renderers = new Map() }
  register(id, render) { this.renderers.set(id, render) }
  async write(documentId, { renderer, runDir, ...options } = {}) {
    if (!runDir) throw new Error('PDF output requires runDir')
    const manifest = this.records.manifest(documentId)
    const selected = renderer ?? (this.renderers.size === 1 ? this.renderers.keys().next().value : null)
    const render = this.renderers.get(selected)
    if (!render) throw new Error(`PDF renderer unavailable: ${selected}`)
    return render(manifest, { ...options, runDir: resolve(runDir), renderText: format => this.textExport.render(manifest, format) })
  }
}
