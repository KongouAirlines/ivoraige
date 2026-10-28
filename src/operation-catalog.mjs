import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

const missing = id => new KernelError('NOT_FOUND', 'Operation not found', { operation: id })
const issues = error => error.issues.map(issue => ({ path: issue.path, message: issue.message }))

function assertData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || seen.has(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
    throw new KernelError('INTERNAL', 'Operation returned non-JSON data')
  }
  seen.add(value)
  const array = Array.isArray(value)
  const keys = Reflect.ownKeys(value)
  if (array) {
    if (keys.length !== value.length + 1)
      throw new KernelError('INTERNAL', 'Operation returned non-JSON data')
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index))
        throw new KernelError('INTERNAL', 'Operation returned non-JSON data')
    }
  }
  for (const key of keys) {
    if (array && key === 'length') continue
    if (typeof key !== 'string') throw new KernelError('INTERNAL', 'Operation returned non-JSON data')
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable ||
        (property.value === undefined && array)) {
      throw new KernelError('INTERNAL', 'Operation returned non-JSON data')
    }
    if (property.value !== undefined) assertData(property.value, seen)
  }
  seen.delete(value)
}

// One in-process Cordis service owns operation discovery and invocation. Entry
// transports use the Operations facade for the stable wire envelope.
export class OperationCatalog extends Service {
  constructor(ctx, { drainTimeoutMs = 30_000 } = {}) {
    super(ctx, 'ivoraige.operationCatalog')
    this.entries = new Map()
    this.listeners = new Set()
    this.active = new Set()
    this.drainTimeoutMs = drainTimeoutMs
    this.closing = false
    this.drained = false
    ctx.effect(() => () => this.close())
  }

  register({ id, inputSchema, resultSchema, requires = [], handler,
    description = '', longRunning = false, cancellable = 'none', preflight, isAvailable }) {
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Operation catalog is closing')
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(id) ||
        typeof inputSchema?.safeParse !== 'function' ||
        typeof resultSchema?.safeParse !== 'function' || typeof handler !== 'function' ||
        !Array.isArray(requires) || requires.some(name => typeof name !== 'string') ||
        (preflight !== undefined && typeof preflight !== 'function') ||
        (isAvailable !== undefined && typeof isAvailable !== 'function') ||
        !['none', 'request', 'task'].includes(cancellable)) {
      throw new KernelError('INVALID_ARGUMENT', 'Invalid operation registration')
    }
    if (this.entries.has(id)) throw new KernelError('CONFLICT', 'Operation already registered', { operation: id })
    const metadata = Object.freeze({ id, inputSchema, resultSchema, requires: Object.freeze([...requires]),
      description, longRunning: Boolean(longRunning), cancellable })
    const entry = { ...metadata, metadata, handler, preflight, isAvailable }
    this.entries.set(id, entry)
    this.changed()
    let disposing
    return () => {
      if (disposing) return disposing
      if (this.entries.get(id) === entry) {
        this.entries.delete(id)
        this.changed()
      }
      for (const call of this.active) if (call.entry === entry) call.controller.abort()
      disposing = this.drain(call => call.entry === entry).catch(error => {
        disposing = undefined // A timed-out withdrawal can be retried after cleanup.
        throw error
      })
      return disposing
    }
  }

  available(entry) {
    const isAvailable = this.entries.get(entry.id)?.isAvailable
    return entry.requires.every(name => this.ctx.get(name) !== undefined) &&
      (!isAvailable || isAvailable() === true)
  }
  get(id) {
    const entry = this.entries.get(id)
    if (!entry) throw missing(id)
    return entry.metadata
  }
  list({ availableOnly = false } = {}) {
    return [...this.entries.values()].filter(entry => !availableOnly || this.available(entry))
      .map(entry => entry.metadata)
  }
  subscribeChanges(listener) {
    if (typeof listener !== 'function') throw new KernelError('INVALID_ARGUMENT', 'listener must be a function')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  changed() {
    for (const listener of this.listeners) {
      try { listener() } catch { /* Discovery listeners cannot break registration. */ }
    }
  }

  async invoke(id, input = {}, { signal } = {}) {
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Operation catalog is closing')
    const entry = this.entries.get(id)
    if (!entry) throw missing(id)
    const parsed = entry.inputSchema.safeParse(input)
    if (!parsed.success) throw new KernelError('INVALID_ARGUMENT', 'Invalid operation parameters',
      { issues: issues(parsed.error) })
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const call = { entry, controller }
    this.active.add(call)
    try {
      if (entry.preflight) await entry.preflight(parsed.data)
      if (this.closing || this.entries.get(id) !== entry || controller.signal.aborted) {
        throw new KernelError('PRECONDITION_FAILED', 'Operation is no longer accepting requests',
          { ...(controller.signal.aborted ? { canceled: true } : {}) })
      }
      if (!this.available(entry)) throw new KernelError('COMPONENT_MISSING',
        'Required operation capability is unavailable', { operation: id,
          missing: entry.requires.filter(name => this.ctx.get(name) === undefined) })
      const result = await entry.handler(parsed.data, { signal: controller.signal })
      assertData(result)
      if (!result || Array.isArray(result) || typeof result !== 'object' ||
          !entry.resultSchema.safeParse(result).success) {
        throw new KernelError('INTERNAL', 'Operation returned an invalid result', { operation: id })
      }
      return result
    } finally {
      signal?.removeEventListener('abort', abort)
      this.active.delete(call)
      this.changedDrain()
    }
  }

  changedDrain() {
    for (const wake of this.waiters ?? []) wake()
  }
  async drain(select = () => true) {
    const deadline = Date.now() + this.drainTimeoutMs
    while ([...this.active].some(select)) {
      let wake, timer
      const pending = new Promise(resolve => { wake = resolve })
      this.waiters ??= new Set()
      this.waiters.add(wake)
      try {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new KernelError('PRECONDITION_FAILED', 'Operation handlers did not drain before the deadline')
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new KernelError(
          'PRECONDITION_FAILED', 'Operation handlers did not drain before the deadline')), remaining) })
        await Promise.race([pending, timeout])
      } finally {
        clearTimeout(timer)
        this.waiters.delete(wake)
      }
    }
  }
  async close() {
    this.closing = true
    for (const call of this.active) call.controller.abort()
    await this.drain()
    this.drained = true
  }
}
