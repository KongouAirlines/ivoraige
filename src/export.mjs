import { writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Service } from '../dist/dsh.mjs'

export class TextExport extends Service {
  static inject = ['ivoraige.records']
  constructor(ctx) { super(ctx, 'ivoraige.textExport'); this.records = ctx.get('ivoraige.records') }
  render(manifest, format) {
    if (format === 'json') return JSON.stringify(manifest, null, 2) + '\n'
    if (format !== 'md') throw new Error('Format must be md or json')
    return `# ${manifest.title}\n\n<!-- document:${manifest.documentId} revision:${manifest.documentRevision} -->\n\n` + manifest.units.map(u => `<!-- unit:${u.unitId} source-revision:${u.sourceRevision} revision:${u.revisionId} -->\n${u.text}`).join('\n\n') + '\n'
  }
  async write(documentId, outputs) {
    if (!outputs.length || new Set(outputs.map(output => output.path)).size !== outputs.length) throw new Error('Export requires distinct output paths')
    const manifest = this.records.manifest(documentId); const prepared = []
    try { for (const { format, path } of outputs) { const text = this.render(manifest, format); await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, text, 'utf8'); prepared.push({ temporary, path }) } for (const item of prepared) await rename(item.temporary, item.path); return manifest }
    finally { await Promise.allSettled(prepared.map(item => unlink(item.temporary))) }
  }
}
