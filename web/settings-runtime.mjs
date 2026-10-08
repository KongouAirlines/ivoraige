import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { Context } from '@deepseek-ai/cordis'

/**
 * Browser boundary for DSH's `settings.section` slot. The host sends only
 * descriptors; executable page components come from the installed web build.
 */
export function createSettingsRuntime(components) {
  const slots = new SlotCore()
  const cordis = new Context()
  const disposeRoot = slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  }, () => null)
  const mounted = new Map()
  const listeners = new Set()
  let snapshot = Object.freeze([])
  let disposed = false
  let disposal
  let generation = 0
  let pending = Promise.resolve()

  function publish() {
    const next = slots.entriesOfSlot('settings.section').map(entry => Object.freeze({
      id: entry.options.id,
      label: entry.options.label,
      order: entry.options.order ?? 0,
      component: entry.component,
    }))
    snapshot = Object.freeze(next)
    for (const listener of listeners) listener()
  }

  function publishIfChanged() {
    const entries = slots.entriesOfSlot('settings.section')
    if (entries.length === snapshot.length && entries.every((entry, index) => {
      const page = snapshot[index]
      return page.id === entry.options.id && page.label === entry.options.label &&
        page.order === (entry.options.order ?? 0) && page.component === entry.component
    })) return
    publish()
  }

  async function sync(descriptors = []) {
    if (disposed) throw new Error('Settings runtime is disposed')
    const desired = new Map()
    const seen = new Set()
    for (const descriptor of descriptors) {
      const { id, label, order = 0 } = descriptor
      if (typeof id !== 'string' || !id || typeof label !== 'string' || !Number.isFinite(order)) {
        throw new Error('Invalid settings page descriptor')
      }
      if (seen.has(id)) throw new Error(`Duplicate settings page: ${id}`)
      seen.add(id)
      const component = components[id]
      // A host can know a plugin whose UI is absent from this static build.
      if (typeof component !== 'function') continue
      desired.set(id, { id, label, order, component })
    }

    const request = ++generation
    const run = async () => {
      if (request !== generation || disposed) return snapshot
      for (const [id, current] of mounted) {
        const wanted = desired.get(id)
        if (!wanted || wanted.label !== current.label || wanted.order !== current.order || wanted.component !== current.component) {
          await current.fiber.dispose()
          mounted.delete(id)
        }
      }
      if (request !== generation || disposed) return snapshot
      for (const [id, page] of desired) {
        if (!mounted.has(id)) {
          // A real Cordis plugin owns each DSH slot registration. Fiber
          // disposal calls the DSH disposer before navigation is published.
          const fiber = cordis.plugin({
            name: `settings:${id}`,
            apply(ctx) {
              ctx.effect(() => slots.register({
                name: 'settings.section', id, order: page.order, label: page.label,
              }, page.component), `settings.section:${id}`)
            },
          })
          await fiber.await()
          mounted.set(id, { ...page, fiber })
        }
      }
      if (request === generation && !disposed) publishIfChanged()
      return snapshot
    }
    const result = pending.then(run)
    pending = result.catch(() => {})
    return result
  }

  return {
    sync,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) throw new Error('Settings runtime is disposed')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      if (disposal) return disposal
      disposed = true
      generation += 1
      disposal = (async () => {
        await pending
        for (const page of mounted.values()) await page.fiber.dispose()
        mounted.clear()
        disposeRoot() // DSH recursively releases every settings.section entry.
        await cordis.fiber.dispose()
        publish()
        listeners.clear()
      })()
      return disposal
    },
  }
}
