import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

const language = value => typeof value === 'string' && value !== 'auto' &&
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)

export class Importer extends Service {
  static inject = ['ivoraige.parse', 'ivoraige.records']

  constructor(ctx) {
    super(ctx, 'ivoraige.import')
    this.parse = ctx.get('ivoraige.parse')
    this.records = ctx.get('ivoraige.records')
  }

  prepare(file, { legacyWire = false, deferSelection = false } = {}) {
    const input = this.parse.prepareInput(file)
    try { return this.parse.selectPrepared(input) }
    catch (error) {
      // Keep the existing 0.1.0 missing-PDF task response in one compatibility
      // boundary. Input adaptation and source scoring remain format-free.
      const legacyPdf = legacyWire && file.adapterId === undefined &&
        (file.format?.toLowerCase() === 'pdf' || /\.pdf$/i.test(file.path ?? '')) &&
        error.code === 'INVALID_ARGUMENT' && error.details?.reason === 'no-source'
      if (!legacyPdf && !(deferSelection && ['INVALID_ARGUMENT', 'COMPONENT_MISSING'].includes(error.code))) throw error
      return Object.freeze({ file: input.file, error })
    }
  }

  async importDocument(file, metadata = {}, { taskId, adapterVersion, selection } = {}) {
    const { sourceId, language: sourceLang, origin = 'manual', externalRef } = metadata
    if (!language(sourceLang) || !['manual', 'zotero', 'cli', 'mcp'].includes(origin) ||
        (sourceId !== undefined && (typeof sourceId !== 'string' || !sourceId.trim())) ||
        (externalRef !== undefined && typeof externalRef !== 'string'))
      throw new KernelError('INVALID_ARGUMENT', 'Invalid import metadata')
    await this.records.ready
    if (selection?.error) throw selection.error
    return this.parse.importDocument({ ...file, language: sourceLang },
      parsed => this.records.persistParsed(file, { sourceId, language: sourceLang, origin, externalRef }, parsed, { taskId }),
      sourcePath => this.records.referencesSourcePath(sourcePath), { adapterVersion, selection })
  }
}
