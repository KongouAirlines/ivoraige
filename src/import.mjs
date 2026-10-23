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

  async importDocument(file, metadata = {}, { taskId, adapterVersion } = {}) {
    const { sourceId, language: sourceLang, origin = 'manual', externalRef } = metadata
    if (!language(sourceLang) || !['manual', 'zotero', 'cli', 'mcp'].includes(origin) ||
        (sourceId !== undefined && (typeof sourceId !== 'string' || !sourceId.trim())) ||
        (externalRef !== undefined && typeof externalRef !== 'string'))
      throw new KernelError('INVALID_ARGUMENT', 'Invalid import metadata')
    await this.records.ready
    return this.parse.importDocument({ ...file, language: sourceLang },
      parsed => this.records.persistParsed(file, { sourceId, language: sourceLang, origin, externalRef }, parsed, { taskId }),
      sourcePath => this.records.referencesSourcePath(sourcePath), { adapterVersion })
  }
}
