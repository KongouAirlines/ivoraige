import { randomUUID } from 'node:crypto'
import { HostDeadline, deadlineExceeded, waitForDeadline } from './host-deadline.mjs'
import { KernelError } from './errors.mjs'

const identifier = /^[A-Za-z0-9_.:-]{1,128}$/
const requiredStages = ['work', 'resources', 'storage', 'releaseStore', 'cleanupDiscovery', 'closeControl']
const stageKinds = { gate: 'control', admissions: 'operation', work: 'task', resources: 'worker',
  storage: 'storage', releaseStore: 'storage', cleanupDiscovery: 'registry', closeControl: 'control' }

function invalid(message) { return new KernelError('INVALID_ARGUMENT', message, { reason: 'invalid-request' }) }
function reasonOf(error) {
  const reason = error?.details?.reason
  return typeof reason === 'string' && identifier.test(reason) ? reason :
    error?.code === 'PRECONDITION_FAILED' ? 'stage-precondition-failed' : 'stage-failed'
}

// HostControl is owned by the long-lived bootstrap, not by the DSH context.
// Authentication, transport envelopes, lock acquisition, and process-exit
// observation belong to the bootstrap/controller. Callbacks own their actual
// resources; a successful callback means that stage has durably completed.
export class HostControl {
  constructor({ dataDomainRef, generation, lifetime = 'resident', stages,
    getStateRevision = () => null, onChange = () => {} }) {
    if (!identifier.test(dataDomainRef) || !identifier.test(generation) ||
        !['resident', 'ephemeral'].includes(lifetime) || !stages ||
        requiredStages.some(name => typeof stages[name] !== 'function') ||
        (stages.gate !== undefined && typeof stages.gate !== 'function') ||
        (stages.admissions !== undefined && typeof stages.admissions !== 'function') ||
        typeof getStateRevision !== 'function' || typeof onChange !== 'function') {
      throw invalid('Invalid HostControl configuration')
    }
    this.dataDomainRef = dataDomainRef
    this.generation = generation
    this.lifetime = lifetime
    this.stages = stages
    this.getStateRevision = getStateRevision
    this.onChange = onChange
    this.phase = 'starting'
    this.storeOwnership = 'held'
    this.accepting = false
    this.admissions = new Set()
    this.admissionWaiters = new Set()
    this.controlOperation = null
    this.completed = new Set()
    this.inflight = null
    this.attempt = null
    this.deadline = null
    this.blockers = []
  }

