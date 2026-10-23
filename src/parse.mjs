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
    if (adapter.version !== undefined && (typeof adapter.version !== 'string' || !adapter.version.trim()))
      throw new KernelError('INVALID_ARGUMENT', 'Source adapter version must be a nonempty string')
    if (adapter.bindingSchemaVersion !== undefined &&
        (!Number.isSafeInteger(adapter.bindingSchemaVersion) || adapter.bindingSchemaVersion <= 0))
      throw new KernelError('INVALID_ARGUMENT', 'Source adapter bindingSchemaVersion must be a positive integer')
    if (adapter.formats !== undefined && (!Array.isArray(adapter.formats) || !adapter.formats.length ||
        adapter.formats.some(format => typeof format !== 'string' || !format))) {
      throw new KernelError('INVALID_ARGUMENT', 'Source adapter formats must be nonempty')
    }
    if (adapter.inputKinds !== undefined && (!Array.isArray(adapter.inputKinds) || !adapter.inputKinds.length ||
        adapter.inputKinds.some(kind => !['text', 'bytes', 'managed-resource'].includes(kind))))
      throw new KernelError('INVALID_ARGUMENT', 'Source adapter inputKinds must list supported input kinds')
    if (adapter.cancellable !== undefined && typeof adapter.cancellable !== 'boolean')
      throw new KernelError('INVALID_ARGUMENT', 'Source adapter cancellable must be boolean')
    this.adapters.set(adapter.id, adapter)
    this.ctx.emit('ivoraige/capabilities-changed', { kind: 'source', id: adapter.id })
    return () => {
      if (this.adapters.get(adapter.id) === adapter) {
        this.adapters.delete(adapter.id)
        this.ctx.emit('ivoraige/capabilities-changed', { kind: 'source', id: adapter.id })
      }
    }
  }

  listAdapters() { return [...this.adapters.values()].filter(adapter => adapter.status?.().state !== 'unavailable').map(adapter => adapter.id) }
  listFormats() { return [...new Set([...this.adapters.values()]
    .filter(adapter => !['unavailable', 'disabled', 'failed'].includes(adapter.status?.().state))
    .flatMap(adapter => adapter.formats ?? [adapter.id]))] }

  componentStatus() {
    return Object.fromEntries([...this.adapters.values()].filter(adapter => adapter.status)
      .map(adapter => [adapter.id, adapter.status()]))
  }

  validateTranslation(binding, unit, text, provenance = {}) {
    const adapter = this.adapters.get(binding.adapterId)
    if (!adapter) throw new KernelError('COMPONENT_MISSING', 'Install the source adapter before editing this document',
      { adapterId: binding.adapterId })
    if ((provenance.sourceAdapterId && provenance.sourceAdapterId !== adapter.id) ||
        (provenance.sourceAdapterVersion && provenance.sourceAdapterVersion !== (adapter.version ?? 'unversioned')) ||
        (provenance.bindingSchemaVersion !== undefined &&
          provenance.bindingSchemaVersion !== (adapter.bindingSchemaVersion ?? 1)))
      throw new KernelError('PRECONDITION_FAILED', 'Source validation adapter version is incompatible',
        { adapterId: binding.adapterId })
    adapter.validateTranslation?.(binding, unit, text)
  }

  projectOutputView(frozen, { views = [] } = {}) {
    if (!views.length) return frozen
    const { sourceBinding: binding, document } = frozen
    const adapter = this.adapters.get(binding?.adapterId)
    if (!adapter) throw new KernelError('COMPONENT_MISSING', 'Source adapter is unavailable for output projection',
      { adapterId: binding?.adapterId })
    if ((document.sourceAdapterVersion && document.sourceAdapterVersion !== (adapter.version ?? 'unversioned')) ||
        (document.bindingSchemaVersion !== undefined &&
          document.bindingSchemaVersion !== (adapter.bindingSchemaVersion ?? 1)))
      throw new KernelError('PRECONDITION_FAILED', 'Source adapter version is incompatible with output projection',
        { adapterId: adapter.id })
    const needsReadable = views.includes('readable-text')
    const units = frozen.units.map(item => {
      if (!needsReadable) return item
      const readableText = adapter.readableText?.(binding, item.unit, item.text) ?? item.text
      if (typeof readableText !== 'string') throw new KernelError('INTERNAL', 'Source adapter returned invalid readable text')
      return { ...item, readableText }
    })
    const nativeMarkdown = views.includes('native-markdown') ? adapter.renderMarkdown?.(frozen) : undefined
    if (nativeMarkdown !== undefined && typeof nativeMarkdown !== 'string')
      throw new KernelError('INTERNAL', 'Source adapter returned invalid Markdown')
    return { ...frozen, units, ...(nativeMarkdown === undefined ? {} : { nativeMarkdown }) }
  }

  select(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new KernelError('INVALID_ARGUMENT', 'File reference must be an object')
    }
    if (file.format !== undefined && (typeof file.format !== 'string' || !file.format.trim())) {
      throw new KernelError('INVALID_ARGUMENT', 'format must be a nonempty string')
    }
    if (file.path === undefined && file.content === undefined) {
      throw new KernelError('INVALID_ARGUMENT', 'File reference requires path or content')
    }
    if (file.adapterId !== undefined && (typeof file.adapterId !== 'string' || !file.adapterId))
      throw new KernelError('INVALID_ARGUMENT', 'adapterId must be a nonempty string')
    const inputKind = file.path !== undefined ? 'managed-resource' :
      Buffer.isBuffer(file.content) ? 'bytes' : 'text'
    const candidates = file.adapterId === undefined ? [...this.adapters.values()] :
      [this.adapters.get(file.adapterId)].filter(Boolean)
    if (file.adapterId && !candidates.length) throw new KernelError('COMPONENT_MISSING',
      'Requested source adapter is not installed', { adapterId: file.adapterId })
    let selected
    let confidence = 0
    let tied = false
    for (const adapter of candidates) {
      if (adapter.status?.().state === 'unavailable') {
        if (file.adapterId) throw new KernelError('COMPONENT_MISSING', 'Requested source adapter is unavailable',
          { adapterId: file.adapterId })
        continue
      }
      if (file.format && adapter.formats && !adapter.formats.includes(file.format.toLowerCase())) {
        if (file.adapterId) throw new KernelError('INVALID_ARGUMENT', 'Source adapter does not support format',
          { adapterId: file.adapterId, format: file.format })
        continue
      }
      if (adapter.inputKinds && !adapter.inputKinds.includes(inputKind)) {
        if (file.adapterId) throw new KernelError('INVALID_ARGUMENT', 'Source adapter does not support input kind',
          { adapterId: adapter.id, inputKind })
        continue
      }
      const score = adapter.match(file)
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
        throw new KernelError('INVALID_ARGUMENT', `Invalid match score from source adapter: ${adapter.id}`)
      }
      if (score > confidence) { selected = adapter; confidence = score; tied = false }
      else if (score > 0 && score === confidence) tied = true
    }
    if (tied) throw new KernelError('CONFLICT', 'Source adapter selection is ambiguous',
      { format: file.format ?? null, adapterIds: candidates.filter(adapter => adapter.match(file) === confidence).map(adapter => adapter.id) })
    if (!selected) {
      throw new KernelError('INVALID_ARGUMENT', 'Unsupported source format', {
        format: file.format ?? null,
        path: file.path ?? null,
        registeredAdapters: this.listAdapters(),
      })
    }
    return selected
  }

  resolved(parsed, adapterId) {
    validateIr(parsed, adapterId)
    const adapter = this.adapters.get(adapterId)
    if (adapter.formats && !adapter.formats.includes(parsed.format)) throw new KernelError('INTERNAL',
      'Source adapter returned an undeclared format', { adapterId, format: parsed.format })
    if (parsed.sourceBinding?.adapterId !== adapterId) throw new KernelError('INTERNAL',
      'Source adapter returned a foreign binding', { adapterId })
    return { ...parsed, sourceAdapterId: adapterId, sourceAdapterVersion: adapter.version ?? 'unversioned',
      bindingSchemaVersion: adapter.bindingSchemaVersion ?? 1,
      availableOutputs: this.outputs.availableFor(parsed.sourceBinding) }
  }

  async parse(file) {
    const selected = this.select(file)
    const parsed = await selected.parse(file)
    if (this.adapters.get(selected.id) !== selected)
      throw new KernelError('PRECONDITION_FAILED', 'Source adapter changed during parsing', { adapterId: selected.id })
    return this.resolved(parsed, selected.id)
  }

  async importDocument(file, persist, isReferenced, { adapterVersion } = {}) {
    const selected = this.select(file)
    if (adapterVersion !== undefined && adapterVersion !== (selected.version ?? 'unversioned'))
      throw new KernelError('PRECONDITION_FAILED', 'Pinned source adapter version is unavailable',
        { adapterId: selected.id, adapterVersion })
    const accept = parsed => {
      if (this.adapters.get(selected.id) !== selected)
        throw new KernelError('PRECONDITION_FAILED', 'Source adapter changed during import', { adapterId: selected.id })
      return persist(this.resolved(parsed, selected.id))
    }
    return selected.import ? selected.import(file, accept, isReferenced) : accept(await selected.parse(file))
  }
}
