import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { resolve } from 'node:path'

const terminal = new Set(['succeeded', 'failed', 'canceled'])
const active = new Set(['queued', 'running'])
const safeMessage = error => error instanceof KernelError &&
  ['CONFLICT', 'PRECONDITION_FAILED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'COMPONENT_MISSING'].includes(error.code)
  ? error.message : 'Translation failed; check the configured model and retry'

export class Tasks extends Service {
  static inject = ['ivoraige.records', 'jobs']

  constructor(ctx) {
    super(ctx, 'ivoraige.tasks')
    this.records = ctx.get('ivoraige.records')
    this.model = ctx.get('ivoraige.translationModel')
    this.jobs = ctx.get('jobs')
    this.detachController = this.jobs.attachController('ivoraige translation tasks')
    this.listeners = new Set()
    this.running = null
    this.queue = []
    this.closing = false
    this.lastProgressAt = new Map()
    this.waiters = new Map()
    this.scheduling = false
    this.admissions = new Set()
    this.ready = this.recover()
  }

  async recover() {
    await this.records.ready
    for (const task of this.records.listTasks()) {
      if (active.has(task.state)) await this.records.updateTask(task.id, current => ({
        ...current, state: 'paused', updatedAt: new Date().toISOString(),
      }))
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new KernelError('INVALID_ARGUMENT', 'listener must be a function')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type, data) {
    for (const listener of this.listeners) {
      try {
        const result = listener({ type, data: structuredClone(data) })
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {})
      } catch { /* listeners cannot stop work */ }
    }
  }

  async submit(docId, options = {}) {
    await this.ready
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Task service is closing')
    if (options.profileId !== undefined) throw new KernelError('INVALID_ARGUMENT',
      'Translation profiles are not implemented')
    const admission = (async () => {
      const task = await this.records.createTranslationTask(docId, options)
      if (this.closing) {
        await this.records.updateTask(task.id, current => ({ ...current, state: 'paused' }))
      } else {
        this.queue.push(task.id)
        this.emit('task.queued', { taskId: task.id, kind: 'translate' })
        this.schedule()
      }
      return { taskId: task.id }
    })()
    this.admissions.add(admission)
    try { return await admission } finally { this.admissions.delete(admission) }
  }

  async get(taskId) { await this.ready; return this.records.getTask(taskId) }
  async list(filter = {}) { await this.ready; return this.records.listTasks(filter) }

  async importDocument(file, metadata) {
    await this.ready
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Task service is closing')
    const admission = (async () => {
      const start = Date.now()
      const result = await this.records.importDocument(file, metadata)
      const task = await this.records.createOperationTask(result.document.id, { kind: 'import', durationMs: Date.now() - start })
      this.emit('task.succeeded', { taskId: task.id, artifacts: [], stats: task.stats })
      return { ...result, taskId: task.id, warnings: [] }
    })()
    this.admissions.add(admission)
    try { return await admission } finally { this.admissions.delete(admission) }
  }

  async exportDocument(docId, options) {
    await this.ready
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Task service is closing')
    const { targetLang, outputs, snapshotId, onMissingAccepted } = structuredClone(options)
    if (!Array.isArray(outputs) || !outputs.length || outputs.some(item => !item || typeof item.format !== 'string')) {
      throw new KernelError('INVALID_ARGUMENT', 'outputs must contain requested formats')
    }
    if (snapshotId !== undefined && onMissingAccepted !== undefined) throw new KernelError('INVALID_ARGUMENT', 'Snapshot decisions are already frozen')
    const available = this.records.getDocument(docId).availableOutputs
    if (outputs.some(item => !available.includes(item.format))) throw new KernelError('INVALID_ARGUMENT', 'Unsupported output format')
    const paths = outputs.filter(item => item.out !== undefined).map(item => {
      if (typeof item.out !== 'string' || !item.out.trim()) throw new KernelError('INVALID_ARGUMENT', 'Output path must be nonempty')
      const path = resolve(item.out)
      return process.platform === 'win32' ? path.toLowerCase() : path
    })
    if (new Set(paths).size !== paths.length) throw new KernelError('INVALID_ARGUMENT', 'Output paths must be distinct')
    const admission = (async () => {
      const snapshot = snapshotId ? this.records.getSnapshot(docId, snapshotId) :
        await this.records.createSnapshot(docId, { targetLang, onMissingAccepted: onMissingAccepted ?? 'fail' })
      const release = this.records.retainSnapshot(docId, snapshot.id)
      try {
        const task = await this.records.createOperationTask(docId,
          { kind: 'export', targetLang, snapshotId: snapshot.id, outputs })
        if (this.closing) await this.records.updateTask(task.id, current => ({ ...current, state: 'paused' }))
        else { this.queue.push(task.id); this.emit('task.queued', { taskId: task.id, kind: 'export' }); this.schedule() }
        return { taskId: task.id, snapshotId: snapshot.id }
      } finally { release() }
    })()
    this.admissions.add(admission)
    try { return await admission } finally { this.admissions.delete(admission) }
  }

  async wait(taskId) {
    await this.ready
    const task = this.records.getTask(taskId)
    if (terminal.has(task.state) || task.state === 'paused') return task
    return new Promise(resolve => {
      if (!this.waiters.has(taskId)) this.waiters.set(taskId, new Set())
      this.waiters.get(taskId).add(resolve)
    })
  }

  settle(task) {
    if (!terminal.has(task.state) && task.state !== 'paused') return
    for (const resolve of this.waiters.get(task.id) ?? []) resolve(task)
    this.waiters.delete(task.id)
  }

  schedule() {
    if (this.closing || this.running || this.scheduling) return
    this.scheduling = true
    queueMicrotask(() => { this.scheduling = false; void this.dispatch() })
  }

  async dispatch() {
    if (this.closing || this.running) return
    while (this.queue.length) {
      const taskId = this.queue.shift()
      const task = this.records.getTask(taskId)
      if (task.state !== 'queued') continue
      const controller = new AbortController()
      let markStarted
      const started = new Promise(resolve => { markStarted = resolve })
      let markFinished
      const finished = new Promise(resolve => { markFinished = resolve })
      const live = { taskId, controller, jobId: null, done: null, started, markStarted,
        finished, markFinished, pause: false, cancel: false, runStarted: Date.now() }
      this.running = live
      try {
        const taskStarted = await this.records.updateTask(taskId, current => {
          if (current.state !== 'queued') throw new KernelError('CONFLICT', 'Task left queue')
          return { ...current, state: 'running', progress: { ...current.progress, stage: current.kind },
            updatedAt: new Date().toISOString() }
        })
        this.emit('task.started', { taskId, kind: task.kind })
        this.progress(taskStarted, true)
        live.jobId = this.jobs.start({ kind: task.kind, label: `${task.kind} ${task.docId}`,
          run: job => ({ cancel: () => controller.abort(), done: this.execute(live, job) }) })
        live.markStarted()
        if (live.cancel) this.jobs.kill(live.jobId, undefined, 'canceled')
        await live.done
        const job = await this.jobs.wait(live.jobId, 30000)
        if (['completed', 'killed', 'failed'].includes(job.status)) this.jobs.remove(live.jobId)
      } catch (error) {
        live.markStarted()
        if (this.records.getTask(taskId).state === 'running') await this.fail(taskId, error)
      } finally {
        this.running = null
        live.markFinished()
      }
    }
  }

  async execute(live, job) {
    live.done = this.run(live, job)
    return live.done.then(() => ({ status: live.cancel ? 'killed' :
      this.records.getTask(live.taskId).state === 'failed' ? 'failed' : 'completed' }),
      () => ({ status: live.cancel ? 'killed' : 'failed' }))
  }

  withDuration(live, current) {
    const elapsed = Math.max(0, Date.now() - live.runStarted)
    return { ...current, stats: { ...current.stats, stageDurationsMs: {
      ...current.stats.stageDurationsMs,
      [current.kind]: (current.stats.stageDurationsMs[current.kind] ?? 0) + elapsed,
    } } }
  }

  async run(live, job) {
    const { taskId, controller } = live
    try {
      let task = this.records.getTask(taskId)
      for (let index = task.cursor; index < task.progress.total; index++) {
        if (live.cancel || controller.signal.aborted) break
        if (live.pause || this.closing) break
        if (task.kind === 'export') {
          await this.ctx.get('ivoraige.export').exportDocument(task.docId, { targetLang: task.targetLang,
            snapshotId: task.snapshotId, outputs: [task.outputs[index]], taskId, outputIndex: index })
          task = this.records.getTask(taskId)
          job.updateProgress(`${task.progress.done}/${task.progress.total}`)
          this.progress(task)
          continue
        }
        const unitId = task.unitIds[index]
        const view = this.records.getUnit(unitId, { targetLang: task.targetLang })
        const basis = this.records.getBasis(unitId, { targetLang: task.targetLang })
        const baseRevisionId = view.draft?.id ?? view.accepted?.id ?? null
        const expectedAcceptedRevisionId = view.accepted?.id ?? null
        const reusable = this.records.findReusable(unitId, { targetLang: task.targetLang })
        let outcome
        if (reusable) {
          outcome = await this.records.commitTaskUnit(taskId, { unitId, expectedBasis: basis,
            baseRevisionId, expectedAcceptedRevisionId, reusedRevisionId: reusable.id })
        } else {
          if (!this.model) throw new KernelError('COMPONENT_MISSING', 'Configure a translation model before translating')
          await this.records.incrementTaskCall(taskId)
          const result = await this.model.translate({ basis, signal: controller.signal })
          if (live.cancel || controller.signal.aborted) break
          outcome = await this.records.commitTaskUnit(taskId, { unitId, expectedBasis: basis,
            baseRevisionId, expectedAcceptedRevisionId, result })
        }
        task = outcome.task
        job.updateProgress(`${task.progress.done}/${task.progress.total}`)
        this.emit('unit.completed', { taskId, unitId, targetLang: task.targetLang, reused: outcome.reused })
        this.progress(task)
      }
      if (live.cancel) {
        task = await this.records.updateTask(taskId, current => ({ ...this.withDuration(live, current), state: 'canceled',
          updatedAt: new Date().toISOString() }))
        this.emit('task.canceled', { taskId })
      } else if (live.pause || this.closing || controller.signal.aborted) {
        task = await this.records.updateTask(taskId, current => ({ ...this.withDuration(live, current), state: 'paused',
          updatedAt: new Date().toISOString() }))
        this.emit('task.paused', { taskId, cursor: task.cursor })
      } else {
        task = await this.records.updateTask(taskId, current => ({ ...this.withDuration(live, current), state: 'succeeded',
          progress: { ...current.progress, stage: 'complete' }, updatedAt: new Date().toISOString() }))
        this.progress(task, true)
        this.emit('task.succeeded', { taskId, artifacts: task.artifacts, stats: task.stats })
      }
      this.settle(task)
    } catch (error) {
      if (live.cancel || (controller.signal.aborted && this.closing)) {
        const state = live.cancel ? 'canceled' : 'paused'
        const task = await this.records.updateTask(taskId, current => ({ ...this.withDuration(live, current), state,
          updatedAt: new Date().toISOString() }))
        this.emit(`task.${state}`, state === 'paused' ? { taskId, cursor: task.cursor } : { taskId })
        this.settle(task)
      } else await this.fail(taskId, error)
    } finally { this.schedule() }
  }

  progress(task, force = false) {
    const at = Date.now()
    const last = this.lastProgressAt.get(task.id) ?? 0
    if (!force && at - last < 500) return
    this.lastProgressAt.set(task.id, at)
    this.emit('task.progress', { taskId: task.id, stage: task.progress.stage,
      done: task.progress.done, total: task.progress.total })
  }

  async fail(taskId, error) {
    const message = safeMessage(error)
    const task = await this.records.updateTask(taskId, current => ({
      ...(this.running?.taskId === taskId ? this.withDuration(this.running, current) : current), state: 'failed',
      error: { stage: current.kind, ...(current.unitIds?.[current.cursor] ?
        { unitId: current.unitIds[current.cursor] } : {}), message },
      updatedAt: new Date().toISOString() }))
    this.emit('task.failed', { taskId, ...task.error })
    this.settle(task)
  }

  async pause(taskId) {
    await this.ready
    const task = this.records.getTask(taskId)
    if (task.state === 'paused') return task
    if (task.state === 'queued') {
      if (this.running?.taskId === taskId) this.running.pause = true
      const next = await this.records.updateTask(taskId, current => current.state === 'queued' ?
        { ...current, state: 'paused' } : current)
      if (next.state === 'running' && this.running?.taskId === taskId) this.running.pause = true
      if (next.state !== 'paused') return this.wait(taskId)
      this.emit('task.paused', { taskId, cursor: next.cursor })
      this.settle(next)
      return next
    }
    if (task.state !== 'running') throw new KernelError('PRECONDITION_FAILED', 'Task cannot be paused')
    if (this.running?.taskId === taskId) this.running.pause = true
    return this.wait(taskId)
  }

  async cancel(taskId) {
    await this.ready
    const task = this.records.getTask(taskId)
    if (task.state === 'canceled') return task
    if (task.state === 'queued' || task.state === 'paused') {
      if (this.running?.taskId === taskId) {
        this.running.cancel = true
        this.running.controller.abort()
        if (this.running.jobId) this.jobs.kill(this.running.jobId, undefined, 'canceled')
      }
      const next = await this.records.updateTask(taskId, current =>
        ['queued', 'paused'].includes(current.state) ? { ...current, state: 'canceled' } : current)
      if (next.state === 'running' && this.running?.taskId === taskId) {
        this.running.cancel = true
        this.running.controller.abort()
        if (this.running.jobId) this.jobs.kill(this.running.jobId, undefined, 'canceled')
      }
      if (next.state !== 'canceled') return this.wait(taskId)
      this.emit('task.canceled', { taskId })
      this.settle(next)
      return next
    }
    if (task.state !== 'running') throw new KernelError('PRECONDITION_FAILED', 'Task cannot be canceled')
    if (this.running?.taskId === taskId) {
      this.running.cancel = true
      this.running.controller.abort()
      if (this.running.jobId) this.jobs.kill(this.running.jobId, undefined, 'canceled')
    }
    return this.wait(taskId)
  }

  async resume(taskId) {
    await this.ready
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Task service is closing')
    const task = this.records.getTask(taskId)
    if (task.profileId !== undefined) throw new KernelError('INVALID_ARGUMENT',
      'Translation profiles are not implemented')
    if (!['paused', 'failed'].includes(task.state)) throw new KernelError('PRECONDITION_FAILED', 'Task cannot be resumed')
    const admission = (async () => {
      const queued = await this.records.updateTask(taskId, current => {
        if (!['paused', 'failed'].includes(current.state)) throw new KernelError('CONFLICT', 'Task state changed')
        if (current.kind === 'translate') this.records.validateTaskCheckpoints(taskId)
        else if (current.kind === 'export') this.records.getSnapshot(current.docId, current.snapshotId)
        else throw new KernelError('PRECONDITION_FAILED', 'Import tasks cannot be resumed')
        const { error, ...rest } = current
        return { ...rest, state: 'queued' }
      })
      if (this.closing) return this.records.updateTask(taskId, current => ({ ...current, state: 'paused' }))
      this.queue.push(taskId)
      this.emit('task.resumed', { taskId, cursor: queued.cursor })
      this.emit('task.queued', { taskId, kind: queued.kind })
      this.schedule()
      return queued
    })()
    this.admissions.add(admission)
    try { return await admission } finally { this.admissions.delete(admission) }
  }

  async close() {
    await this.ready
    this.closing = true
    await Promise.allSettled([...this.admissions])
    for (const taskId of this.queue.splice(0)) {
      const task = this.records.getTask(taskId)
      if (task.state === 'queued') {
        const paused = await this.records.updateTask(taskId, current => ({ ...current, state: 'paused',
          updatedAt: new Date().toISOString() }))
        this.settle(paused)
      }
    }
    const live = this.running
    if (live) {
      live.pause = true
      live.controller.abort()
      await live.started
      await live.done
      await live.finished
    }
    this.detachController()
  }
}
