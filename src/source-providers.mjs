import { Service } from '../dist/dsh.mjs'

export class SourceProviders extends Service {
  constructor(ctx) { super(ctx, 'ivoraige.sources'); this.providers = new Map() }
  register(provider) { if (!provider?.id || !provider.project || !provider.readable) throw new Error('Source provider requires id, project and readable'); this.providers.set(provider.id, provider) }
  parse(id, input, options) { const provider = this.providers.get(id); if (!provider?.parse) throw new Error(`Source parser unavailable: ${id}`); return provider.parse(input, options) }
  get(document) {
    const name = document.sourceBinding?.provider
    if (name) {
      const provider = this.providers.get(name)
      if (!provider) throw new Error(`Source provider unavailable: ${name}`)
      return provider
    }
    return [...this.providers.values()].find(provider => provider.acceptsLegacy?.(document)) ?? null
  }
  binding(document) { return document.sourceBinding ?? this.get(document)?.legacyBinding?.(document) ?? null }
}
