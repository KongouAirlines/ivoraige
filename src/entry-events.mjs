import { randomUUID } from 'node:crypto'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

// This is a projection of committed business state, not a plugin event bus or
// an event log. Cordis owns producers/listeners; a transport owns each session.
export function eventData(value, depth = 0) {
  if (depth > 32) throw new KernelError('INVALID_ARGUMENT', 'Event data is too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))))
      throw new KernelError('INVALID_ARGUMENT', 'Event arrays must contain ordinary JSON values')
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor?.get || descriptor?.set)
        throw new KernelError('INVALID_ARGUMENT', 'Event arrays must contain ordinary JSON values')
      return descriptor?.value === undefined ? null : eventData(descriptor.value, depth + 1)
    })
  }
  if (value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const result = {}
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || descriptor.get || descriptor.set)
        throw new KernelError('INVALID_ARGUMENT', 'Event data must contain ordinary JSON values')
      if (descriptor.value !== undefined) Object.defineProperty(result, key, {
        value: eventData(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true,
      })
    }
    return result
  }
  throw new KernelError('INVALID_ARGUMENT', 'Event data must contain ordinary JSON values')
}

export function eventScope(input = {}) {
  input = eventData(input)
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some(key => !['docId', 'taskId', 'componentId'].includes(key)))
    throw new KernelError('INVALID_ARGUMENT', 'Invalid event scope')
  const result = {}
  for (const key of ['docId', 'taskId', 'componentId']) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 1024)
      throw new KernelError('INVALID_ARGUMENT', 'Event scope IDs must be nonempty strings')
    result[key] = input[key]
  }
  return Object.freeze(result)
}

function relevant(query, source) {
  // An absent source field means a global invalidation. In particular we do
  // not guess document ownership from the spelling of a task ID.
  return Object.entries(query).every(([key, id]) => source[key] === undefined || source[key] === id)
}

function call(listener, value) {
  try { Promise.resolve(listener(structuredClone(value))).catch(() => {}) } catch { /* observers cannot undo a commit */ }
}

class EventSession {
  constructor(owner, scope, maxBuffer) {
    this.owner = owner
    this.maxBuffer = maxBuffer
    this.buffer = []
    this.listeners = new Map()
    this.closed = false
    this.invalid = false
    this.scheduled = false
    this.ready = Object.freeze({ subscriptionId: randomUUID(), generation: owner.generation,
      scope, barrierRevision: owner.stateRevision })
  }

  enqueue(event) {
    if (this.closed || this.invalid || !relevant(this.ready.scope, event.scope)) return
    if (this.buffer.length >= this.maxBuffer) { this.invalidate('buffer-overflow'); return }
    this.buffer.push({ type: 'state.invalidated', subscriptionId: this.ready.subscriptionId,
      generation: this.ready.generation, scope: this.ready.scope,
      stateRevision: event.stateRevision, event })
    this.deliver()
  }

  deliver() {
    if (this.scheduled || this.closed) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.closed) return
      for (const [listener, delivered] of this.listeners) {
        const pending = this.buffer.filter(item => item.stateRevision > delivered ||
          (item.type === 'resync-required' && delivered !== Infinity))
        for (const notice of pending) {
          if (!this.listeners.has(listener) || this.closed) break
          this.listeners.set(listener, notice.type === 'resync-required' ? Infinity : notice.stateRevision)
          call(listener, notice)
        }
      }
    })
  }

  onNotice(listener) {
    if (this.closed) throw new KernelError('PRECONDITION_FAILED', 'Event subscription is closed')
    if (typeof listener !== 'function') throw new KernelError('INVALID_ARGUMENT', 'listener must be a function')
    this.listeners.set(listener, -1)
    this.deliver()
    return () => this.listeners.delete(listener)
  }

  invalidate(reason) {
    if (this.closed || this.invalid) return
    this.invalid = true
    this.buffer = [{ type: 'resync-required', reason, subscriptionId: this.ready.subscriptionId,
      generation: this.ready.generation, scope: this.ready.scope, stateRevision: this.owner.stateRevision }]
    this.deliver()
  }

  snapshot() {
    if (this.closed || this.invalid) throw new KernelError('PRECONDITION_FAILED', 'Subscription requires resynchronization')
    const snapshot = this.owner.capture(this.ready.scope)
    if (this.closed || this.invalid) throw new KernelError('PRECONDITION_FAILED', 'Subscription requires resynchronization')
    return { ...this.ready, ...snapshot }
  }

  acknowledge(revision) {
    if (!Number.isSafeInteger(revision) || revision < this.ready.barrierRevision || revision > this.owner.stateRevision)
      throw new KernelError('INVALID_ARGUMENT', 'Invalid snapshot revision')
    if (!this.invalid) this.buffer = this.buffer.filter(item => item.stateRevision > revision)
  }

  drain() { return structuredClone(this.buffer) }

  close() {
    if (this.closed) return
    this.closed = true
    this.buffer.length = 0
    this.listeners.clear()
    this.owner.sessions.delete(this.ready.subscriptionId)
  }
}

