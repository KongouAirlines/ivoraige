import { Context } from '../dist/dsh.mjs'
import { Parse } from './parse.mjs'
import { Outputs } from './outputs.mjs'
import { TxtSource } from './adapters/txt-source.mjs'

// Composition only: business capabilities live in Cordis services.
export async function createApp() {
  const ctx = new Context()
  try {
    await ctx.plugin(Outputs)
    await ctx.plugin(Parse)
    await ctx.plugin(TxtSource)
    return {
      ctx,
      parse: ctx.get('ivoraige.parse'),
      outputs: ctx.get('ivoraige.outputs'),
      dispose: () => ctx.fiber.dispose(),
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}
