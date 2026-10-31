// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

export class Exporter extends Service {
  static inject = ['ivoraige.records', 'ivoraige.outputs']

  constructor(ctx, { root }) {
    super(ctx, 'ivoraige.export')
    this.records = ctx.get('ivoraige.records')
    this.outputs = ctx.get('ivoraige.outputs')
    this.root = root
  }

  // Kernel rendering primitive used by the durable export task queue.
  async exportDocument(docId, { contentMode = 'accepted-translation', targetLang, outputs, snapshotId,
    onMissingAccepted, taskId, outputIndex, signal } = {}) {
    if (!['source', 'accepted-translation'].includes(contentMode) ||
        (contentMode === 'source' ? targetLang !== undefined : typeof targetLang !== 'string' || !targetLang.trim()) ||
        !Array.isArray(outputs) || !outputs.length || outputs.some(output =>
          !output || typeof output.format !== 'string' || !/^[a-z][a-z0-9-]*$/.test(output.format) ||
          (output.out !== undefined && (typeof output.out !== 'string' || !output.out.trim())))) {
      throw new KernelError('INVALID_ARGUMENT', 'Specify a valid content mode and output formats/paths')
    }
    if (snapshotId !== undefined && (typeof snapshotId !== 'string' || !snapshotId)) {
      throw new KernelError('INVALID_ARGUMENT', 'snapshotId must be a nonempty string')
    }
    if (snapshotId !== undefined && onMissingAccepted !== undefined) {
      throw new KernelError('INVALID_ARGUMENT', 'An existing snapshot fixes its missing-translation decisions')
    }
    // Reject unavailable or changed implementations before creating a snapshot.
    // Frozen-stage selection below repeats this check against the pinned binding.
    const source = snapshotId === undefined ? this.records.record(docId) : this.records.resolveSnapshot(docId, snapshotId)
    const binding = source.sourceBinding
    for (const output of outputs) this.outputs.get(output.format,
      { adapterId: output.adapterId, adapterVersion: output.adapterVersion, binding, provenance: source.document, contentMode })
    const snapshot = snapshotId === undefined
      ? await this.records.createSnapshot(docId, { contentMode, targetLang,
        onMissingAccepted: onMissingAccepted ?? 'fail' })
      : this.records.getSnapshot(docId, snapshotId)
    let release, failure
    const artifacts = []
    try {
      if (snapshot.targetLang !== targetLang || (snapshot.contentMode ?? 'accepted-translation') !== contentMode)
        throw new KernelError('PRECONDITION_FAILED', 'Snapshot mode or target language mismatch')
      release = this.records.retainSnapshot(docId, snapshot.id)
      const frozen = freeze(this.records.resolveSnapshot(docId, snapshot.id))
      const adapters = outputs.map(output => this.outputs.get(output.format,
        { adapterId: output.adapterId, adapterVersion: output.adapterVersion, binding: frozen.sourceBinding,
          provenance: frozen.document, contentMode }))
      const paths = outputs.map(output => resolve(output.out ?? join(this.root,
        `${snapshot.id}-${randomBytes(6).toString('hex')}.${output.format}`)))
      if (new Set(paths.map(path => process.platform === 'win32' ? path.toLowerCase() : path)).size !== paths.length) {
        throw new KernelError('INVALID_ARGUMENT', 'Output paths must be distinct')
      }
      for (let index = 0; index < outputs.length; index++) {
        // Deliberately unbound: adapters get data and format only, no service object.
        const rebuild = adapters[index].rebuild
        signal?.throwIfAborted()
        const requiredViews = adapters[index].requiredViews ?? []
        let view = frozen
        if (requiredViews.length) {
          const parser = this.ctx.get('ivoraige.parse')
          if (!parser) throw new KernelError('COMPONENT_MISSING', 'Source adapter registry is unavailable')
          view = freeze(parser.projectOutputView(frozen, { views: requiredViews }))
        }
        const rendered = await rebuild(view, Object.freeze({ format: outputs[index].format,
          ...(signal ? { signal } : {}) }))
        signal?.throwIfAborted()
        const wrapped = rendered !== null && typeof rendered === 'object' && !Buffer.isBuffer(rendered)
        const content = wrapped ? rendered.content : rendered
        const warnings = wrapped ? rendered.warnings ?? [] : []
        if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
          throw new KernelError('INTERNAL', `Output ${adapters[index].id} returned invalid content`)
        }
        if (!Array.isArray(warnings) || !warnings.every(value => typeof value === 'string')) {
          throw new KernelError('INTERNAL', `Output ${adapters[index].id} returned invalid warnings`)
        }
        await mkdir(dirname(paths[index]), { recursive: true })
        try {
          // Existing artifacts keep their bytes; repeated exports get new files.
          await writeFile(paths[index], content, { flag: 'wx' })
        } catch (error) {
          if (error.code === 'EEXIST') throw new KernelError('CONFLICT', 'Output path already exists', { path: paths[index] })
          throw error
        }
        try {
          signal?.throwIfAborted()
          artifacts.push(await this.records.addArtifact(docId, {
            snapshotId: snapshot.id, targetLang, format: outputs[index].format, path: paths[index],
            adapterId: adapters[index].id,
            adapterVersion: adapters[index].version ?? 'unversioned',
            managedFile: outputs[index].out === undefined,
            ...(outputs[index].out === undefined ? { fileDigest: createHash('sha256').update(content).digest('hex') } : {}),
            ...(warnings.length ? { warnings } : {}),
            ...(taskId ? { taskId, outputIndex: outputIndex + index } : {}),
          }))
        } catch (error) {
          await unlink(paths[index]).catch(() => {})
          throw error
        }
      }
      return { snapshotId: snapshot.id, artifacts,
        warnings: artifacts.flatMap(artifact => artifact.warnings ?? []) }
    } catch (error) {
      failure = error
      // Any earlier successful format remains discoverable rather than lost.
      if (artifacts.length) {
        error.details = { ...error.details, snapshotId: snapshot.id, artifactIds: artifacts.map(artifact => artifact.id) }
      }
      throw error
    } finally {
      release?.()
      if (failure && snapshotId === undefined && !taskId && !artifacts.length) {
        try { await this.records.deleteSnapshot(docId, snapshot.id) }
        catch (error) {
          failure.details = { ...failure.details, snapshotId: snapshot.id,
            snapshotCleanupError: error.message }
        }
      }
    }
  }
}
