import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SidecarClient } from '../sidecar.mjs'
import { KernelError } from '../errors.mjs'
import { validatePdfTranslation } from './pdf-text.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new KernelError('PRECONDITION_FAILED', message) }

// This runtime owns files and a subprocess only. It has no Cordis context or model access.
class PdfRuntime {
  constructor({ directory, ...config }) {
    this.directory = directory
    this.client = new SidecarClient({ timeoutMs: 600_000, ...config })
    this.verified = new Map()
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
    let info
    try { info = await stat(path) } catch { fail('Managed PDF source is missing; import the original again') }
    const identity = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
    const cached = this.verified.get(path)
    if (cached?.identity === identity && cached.digest === expected) return
    if (hash(await readFile(path)) !== expected) fail('Managed PDF source changed; import the original again')
    this.verified.set(path, { identity, digest: expected })
  }

  async parse(file) {
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
    const sources = join(this.directory, 'sources')
    await mkdir(sources, { recursive: true })
    const sourcePath = join(sources, `${sourceDigest}.pdf`)
    try { await writeFile(sourcePath, bytes, { flag: 'wx' }) } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    await this.verifySource(sourcePath, sourceDigest)
    const { doc } = await this.request('parse', { path: sourcePath,
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

  async rebuild(frozen, { signal } = {}) {
    const { sourceBinding } = frozen
    for (const item of frozen.units) validatePdfTranslation(sourceBinding, item.unit, item.text)
    await this.verifySource(sourceBinding.sourcePath, sourceBinding.sourceDigest)
    const jobs = join(this.directory, 'work')
    await mkdir(jobs, { recursive: true })
    const temporary = await mkdtemp(join(jobs, 'export-'))
    try {
      const docRef = join(temporary, 'source.json')
      const revisionsRef = join(temporary, 'snapshot.json')
      const out = join(temporary, 'result.pdf')
      await writeFile(docRef, JSON.stringify({ document: frozen.document, sourceBinding }))
      await writeFile(revisionsRef, JSON.stringify(frozen))
      const result = await this.request('rebuild', { docRef, revisionsRef, out, format: 'pdf' }, { signal })
      if (result?.path !== out) fail('PDF component returned an unexpected output path')
      const content = await readFile(out)
      if (!content.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('PDF component returned invalid output')
      return content
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
}

export function Pdf(ctx, config) {
  const runtime = new PdfRuntime(config)
  ctx.effect(() => () => runtime.client.close())
  ctx.effect(() => ctx.get('ivoraige.parse').register({
    id: 'babeldoc',
    status: () => ({ ...runtime.status }),
    match: file => file.format !== undefined ? (file.format.toLowerCase() === 'pdf' ? 1 : 0) :
      /\.pdf$/i.test(file.path ?? file.name ?? '') ? 0.9 : 0,
    parse: file => runtime.parse(file),
    validateTranslation: validatePdfTranslation,
  }))
  ctx.effect(() => ctx.get('ivoraige.outputs').register({
    id: 'pdf', supports: binding => binding?.adapterId === 'babeldoc' && runtime.status.state !== 'unavailable',
    status: () => ({ ...runtime.status }),
    rebuild: (frozen, options) => runtime.rebuild(frozen, options),
  }))
}
Pdf.inject = ['ivoraige.parse', 'ivoraige.outputs']
