import { Context, Storage, StorageDomain, StorageJson } from '../dist/dsh.mjs'
import { Records } from './records.mjs'
import { Terms } from './terms.mjs'
import { Translation, TermBuilder } from './translation.mjs'
import { TextTask } from './task.mjs'
import { TextExport } from './export.mjs'
import { mountModel } from './model.mjs'
import { SourceProviders } from './source-providers.mjs'
import { PdfOutput } from './pdf-output.mjs'
import { babeldoc } from './adapters/babeldoc-source.mjs'
import { renderBabeldocPdf } from './adapters/babeldoc-output.mjs'

export async function createApp({ store, model, terms = true, builder = true } = {}) {
  if (!store) throw new Error('Explicit store directory required')
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: store })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(SourceProviders)
    ctx.get('ivoraige.sources').register(babeldoc)
    await ctx.plugin(Records)
    const records = ctx.get('ivoraige.records'); await records.ready
    if (terms) await ctx.plugin(Terms)
    await ctx.plugin(TextExport)
    await ctx.plugin(PdfOutput)
    ctx.get('ivoraige.pdfOutput').register('babeldoc', renderBabeldocPdf)
    let modelFibers = []
    if (model) { modelFibers = await mountModel(ctx, model); await ctx.plugin(Translation); await ctx.plugin(TextTask); if (terms && builder) await ctx.plugin(TermBuilder) }
    return { ctx, records, sources: ctx.get('ivoraige.sources'), terms: ctx.get('ivoraige.terms'), exporter: ctx.get('ivoraige.textExport'), pdfOutput: ctx.get('ivoraige.pdfOutput'), task: ctx.get('ivoraige.textTask'), termBuilder: ctx.get('ivoraige.termBuilder'), modelFibers, dispose: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
