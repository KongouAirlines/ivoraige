import { dirname, join } from 'node:path'
import { Context, Storage, StorageDomain, StorageSqlite } from '../dist/dsh.mjs'
import { Parse } from './parse.mjs'
import { Outputs } from './outputs.mjs'
import { TxtSource } from './adapters/txt-source.mjs'
import { Records } from './records.mjs'
import { Exporter } from './export.mjs'
import { TextOutputs } from './adapters/text-output.mjs'
import { KernelError } from './errors.mjs'

// Composition only: business capabilities live in Cordis services.
export async function createApp({ store, exportDir } = {}) {
  if (store !== undefined && (typeof store !== 'string' || !store.trim())) {
    throw new KernelError('INVALID_ARGUMENT', 'store must be an explicit SQLite file path')
  }
  if (exportDir !== undefined && (typeof exportDir !== 'string' || !exportDir.trim())) {
    throw new KernelError('INVALID_ARGUMENT', 'exportDir must be a nonempty directory path')
  }
  const ctx = new Context()
  try {
    await ctx.plugin(Outputs)
    await ctx.plugin(Parse)
    await ctx.plugin(TxtSource)
    if (store !== undefined) {
      await ctx.plugin(Storage)
      await ctx.plugin(StorageSqlite, { path: store })
      await ctx.plugin(StorageDomain, { backend: 'sqlite' })
      await ctx.plugin(Records)
      await ctx.get('ivoraige.records').ready
      await ctx.plugin(TextOutputs)
      await ctx.plugin(Exporter, { root: exportDir ?? join(dirname(store), 'exports') })
    }
    return {
      ctx,
      parse: ctx.get('ivoraige.parse'),
      outputs: ctx.get('ivoraige.outputs'),
      records: ctx.get('ivoraige.records'),
      exporter: ctx.get('ivoraige.export'),
      dispose: () => ctx.fiber.dispose(),
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}