  changed() {
    try { this.onChange(this.state()) } catch { /* Projection listeners cannot change ownership. */ }
  }
  ready() {
    if (this.phase !== 'starting' || this.storeOwnership !== 'held')
      throw new KernelError('PRECONDITION_FAILED', 'Host cannot become ready', { reason: 'host-not-ready' })
    this.phase = 'ready'
    this.accepting = true
    this.changed()
  }
  failStart() {
    if (this.phase !== 'starting') throw new KernelError('PRECONDITION_FAILED', 'Host is not starting',
      { reason: 'host-not-ready' })
    this.phase = 'failed'
    this.accepting = false
    this.changed()
  }
  setStoreOwnership(value) {
    if (!['held', 'released', 'unknown'].includes(value) ||
        (this.storeOwnership === 'released' && value !== 'released')) throw invalid('Invalid store ownership transition')
    const previous = this.storeOwnership
    this.storeOwnership = value
    const unexpectedLoss = value !== 'held' && (['starting', 'ready', 'draining'].includes(this.phase) ||
      this.phase === 'stopping' && !['releaseStore', 'cleanupDiscovery', 'closeControl'].includes(this.currentStage))
    if (unexpectedLoss) {
      this.accepting = false
      this.phase = 'failed'
      if (this.controlOperation) {
        const reason = value === 'unknown' ? 'store-ownership-unknown' : 'owner-unavailable'
        this.controlOperation.status = 'blocked'
        this.controlOperation.reason = reason
        this.blockers = [{ kind: 'storage', ref: null, reason, recovery: 'manual-recovery' }]
      }
    }
    if (previous === 'unknown' && value === 'released' && this.currentStage === 'releaseStore' &&
        this.controlOperation?.status === 'blocked') {
      // A late successful release resolves ownership uncertainty. The
      // operation still needs explicit retry for discovery/control cleanup.
      this.blockers = this.blockers.map(blocker => blocker.recovery === 'manual-recovery'
        ? { ...blocker, recovery: 'retry' } : blocker)
    }
    this.changed()
  }
  assertGeneration(expectedGeneration) {
    if (expectedGeneration !== this.generation)
      throw new KernelError('CONFLICT', 'Host generation changed', { reason: 'stale-generation' })
  }
  assertStoreHeld() {
    if (this.storeOwnership !== 'held')
      throw new KernelError('PRECONDITION_FAILED', 'Host ownership does not permit cleanup',
        { reason: this.storeOwnership === 'unknown' ? 'store-ownership-unknown' : 'owner-unavailable' })
  }
  assertAcceptingBusiness() {
    if (!this.accepting || this.phase !== 'ready' || this.storeOwnership !== 'held') {
      throw new KernelError('PRECONDITION_FAILED', 'Host is draining', { reason: 'host-draining' })
    }
  }
  beginAdmission() {
    this.assertAcceptingBusiness()
    const lease = {}
    this.admissions.add(lease)
    let released = false
    return () => {
      if (released) return
      released = true
      this.admissions.delete(lease)
      if (!this.admissions.size) {
        for (const wake of this.admissionWaiters) wake()
        this.admissionWaiters.clear()
      }
    }
  }
  async waitAdmissions() {
    while (this.admissions.size) {
      await new Promise(resolve => this.admissionWaiters.add(resolve))
    }
  }
  state({ expectedGeneration } = {}) {
    if (expectedGeneration !== undefined) this.assertGeneration(expectedGeneration)
    let revision
    try { revision = this.getStateRevision() } catch { revision = null }
    const stateRevision = Number.isSafeInteger(revision) && revision >= 0 ? revision : null
    const blockers = this.blockers.slice(0, 100)
    return { dataDomainRef: this.dataDomainRef, generation: this.generation, lifetime: this.lifetime,
      state: this.phase, storeOwnership: this.storeOwnership, acceptingBusiness: this.accepting,
      stateRevision, synchronization: stateRevision === null ? 'control-only' : 'p04',
      operationId: this.controlOperation?.operationId ?? null, blockers,
      blockersTruncated: this.blockers.length > 100 }
  }
  operation(operationId, { expectedGeneration } = {}) {
    this.assertGeneration(expectedGeneration)
    const op = this.controlOperation
    if (!op || operationId !== op.operationId)
      throw new KernelError('NOT_FOUND', 'Host operation not found', { reason: 'operation-absent' })
    const blockers = this.blockers.slice(0, 100)
    return { operationId: op.operationId, generation: this.generation, intent: op.intent,
      phase: op.phase, status: op.status, remainingMs: this.deadline?.remainingMs() ?? 0,
      reason: op.reason, safeToExit: ['drained', 'completed'].includes(op.status), blockers,
      blockersTruncated: this.blockers.length > 100 }
  }
  drain({ expectedGeneration, budgetMs }) { return this.accept('drain', expectedGeneration, budgetMs) }
  exit({ expectedGeneration, budgetMs }) { return this.accept('exit', expectedGeneration, budgetMs) }

