import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

// A registry of pages supplied by mounted plugins. Descriptors are data only;
// the static web bundle owns the components that render each known page id.
export class SettingsPages extends Service {
  constructor(ctx) {
    super(ctx, 'ivoraige.settingsPages')
    this.pages = new Map()
  }

  register({ id, label, order }) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) ||
        typeof label !== 'string' || !label.trim() || !Number.isFinite(order)) {
      throw new KernelError('INVALID_ARGUMENT', 'Settings page requires id, label and order')
    }
    if (this.pages.has(id)) throw new KernelError('INVALID_ARGUMENT', `Settings page already registered: ${id}`)
    const page = Object.freeze({ id, label, order })
    this.pages.set(id, page)
    this.changed()
    return () => {
      if (this.pages.get(id) === page) { this.pages.delete(id); this.changed() }
    }
  }

  changed() {
    this.ctx.get('ivoraige.tasks')?.emit('settings.pages.changed', { settingsPages: this.list() })
  }

  list() {
    return [...this.pages.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }
}
