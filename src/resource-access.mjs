import { open, lstat, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { sameDirectory } from './managed-path.mjs'

// Both entry protocols read the same saved resource under the same Records lease.
export class ResourceAccess extends Service {
  static inject = ['ivoraige.records']
  constructor(ctx, { maxArtifactBytes = null } = {}) {
    super(ctx, 'ivoraige.resources')
    if (maxArtifactBytes !== null && (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 0))
      throw new KernelError('INVALID_ARGUMENT', 'maxArtifactBytes must be a nonnegative integer or null')
    this.maxArtifactBytes = maxArtifactBytes
    this.opened = new Set()
    this.pending = new Set()
    this.drainTimeoutMs = 30_000
    this.closing = false
    ctx.effect(() => () => this.close())
  }
  artifact(artifactId, { retain = false, docId } = {}) {
    if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Resource access is closing')
    const records = this.ctx.get('ivoraige.records')
    const located = records.locateArtifact(artifactId, { docId })
    const artifact = located.artifact
    const release = retain ? records.retainArtifact(located.docId, artifactId) : undefined
    return { path: artifact.path, filename: basename(artifact.path), ...(release ? { release } : {}),
      contentType: artifact.format === 'json' ? 'application/json; charset=utf-8' :
        artifact.format === 'md' ? 'text/markdown; charset=utf-8' :
          artifact.format === 'pdf' ? 'application/pdf' : 'application/octet-stream' }
  }
  openArtifact(artifactId, options) {
    const pending = this.acquireArtifact(artifactId, options)
    this.pending.add(pending)
    return pending.finally(() => this.pending.delete(pending))
  }
  async acquireArtifact(artifactId, options) {
    if (options?.signal?.aborted) throw new KernelError('UPSTREAM_FAILURE', 'Resource request canceled', { canceled: true })
    const artifact = this.artifact(artifactId, { ...options, retain: true })
    let file
    try {
      file = await open(artifact.path, 'r')
      const info = await file.stat()
      if (options?.signal?.aborted) throw new KernelError('UPSTREAM_FAILURE', 'Resource request canceled', { canceled: true })
      if (!info.isFile()) throw new KernelError('NOT_FOUND', 'Artifact not found')
      if (this.maxArtifactBytes !== null && info.size > this.maxArtifactBytes)
        throw new KernelError('PRECONDITION_FAILED', 'Artifact exceeds configured read limit', { maxArtifactBytes: this.maxArtifactBytes })
      if (this.closing) throw new KernelError('PRECONDITION_FAILED', 'Resource access is closing')
      let closed
      const resource = { ...artifact, file, size: info.size, close: () => {
        if (!closed) closed = (async () => {
          try { await file.close() } finally { artifact.release?.(); this.opened.delete(resource) }
        })()
        return closed
      } }
      this.opened.add(resource)
      return resource
    } catch (error) {
      try { await file?.close() } finally { artifact.release?.() }
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new KernelError('NOT_FOUND', 'Artifact not found')
      throw error
    }
  }
  async readArtifact(artifactId, options) {
    const resource = await this.openArtifact(artifactId, options)
    try { return { bytes: await resource.file.readFile({ signal: options?.signal }), contentType: resource.contentType, filename: resource.filename } }
    finally { await resource.close() }
  }
  async removeOwnedFile(path, fileDigest) {
    try {
      const info = await lstat(path)
      const root = this.ctx.get('ivoraige.export')?.root
      // Compare directory identity, including case and junction aliases.
      if (!await sameDirectory(dirname(resolve(path)), root)) {
        // sameDirectory returns false if the parent disappeared. Confirm that
        // the file still exists before reporting an ownership violation.
        await lstat(path)
        throw new KernelError('PRECONDITION_FAILED', 'Artifact path is outside the managed export directory', { path })
      }
      if (!info.isFile() || info.isSymbolicLink())
        throw new KernelError('PRECONDITION_FAILED', 'Owned artifact path is not a regular file', { path })
      if (!fileDigest || createHash('sha256').update(await readFile(path)).digest('hex') !== fileDigest)
        throw new KernelError('PRECONDITION_FAILED', 'Owned artifact bytes changed; file retained', { path })
      await unlink(path)
    } catch (error) {
      // Absence completes cleanup, including disappearance during validation
      // or unlink. Ownership, digest and other filesystem errors still fail.
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    }
  }
  async close() {
    this.closing = true
    let timer
    try {
      await Promise.race([
        (async () => {
          await Promise.allSettled([...this.pending])
          await Promise.all([...this.opened].map(resource => resource.close()))
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new KernelError(
          'PRECONDITION_FAILED', 'Resource reads did not drain before the deadline')), this.drainTimeoutMs) }),
      ])
    } finally { clearTimeout(timer) }
  }
}
