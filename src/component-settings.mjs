import { Service, DshSchema as z } from '../dist/dsh.mjs'

export const COMPONENT_SETTINGS_NS = 'ivoraige-components'

export class ComponentsSettings extends Service {
  static inject = ['settings']
  static Config = z.object({ installedPdf: z.string().default('').volatile() })

  constructor(ctx, config) {
    super(ctx, 'ivoraige.componentsSettings')
    this.config = config
  }

  selected() { return this.config.installedPdf.get() || null }
}
