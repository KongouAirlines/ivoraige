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

function bestView(adapter, views) {
  let score = 0, file
  for (const view of views) {
    const current = adapter.match(view)
    if (typeof current !== 'number' || !Number.isFinite(current) || current < 0 || current > 1)
      throw new KernelError('INVALID_ARGUMENT', `Invalid match score from source adapter: ${adapter.id}`)
    // Equal views of one descriptor prefer original bytes, not self-conflict.
    if (current > score) { score = current; file = view }
  }
  return { score, file }
}

export class Parse extends Service {
  static inject = ['ivoraige.outputs']

  constructor(ctx) {
    super(ctx, 'ivoraige.parse')
    this.adapters = new Map()
    this.preparedInputs = new WeakSet()
    this.selections = new WeakSet()
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

  prepareInput(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new KernelError('INVALID_ARGUMENT', 'File reference must be an object')
    }
    if (file.format !== undefined && (typeof file.format !== 'string' || !file.format.trim())) {
      throw new KernelError('INVALID_ARGUMENT', 'format must be a nonempty string')
    }
    if ([file.path, file.content, file.contentBase64].filter(value => value !== undefined).length !== 1)
      throw new KernelError('INVALID_ARGUMENT', 'File reference requires exactly one path, content or contentBase64')
    if (file.path !== undefined && (typeof file.path !== 'string' || !file.path.trim()))
      throw new KernelError('INVALID_ARGUMENT', 'path must be a nonempty string')
    if (file.adapterId !== undefined && (typeof file.adapterId !== 'string' || !file.adapterId))
      throw new KernelError('INVALID_ARGUMENT', 'adapterId must be a nonempty string')
    const { content, contentBase64, ...rest } = file
    let bytes, text
    if (contentBase64 !== undefined) {
      if (typeof contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64))
        throw new KernelError('INVALID_ARGUMENT', 'contentBase64 is not valid base64')
      bytes = Buffer.from(contentBase64, 'base64')
    } else if (content !== undefined) {
      if (typeof content !== 'string' && !Buffer.isBuffer(content))
        throw new KernelError('INVALID_ARGUMENT', 'content must be a string or Buffer')
      if (typeof content === 'string') text = content
      else bytes = Buffer.from(content)
    }
    if (bytes) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {}
    }
    const input = Object.freeze({ file: Object.freeze({ ...rest,
      ...(bytes ? { content: bytes } : text !== undefined ? { content: text } : {}) }), bytes, text })
    this.preparedInputs.add(input)
    return input
  }

  inputsFor(adapter, input) {
    const kinds = adapter.inputKinds
    if (input.file.path !== undefined)
      return !kinds || kinds.includes('managed-resource') ? [input.file] : []
    // Declared byte consumers keep lossless input. Undeclared legacy consumers
    // keep their UTF-8 preference; text-only matchers receive text only.
    if (!kinds) return [input.text !== undefined
      ? Object.freeze({ ...input.file, content: input.text }) : input.file]
    const views = []
    if (kinds.includes('bytes') && input.bytes) views.push(input.file)
    if (kinds.includes('text') && input.text !== undefined)
      views.push(Object.freeze({ ...input.file, content: input.text }))
    return views
  }

  selectPrepared(input) {
    if (!this.preparedInputs.has(input)) throw new KernelError('INVALID_ARGUMENT', 'Input was not prepared by this parser')
    const file = input.file
    const candidates = file.adapterId === undefined ? [...this.adapters.values()] :
      [this.adapters.get(file.adapterId)].filter(Boolean)
    if (file.adapterId && !candidates.length) throw new KernelError('COMPONENT_MISSING',
      'Requested source adapter is not installed', { adapterId: file.adapterId })
    let selected
    let confidence = 0
    let winners = []
    const unavailable = []
    for (const adapter of candidates) {
      const absent = adapter.status?.().state === 'unavailable'
      if (absent && file.adapterId) throw new KernelError('COMPONENT_MISSING', 'Requested source adapter is unavailable',
        { adapterId: file.adapterId })
      if (file.format && adapter.formats && !adapter.formats.includes(file.format.toLowerCase())) {
        if (file.adapterId) throw new KernelError('INVALID_ARGUMENT', 'Source adapter does not support format',
          { adapterId: file.adapterId, format: file.format })
        continue
      }
      const views = this.inputsFor(adapter, input)
      if (!views.length) {
        if (file.adapterId) throw new KernelError('INVALID_ARGUMENT', 'Source adapter does not support input kind',
          { adapterId: adapter.id, inputKind: file.path !== undefined ? 'managed-resource' :
            typeof file.content === 'string' ? 'text' : 'bytes' })
        continue
      }
      if (absent) { unavailable.push({ adapter, views }); continue }
      const match = bestView(adapter, views)
      const score = match.score
      if (score > confidence) { selected = { adapter, file: match.file }; confidence = score; winners = [adapter.id] }
      else if (score > 0 && score === confidence) winners.push(adapter.id)
    }
    if (winners.length > 1) throw new KernelError('CONFLICT', 'Source adapter selection is ambiguous',
      { format: file.format ?? null, adapterIds: winners })
    if (!selected) {
      const missing = unavailable.filter(({ adapter, views }) => bestView(adapter, views).score > 0)
        .map(({ adapter }) => adapter.id)
      if (missing.length) throw new KernelError('COMPONENT_MISSING', 'Source adapter is unavailable', { adapterIds: missing })
      throw new KernelError('INVALID_ARGUMENT', 'Unsupported source format', {
        reason: 'no-source',
        format: file.format ?? null,
        path: file.path ?? null,
        registeredAdapters: this.listAdapters(),
      })
    }
    const { adapter } = selected
    const version = adapter.version ?? 'unversioned'
    const selection = Object.freeze({ adapter, file: Object.freeze({ ...selected.file, adapterId: adapter.id }),
      adapterVersion: version, importMode: adapter.importMode,
      descriptor: Object.freeze({ id: adapter.id, version, bindingSchemaVersion: adapter.bindingSchemaVersion ?? 1 }),
      parse: adapter.parse, import: adapter.import })
    this.selections.add(selection)
    return selection
  }

  select(file) { return this.selectPrepared(this.prepareInput(file)).adapter }

  assertSelection(selection) {
    if (!this.selections.has(selection) || this.adapters.get(selection.descriptor.id) !== selection.adapter ||
        (selection.adapter.version ?? 'unversioned') !== selection.adapterVersion ||
        (selection.adapter.bindingSchemaVersion ?? 1) !== selection.descriptor.bindingSchemaVersion)
      throw new KernelError('PRECONDITION_FAILED', 'Prepared source adapter changed before import')
    if (selection.adapter.status?.().state === 'unavailable')
      throw new KernelError('COMPONENT_MISSING', 'Prepared source adapter is unavailable', { adapterId: selection.descriptor.id })
  }

  executionInput(selection, file) {
    return { ...selection.file, ...(file.language !== undefined ? { language: file.language } : {}),
      ...(file.signal !== undefined ? { signal: file.signal } : {}),
      ...(file.onProgress !== undefined ? { onProgress: file.onProgress } : {}) }
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
    const selected = this.selectPrepared(this.prepareInput(file))
    const parsed = await selected.parse.call(selected.adapter, this.executionInput(selected, file))
    this.assertSelection(selected)
    return this.resolved(parsed, selected.descriptor.id)
  }

  async importDocument(file, persist, isReferenced, { adapterVersion, selection } = {}) {
    const selected = selection ?? this.selectPrepared(this.prepareInput(file))
    this.assertSelection(selected)
    if (adapterVersion !== undefined && adapterVersion !== selected.adapterVersion)
      throw new KernelError('PRECONDITION_FAILED', 'Pinned source adapter version is unavailable',
        { adapterId: selected.descriptor.id, adapterVersion })
    const accept = parsed => {
      this.assertSelection(selected)
      return persist(this.resolved(parsed, selected.descriptor.id))
    }
    const input = this.executionInput(selected, file)
    return selected.import ? selected.import.call(selected.adapter, input, accept, isReferenced)
      : accept(await selected.parse.call(selected.adapter, input))
  }
}
