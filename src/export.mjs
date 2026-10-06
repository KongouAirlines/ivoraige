import { randomBytes } from 'node:crypto'
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
  async exportDocument(docId, { targetLang, outputs, snapshotId, onMissingAccepted, taskId, outputIndex, signal } = {}) {
    if (typeof targetLang !== 'string' || !targetLang.trim() ||
        !Array.isArray(outputs) || !outputs.length || outputs.some(output =>
          !output || typeof output.format !== 'string' || !/^[a-z][a-z0-9-]*$/.test(output.format) ||
          (output.out !== undefined && (typeof output.out !== 'string' || !output.out.trim())))) {
      throw new KernelError('INVALID_ARGUMENT', 'Specify targetLang and a nonempty list of output formats/paths')
    }
    if (snapshotId !== undefined && (typeof snapshotId !== 'string' || !snapshotId)) {
      throw new KernelError('INVALID_ARGUMENT', 'snapshotId must be a nonempty string')
    }
    if (snapshotId !== undefined && onMissingAccepted !== undefined) {
      throw new KernelError('INVALID_ARGUMENT', 'An existing snapshot fixes its missing-translation decisions')
    }
    const adapters = outputs.map(output => this.outputs.get(output.format))
    const snapshot = snapshotId === undefined
      ? await this.records.createSnapshot(docId, { targetLang, onMissingAccepted: onMissingAccepted ?? 'fail' })
      : this.records.getSnapshot(docId, snapshotId)
    if (snapshot.targetLang !== targetLang) {
      throw new KernelError('PRECONDITION_FAILED', 'Snapshot belongs to a different target language')
    }
    const release = this.records.retainSnapshot(docId, snapshot.id)
    const artifacts = []
    try {
      const frozen = freeze(this.records.resolveSnapshot(docId, snapshot.id))
      for (const adapter of adapters) {
        if (!adapter.supports(frozen.sourceBinding)) {
          throw new KernelError('PRECONDITION_FAILED', `Output ${adapter.id} does not support the frozen source binding`)
        }
      }
      const paths = outputs.map(output => resolve(output.out ?? join(this.root,
        `${snapshot.id}-${randomBytes(6).toString('hex')}.${output.format}`)))
      if (new Set(paths.map(path => process.platform === 'win32' ? path.toLowerCase() : path)).size !== paths.length) {
        throw new KernelError('INVALID_ARGUMENT', 'Output paths must be distinct')
      }
      for (let index = 0; index < outputs.length; index++) {
        // Deliberately unbound: adapters get data and format only, no service object.
        const rebuild = adapters[index].rebuild
        signal?.throwIfAborted()
        const content = await rebuild(frozen, Object.freeze({ format: outputs[index].format,
          ...(signal ? { signal } : {}) }))
        signal?.throwIfAborted()
        if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
          throw new KernelError('INTERNAL', `Output ${adapters[index].id} returned invalid content`)
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
            ...(taskId ? { taskId, outputIndex: outputIndex + index } : {}),
          }))
        } catch (error) {
          await unlink(paths[index]).catch(() => {})
          throw error
        }
      }
      return { snapshotId: snapshot.id, artifacts }
    } catch (error) {
      // Any earlier successful format remains discoverable rather than lost.
      if (artifacts.length) {
        error.details = { ...error.details, snapshotId: snapshot.id, artifactIds: artifacts.map(artifact => artifact.id) }
      }
      throw error
    } finally {
      release()
    }
  }
}