  accept(intent, expectedGeneration, budgetMs) {
    this.assertGeneration(expectedGeneration)
    // Validate even repeated calls. A duplicate never changes the in-flight deadline.
    if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000)
      throw invalid('budgetMs must be an integer from 1 to 120000')
    const deadline = new HostDeadline(budgetMs)
    let stateChanged = false
    if (this.phase === 'failed') this.assertStoreHeld()
    if (!this.controlOperation) {
      this.assertStoreHeld()
      if (this.phase !== 'ready' && !(intent === 'exit' && this.phase === 'failed'))
        throw new KernelError('PRECONDITION_FAILED', 'Host is not ready to drain', { reason: 'host-not-ready' })
      this.controlOperation = { operationId: randomUUID(), intent, phase: 'gate', status: 'pending', reason: null }
      this.accepting = false // Admission close is atomic with operation creation.
      this.phase = 'draining'
      stateChanged = true
    } else if (intent === 'exit' && this.controlOperation.intent === 'drain') {
      this.controlOperation.intent = 'exit'
      if (this.controlOperation.status === 'drained') {
        this.controlOperation.status = 'pending'
        this.controlOperation.reason = null
        this.phase = 'stopping'
      }
      stateChanged = true
    }
    // A completed drain remains quiescent until it is promoted to exit.
    // Replaying drain must not transiently revisit an earlier phase.
    if (this.controlOperation.status === 'drained' && this.controlOperation.intent === 'drain') {
      return { accepted: true, generation: this.generation, operationId: this.controlOperation.operationId }
    }
    // Service admission gates must close in this same turn, before the
    // Accepted response is observable. Any asynchronous cleanup is a later
    // stage, never a substitute for this synchronous switch.
    if (!this.completed.has('gate') && !this.attempt) {
      try {
        const result = this.stages.gate?.()
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => {})
          throw invalid('Host gate callback must be synchronous')
        }
        this.completed.add('gate')
      } catch (error) {
        this.controlOperation.status = 'blocked'
        this.controlOperation.reason = reasonOf(error)
        this.blockers = [{ kind: 'control', ref: null, reason: this.controlOperation.reason, recovery: 'retry' }]
        this.changed()
        return { accepted: true, generation: this.generation, operationId: this.controlOperation.operationId }
      }
    }
    if (stateChanged) this.changed()
    if (!this.attempt && !this.completed.has('closeControl') && this.storeOwnership !== 'unknown') {
      this.deadline = deadline
      this.controlOperation.status = 'pending'
      this.controlOperation.reason = null
      this.blockers = []
      this.attempt = Promise.resolve().then(() => this.advance(deadline)).catch(error => {
        if (this.completed.has('closeControl')) return
        if (this.phase === 'failed' && this.storeOwnership !== 'held') return
        this.controlOperation.status = 'blocked'
        this.controlOperation.reason = reasonOf(error)
        this.blockers = [{ kind: stageKinds[this.inflight?.key ?? this.currentStage ?? 'gate'], ref: null,
          reason: this.controlOperation.reason,
          recovery: this.storeOwnership === 'unknown' || this.phase === 'failed' ? 'manual-recovery' : 'retry' }]
        this.changed()
      }).finally(() => { this.attempt = null })
    }
    return { accepted: true, generation: this.generation, operationId: this.controlOperation.operationId }
  }

  async runStage(key, callback, deadline) {
    if (this.completed.has(key)) return
    if (['gate', 'admissions', 'work', 'resources', 'storage'].includes(key)) this.assertStoreHeld()
    this.currentStage = key
    if (this.inflight && this.inflight.key !== key)
      throw new KernelError('INTERNAL', 'Another host stage is still running')
    if (!this.inflight) {
      if (deadline.expired()) throw deadlineExceeded()
      const flight = { key, started: false }
      flight.promise = Promise.resolve().then(() => {
        if (deadline.expired()) throw deadlineExceeded()
        flight.started = true
        return callback(deadline)
      }).then(result => {
        this.completed.add(key)
        if (key === 'releaseStore') this.setStoreOwnership('released')
        if (key === 'closeControl') {
          // This may finish after the waiting attempt timed out. Completion
          // is cleanup evidence only; a controller must still observe exit.
          this.controlOperation.status = 'completed'
          this.controlOperation.reason = null
          this.blockers = []
          this.changed()
        }
        return result
      }, error => {
        // The waiting deadline can expire before the stage settles. Preserve
        // the late failure as diagnostic evidence without repeating release
        // or claiming ownership was restored.
        if (this.inflight === flight && this.controlOperation?.status === 'blocked' &&
            this.controlOperation.reason === 'deadline-exceeded') {
          this.controlOperation.reason = reasonOf(error)
          this.blockers = [{ kind: stageKinds[key], ref: null, reason: reasonOf(error),
            recovery: this.storeOwnership === 'unknown' || this.phase === 'failed' ? 'manual-recovery' : 'retry' }]
          this.changed()
        }
        throw error
      }).finally(() => { if (this.inflight === flight) this.inflight = null })
      this.inflight = flight
    }
    const flight = this.inflight
    try { await waitForDeadline(flight.promise, deadline) }
    catch (error) {
      if (key === 'releaseStore' && flight.started && this.storeOwnership === 'held')
        this.setStoreOwnership('unknown')
      throw error
    }
  }
  async advance(deadline) {
    const op = this.controlOperation
    op.phase = 'gate'
    await this.runStage('gate', () => {}, deadline)
    op.phase = 'admissions'
    await this.runStage('admissions', async d => {
      await this.waitAdmissions()
      await this.stages.admissions?.(d)
    }, deadline)
    op.phase = 'work'
    await this.runStage('work', this.stages.work, deadline)
    op.phase = 'resources'
    await this.runStage('resources', this.stages.resources, deadline)
    if (!this.completed.has('storage')) this.assertStoreHeld()
    op.phase = 'quiescent'
    if (op.intent === 'drain') {
      op.status = 'drained'
      op.reason = null
      this.changed()
      if (op.intent === 'drain') return // An observer may have promoted to exit.
    }
    this.phase = 'stopping'
    op.phase = 'storage'
    this.changed()
    await this.runStage('storage', this.stages.storage, deadline)
    op.phase = 'release'
    this.changed()
    if (this.storeOwnership === 'unknown')
      throw new KernelError('PRECONDITION_FAILED', 'Store ownership must be reconciled before retry',
        { reason: 'store-ownership-unknown' })
    if (this.storeOwnership === 'held') await this.runStage('releaseStore', this.stages.releaseStore, deadline)
    await this.runStage('cleanupDiscovery', this.stages.cleanupDiscovery, deadline)
    await this.runStage('closeControl', this.stages.closeControl, deadline)
    op.reason = null
    this.changed()
  }
  finalizationReceipt() {
    if (this.storeOwnership !== 'released' || !this.completed.has('cleanupDiscovery')) return null
    return { type: 'host.finalized', dataDomainRef: this.dataDomainRef, generation: this.generation,
      operationId: this.controlOperation.operationId, storeOwnership: 'released' }
  }
  waitForAttempt() { return this.attempt ?? Promise.resolve() }
}
