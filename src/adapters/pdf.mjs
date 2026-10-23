// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, rm, stat, copyFile, realpath, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { SidecarClient } from '../sidecar.mjs'
import { KernelError } from '../errors.mjs'
import { readablePdfText, validatePdfTranslation } from './pdf-text.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new KernelError('PRECONDITION_FAILED', message) }

// This runtime owns files and a subprocess only. It has no Cordis context or model access.
class PdfRuntime {
  constructor({ directory, storePath, ...config }) {
    this.directory = resolve(directory)
    // The canonical store is exclusively locked for this runtime's lifetime.
    // Different databases may share the PDF directory, but must never share a
    // newly published file: cleanup can only inspect this store's references.
    // Standalone plugin mounts can inspect availability without a database.
    // Source capture still requires an owning store.
    this.sourceOwner = storePath ? hash(storePath) : null
    this.client = new SidecarClient({ timeoutMs: 600_000, ...config })
    this.verified = new Map()
    this.sourceLocks = new Map()
    this.status = { state: 'unchecked', message: 'PDF component configured; verified on first import or export' }
  }

  async request(method, params, options) {
    try {
      const result = await this.client.request(method, params, options)
      this.status = { state: 'ready', message: 'PDF component handshake and configuration succeeded' }
      return result
    } catch (error) {
      if (error.code === 'COMPONENT_MISSING') this.status = { state: 'unavailable', message: error.message }
      throw error
    }
  }

  async verifySource(path, expected) {
    let info, actual
    try { info = await stat(path); actual = await realpath(path) }
    catch { fail('Managed PDF source is missing; import the original again') }
    if (!info.isFile() || actual !== resolve(path)) fail('Managed PDF source escapes its managed directory')
    const identity = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
    const cached = this.verified.get(path)
    if (cached?.identity === identity && cached.digest === expected) return
    if (hash(await readFile(path)) !== expected) fail('Managed PDF source changed; import the original again')
    this.verified.set(path, { identity, digest: expected })
  }

  async managedRoot() {
    const root = join(this.directory, 'sources')
    let parent, actual
    try { parent = await realpath(this.directory); actual = await realpath(root) }
    catch { fail('Managed PDF source directory is missing; import the original again') }
    if (actual !== join(parent, 'sources') || parent !== resolve(this.directory)) {
      fail('Managed PDF source directory escapes the current store')
    }
    return root
  }

  async exportSource(binding) {
    const { sourcePath, sourceDigest } = binding
    if (typeof sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(sourceDigest) ||
        typeof sourcePath !== 'string' || !isAbsolute(sourcePath) ||
        basename(dirname(sourcePath)) !== 'sources' ||
        basename(dirname(dirname(sourcePath))) !== basename(this.directory)) {
      fail('PDF source binding has an invalid managed path')
    }
    const savedName = basename(sourcePath)
    if (savedName !== `${sourceDigest}.pdf` &&
        !new RegExp(`^[a-f0-9]{64}-${sourceDigest}\\.pdf$`).test(savedName)) {
      fail('PDF source binding filename does not match its digest')
    }
    const root = await this.managedRoot()
    const owned = join(root, `${this.sourceOwner}-${sourceDigest}.pdf`)
    const local = join(root, savedName)
    // An owned copy takes precedence. The saved basename also supports legacy
    // digest-only records and stores moved together with their PDF directory.
    let path = owned
    try { await stat(owned) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      path = local
    }
    await this.verifySource(path, sourceDigest)
    return path
  }

