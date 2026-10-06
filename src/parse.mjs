import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

function validateIr(parsed, adapterId) {
  const validUnit = (unit, index) => unit && typeof unit === 'object' &&
    unit.order === index && typeof unit.kind === 'string' &&
    typeof unit.sourceText === 'string' && unit.sourceText.trim() &&
    typeof unit.translatable === 'boolean' &&
    (unit.locator === undefined ||
      (unit.locator !== null && typeof unit.locator === 'object' && !Array.isArray(unit.locator)))
  if (!parsed || typeof parsed !== 'object' ||
      typeof parsed.format !== 'string' || !parsed.format ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.units) || !parsed.units.length ||
      !parsed.units.every(validUnit)) {
    throw new KernelError('INTERNAL', `Source adapter returned invalid document IR: ${adapterId}`)
  }
}

export class Parse extends Service {
  static inject = ['ivoraige.outputs']

  constructor(ctx) {
    super(ctx, 'ivoraige.parse')
    this.adapters = new Map()
    this.outputs = ctx.get('ivoraige.outputs')
  }

  register(adapter) {
    if (!adapter?.id || typeof adapter.match !== 'function' || typeof adapter.parse !== 'function') {
      throw new KernelError('INVALID_ARGUMENT', 'Source adapter requires id, match and parse')
    }
    if (this.adapters.has(adapter.id)) {
      throw new KernelError('INVALID_ARGUMENT', `Source adapter already registered: ${adapter.id}`)
    }
    this.adapters.set(adapter.id, adapter)
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id)
    }
  }

  listAdapters() { return [...this.adapters.keys()] }

  async parse(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new KernelError('INVALID_ARGUMENT', 'File reference must be an object')
    }
    if (file.format !== undefined && (typeof file.format !== 'string' || !file.format.trim())) {
      throw new KernelError('INVALID_ARGUMENT', 'format must be a nonempty string')
    }
    if (file.path === undefined && file.content === undefined) {
      throw new KernelError('INVALID_ARGUMENT', 'File reference requires path or content')
    }
    let selected
    let confidence = 0
    for (const adapter of this.adapters.values()) {
      const score = adapter.match(file)
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
        throw new KernelError('INVALID_ARGUMENT', `Invalid match score from source adapter: ${adapter.id}`)
      }
      if (score > confidence) { selected = adapter; confidence = score }
    }
    if (!selected) {
      throw new KernelError('INVALID_ARGUMENT', 'Unsupported source format', {
        format: file.format ?? null,
        path: file.path ?? null,
        registeredAdapters: this.listAdapters(),
      })
    }
    const parsed = await selected.parse(file)
    validateIr(parsed, selected.id)
    return { ...parsed, availableOutputs: this.outputs.availableFor(parsed.sourceBinding) }
  }
}