export class EntryEvents extends Service {
  constructor(ctx) {
    super(ctx, 'ivoraige.events')
    this.generation = randomUUID()
    this.stateRevision = 0
    this.sequence = 0
    this.sessions = new Map()
    this.readers = new Map()
    this.legacyListeners = new Set()
    this.closed = false
    ctx.effect(() => () => this.close())
  }

  registerState(id, read) {
    if (this.closed) throw new KernelError('PRECONDITION_FAILED', 'Event bridge is closed')
    if (typeof id !== 'string' || !/^[a-zA-Z][\w.-]*$/.test(id) || typeof read !== 'function')
      throw new KernelError('INVALID_ARGUMENT', 'State reader requires an ID and synchronous function')
    if (this.readers.has(id)) throw new KernelError('CONFLICT', `State reader already registered: ${id}`)
    this.readers.set(id, read)
    this.publish('capabilities.changed')
    return () => {
      if (this.readers.get(id) !== read) return
      this.readers.delete(id)
      if (!this.closed) this.publish('capabilities.changed')
    }
  }

  publish(type, { scope = {}, data = {}, legacyData } = {}) {
    if (this.closed) return
    if (typeof type !== 'string' || !/^[\w.-]+$/.test(type))
      throw new KernelError('INVALID_ARGUMENT', 'Invalid business event type')
    const publicScope = eventScope(scope)
    const publicData = eventData(data)
    const legacy = legacyData === undefined ? undefined : eventData(legacyData)
    const event = { eventVersion: 1, eventId: randomUUID(), type, sequence: ++this.sequence,
      occurredAt: new Date().toISOString(), generation: this.generation,
      stateRevision: ++this.stateRevision, scope: publicScope, data: publicData }
    // Publication occurs synchronously after the producer made state visible.
    // Only network/session delivery is deferred to avoid snapshot reentrancy.
    for (const session of this.sessions.values()) session.enqueue(event)
    if (legacy !== undefined) for (const listener of this.legacyListeners) call(listener, { type, data: legacy })
    return structuredClone(event)
  }

  subscribe(scope = {}, { maxBuffer = 128 } = {}) {
    if (this.closed) throw new KernelError('PRECONDITION_FAILED', 'Event bridge is closed')
    if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || maxBuffer > 4096)
      throw new KernelError('INVALID_ARGUMENT', 'maxBuffer must be an integer from 1 to 4096')
    // No await or user callback may separate installation from barrier capture.
    const session = new EventSession(this, eventScope(scope), maxBuffer)
    this.sessions.set(session.ready.subscriptionId, session)
    return session
  }

  getSession(id) {
    const session = this.sessions.get(id)
    if (!session) throw new KernelError('NOT_FOUND', 'Event subscription not found')
    return session
  }

  subscribeLegacy(listener) {
    if (this.closed) throw new KernelError('PRECONDITION_FAILED', 'Event bridge is closed')
    if (typeof listener !== 'function') throw new KernelError('INVALID_ARGUMENT', 'listener must be a function')
    this.legacyListeners.add(listener)
    return () => this.legacyListeners.delete(listener)
  }

  capture(scope) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const revision = this.stateRevision
      const state = {}
      try {
        for (const [id, read] of this.readers) {
          const value = read(scope)
          if (value?.then) {
            Promise.resolve(value).catch(() => {})
            this.invalidateAll('asynchronous-state-reader')
            throw new KernelError('PRECONDITION_FAILED', 'State readers must be synchronous')
          }
          state[id] = eventData(value)
        }
      } catch (error) {
        this.invalidateAll('state-reader-failed')
        throw error
      }
      if (revision === this.stateRevision) return { stateRevision: revision, state }
    }
    this.invalidateAll('unstable-state-snapshot')
    throw new KernelError('PRECONDITION_FAILED', 'State changed throughout snapshot collection; resynchronize')
  }

  invalidateAll(reason = 'notification-integrity') {
    for (const session of this.sessions.values()) session.invalidate(reason)
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const session of [...this.sessions.values()]) session.close()
    this.readers.clear()
    this.legacyListeners.clear()
  }
}