  async capture(file, temporary) {
    if (!this.sourceOwner) fail('PDF import requires a store-owned source directory')
    if ((file.path === undefined) === (file.content === undefined)) {
      throw new KernelError('INVALID_ARGUMENT', 'PDF requires exactly one of path or binary content')
    }
    if (file.content !== undefined && !Buffer.isBuffer(file.content)) {
      throw new KernelError('INVALID_ARGUMENT', 'PDF content must be binary')
    }
    const bytes = file.content ?? await readFile(file.path)
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      throw new KernelError('INVALID_ARGUMENT', 'Input is not a PDF file')
    }
    const sourceDigest = hash(bytes)
    const sourcePath = join(this.directory, 'sources', `${this.sourceOwner}-${sourceDigest}.pdf`)
    await writeFile(temporary, bytes)
    const { doc } = await this.request('parse', { path: temporary,
      options: { language: file.language ?? 'en' } }, { signal: file.signal, onProgress: file.onProgress })
    if (doc?.format !== 'pdf' || doc.sourceBinding?.adapterId !== 'babeldoc' ||
        !Array.isArray(doc.sourceBinding.records) || !Array.isArray(doc.units) || !doc.units.length) {
      throw new KernelError('UPSTREAM_FAILURE', 'PDF component returned invalid source bindings')
    }
    const orders = new Set(doc.sourceBinding.records.map(item => item.order))
    if (orders.size !== doc.units.length || doc.sourceBinding.records.length !== doc.units.length) {
      fail('PDF source bindings are missing or duplicated')
    }
    for (const unit of doc.units) validatePdfTranslation(doc.sourceBinding, unit, unit.sourceText)
    return { ...doc, title: file.title ?? (file.path ? basename(file.path) : file.name ?? 'PDF document'),
      sourceBinding: { ...doc.sourceBinding, sourcePath, sourceDigest } }
  }

  async publish(temporary, sourcePath, sourceDigest) {
    await mkdir(join(this.directory, 'sources'), { recursive: true })
    await this.managedRoot()
    let created = false
    try { await copyFile(temporary, sourcePath, constants.COPYFILE_EXCL); created = true } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    try { await this.verifySource(sourcePath, sourceDigest) } catch (error) {
      if (created) {
        await rm(sourcePath, { force: true })
        throw error
      }
      // Capture has already hashed the original. Publish the validated bytes
      // beside the destination and replace the damaged file with one rename.
      const replacement = `${sourcePath}.${randomUUID()}.repair`
      try {
        await copyFile(temporary, replacement, constants.COPYFILE_EXCL)
        await this.verifySource(replacement, sourceDigest)
        await rename(replacement, sourcePath)
      } finally { await rm(replacement, { force: true }); this.verified.delete(replacement) }
      this.verified.delete(sourcePath)
      await this.verifySource(sourcePath, sourceDigest)
    }
    return created
  }

  async withSourceLock(sourceDigest, operation) {
    const previous = this.sourceLocks.get(sourceDigest) ?? Promise.resolve()
    let release
    const next = new Promise(resolve => { release = resolve })
    this.sourceLocks.set(sourceDigest, next)
    await previous
    try { return await operation() } finally {
      if (this.sourceLocks.get(sourceDigest) === next) this.sourceLocks.delete(sourceDigest)
      release()
    }
  }

  async parse(file) {
    const work = join(this.directory, 'work')
    await mkdir(work, { recursive: true })
    const temporary = await mkdtemp(join(work, 'import-'))
    try {
      const input = join(temporary, 'source.pdf')
      const parsed = await this.capture(file, input)
      const { sourcePath, sourceDigest } = parsed.sourceBinding
      file.signal?.throwIfAborted()
      await this.withSourceLock(sourceDigest, () => this.publish(input, sourcePath, sourceDigest))
      return parsed
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }

  async import(file, persist, isReferenced) {
    const work = join(this.directory, 'work')
    await mkdir(work, { recursive: true })
    const temporary = await mkdtemp(join(work, 'import-'))
    try {
      const input = join(temporary, 'source.pdf')
      const parsed = await this.capture(file, input)
      const { sourcePath, sourceDigest } = parsed.sourceBinding
      return await this.withSourceLock(sourceDigest, async () => {
        file.signal?.throwIfAborted()
        const created = await this.publish(input, sourcePath, sourceDigest)
        try { return await persist(parsed) } catch (error) {
          // This path belongs to the locked store. Legacy digest-only sources
          // remain readable through saved bindings and are never cleanup targets.
          if (created && !isReferenced(sourcePath)) {
            await rm(sourcePath, { force: true })
            this.verified.delete(sourcePath)
          }
          throw error
        }
      })
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }

  async rebuild(frozen, { signal } = {}) {
    const { sourceBinding } = frozen
    if (frozen.snapshot.contentMode === 'source') {
      signal?.throwIfAborted()
      const sourcePath = await this.exportSource(sourceBinding)
      const content = await readFile(sourcePath)
      if (hash(content) !== sourceBinding.sourceDigest) fail('Managed PDF source changed; import the original again')
      signal?.throwIfAborted()
      return { content }
    }
    for (const item of frozen.units) validatePdfTranslation(sourceBinding, item.unit, item.text)
    const sourcePath = await this.exportSource(sourceBinding)
    const effectiveBinding = { ...sourceBinding, sourcePath }
    const jobs = join(this.directory, 'work')
    await mkdir(jobs, { recursive: true })
    const temporary = await mkdtemp(join(jobs, 'export-'))
    try {
      const docRef = join(temporary, 'source.json')
      const revisionsRef = join(temporary, 'snapshot.json')
      const out = join(temporary, 'result.pdf')
      await writeFile(docRef, JSON.stringify({ document: frozen.document, sourceBinding: effectiveBinding }))
      await writeFile(revisionsRef, JSON.stringify({ ...frozen, sourceBinding: effectiveBinding }))
      const result = await this.request('rebuild', { docRef, revisionsRef, out, format: 'pdf' }, { signal })
      if (result?.path !== out) fail('PDF component returned an unexpected output path')
      const content = await readFile(out)
      if (!content.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('PDF component returned invalid output')
      return { content, warnings: result.evidence?.warnings ?? [] }
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
}

export function Pdf(ctx, config) {
  const runtime = new PdfRuntime(config)
  ctx.effect(() => ctx.get('ivoraige.settingsPages').register({ id: 'pdf', label: 'PDF', order: 20 }))
  ctx.effect(() => () => runtime.client.close())
  ctx.effect(() => ctx.get('ivoraige.parse').register({
    id: 'babeldoc',
    version: '0.1.0', bindingSchemaVersion: 1,
    formats: ['pdf'],
    inputKinds: ['bytes', 'managed-resource'], cancellable: true,
    importMode: 'queued',
    status: () => ({ ...runtime.status }),
    match: file => file.format !== undefined ? (file.format.toLowerCase() === 'pdf' ? 1 : 0) :
      /\.pdf$/i.test(file.path ?? file.name ?? '') ? 0.9 : 0,
    parse: file => runtime.parse(file),
    import: (file, persist, isReferenced) => runtime.import(file, persist, isReferenced),
    validateTranslation: validatePdfTranslation,
    readableText: readablePdfText,
  }))
  ctx.effect(() => ctx.get('ivoraige.outputs').register({
    id: 'pdf', formats: ['pdf'],
    version: '0.1.0',
    canRunUnavailable: contentMode => contentMode === 'source',
    supports: (binding, contentMode) => binding?.adapterId === 'babeldoc' &&
      (contentMode === 'source' || runtime.status.state !== 'unavailable'),
    status: () => ({ ...runtime.status }),
    rebuild: (frozen, options) => runtime.rebuild(frozen, options),
  }))
}
Pdf.inject = ['ivoraige.parse', 'ivoraige.outputs', 'ivoraige.settingsPages']
