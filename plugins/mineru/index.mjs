// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

class KernelError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options)
    this.code = code
    this.details = details
  }
}

const ENGINE_VERSION = '4.0.10'
const BINDING_VERSION = 1
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const runner = fileURLToPath(new URL('./runner.py', import.meta.url))
// Resolve aliases in existing ancestors too: the store may not exist when a
// DSH profile activates, and macOS /var or Windows short/cased names differ
// from the physical store path supplied by the host lock.
function canonicalPath(value) {
  let path = resolve(value)
  const suffix = []
  for (;;) {
    try { return resolve(realpathSync.native(path), ...suffix) }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(path) === path) throw error
      suffix.unshift(basename(path))
      path = dirname(path)
    }
  }
}
// Preserve the physical path's case: NTFS directories can opt into
// case-sensitive names, where A.sqlite and a.sqlite are different stores.
const ownerOf = storePath => sha256(canonicalPath(storePath))
const bundleOf = (root, storePath, sourceDigest, parseOptions) =>
  join(root, 'sources', `${ownerOf(storePath)}-${sha256(JSON.stringify({ sourceDigest,
    ...parseOptions, engineVersion: ENGINE_VERSION }))}`)
const fail = (code, message) => { throw new KernelError(code, message) }
const natural = new Set(['text', 'doc_title', 'paragraph_title', 'title', 'paragraph', 'caption',
  'list_item', 'list-item', 'footnote'])
function unitKind(type) {
  if (type === 'title' || type === 'heading' || type === 'doc_title' || type === 'paragraph_title') return 'heading'
  if (type === 'caption') return 'caption'
  if (type === 'formula' || type === 'equation') return 'formula'
  if (type === 'code') return 'code'
  if (type === 'reference') return 'reference'
  if (natural.has(type)) return 'body'
  return 'other'
}

// The middle JSON and assets remain opaque to the host. Structured content is
// only a source projection; it is not a replacement for the saved MiddleJson.
export function projectStructured(middle, structured, bundle, files, { projectionVersion = 2 } = {}) {
  if (![1, 2].includes(projectionVersion))
    fail('PRECONDITION_FAILED', 'MinerU text projection version is unsupported')
  if (middle?.schema !== 'docvortex.middle' || middle.schema_version !== '2.0' ||
      !Array.isArray(middle.pages) || !Array.isArray(structured?.pages))
    fail('UPSTREAM_FAILURE', 'MinerU returned an unsupported document structure')
  const units = []
  let nestedText = false
  const pages = new Map(structured.pages.map(page => [page.page_idx, page]))
  for (const page of middle.pages) {
    const pageIndex = page.page_idx
    const view = pages.get(pageIndex)
    if (!Number.isSafeInteger(pageIndex) || !Array.isArray(page.blocks) ||
        !view || !Array.isArray(view.blocks) || view.blocks.length !== page.blocks.length)
      fail('UPSTREAM_FAILURE', 'MinerU structured pages do not align with MiddleJson')
    for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
      const block = page.blocks[blockIndex]
      const rendered = view.blocks[blockIndex]
      // MinerU 4.0.10 structured content deliberately omits MiddleJson's
      // index (which may have gaps). Its stable alignment here is page,
      // ordered position, type and bbox, not a fabricated structured index.
      if (block?.type !== rendered?.type || !Array.isArray(block.bbox) ||
          JSON.stringify(block.bbox) !== JSON.stringify(rendered.bbox))
        fail('UPSTREAM_FAILURE', 'MinerU structured block identity differs from MiddleJson')
      const content = rendered.content
      const text = typeof content === 'string' ? content :
        typeof content?.text === 'string' ? content.text : ''
      const translatable = natural.has(block.type) && !!text.trim()
      const sourceText = text.trim() ? text : `[${block.type ?? 'block'}]`
      const parentLocator = { pageIndex, blockIndex, index: block.index,
        ...(Array.isArray(block.bbox) ? { bbox: block.bbox } : {}) }
      const annotations = (part, field) => {
        const entries = rendered[field] ?? []
        if (!Array.isArray(entries) || (entries.length && !Array.isArray(block.content)))
          fail('UPSTREAM_FAILURE', 'MinerU annotation structure is invalid')
        const children = (Array.isArray(block.content) ? block.content : [])
          .map((child, childOrder) => ({ child, childOrder }))
          .filter(({ child }) => typeof child?.type === 'string' &&
            (child.type === part || child.type.endsWith(`_${part}`)))
          // DocVortex structured_content sorts annotations by source index,
          // with absent indexes last and physical position as the tie-breaker.
          .sort((left, right) => {
            const a = left.child.index, b = right.child.index
            if (a == null) return b == null ? left.childOrder - right.childOrder : 1
            if (b == null) return -1
            return a - b || left.childOrder - right.childOrder
          })
        return entries.map((entry, itemIndex) => {
          const { child, childOrder } = children[itemIndex] ?? {}
          if (!child || typeof entry?.content !== 'string' ||
              (Array.isArray(child.bbox) && Array.isArray(entry.bbox) &&
                JSON.stringify(child.bbox) !== JSON.stringify(entry.bbox)))
            fail('UPSTREAM_FAILURE', 'MinerU annotation does not align with MiddleJson')
          if (!entry.content.trim()) return null
          nestedText = true
          return { kind: part === 'caption' ? 'caption' : 'body',
            sourceText: entry.content, translatable: true,
            locator: { ...parentLocator, part, itemIndex, childOrder,
              childType: child.type, ...(child.index === undefined ? {} : { childIndex: child.index }),
              ...(Array.isArray(child.bbox) ? { childBbox: child.bbox } : {}) } }
        }).filter(Boolean)
      }
      if (projectionVersion === 2)
        for (const annotation of annotations('caption', 'captions'))
          units.push({ ...annotation, order: units.length })
      units.push({ order: units.length, kind: unitKind(block.type), sourceText,
        translatable, locator: parentLocator })
      if (projectionVersion === 2)
        for (const annotation of annotations('footnote', 'footnotes'))
          units.push({ ...annotation, order: units.length })
    }
  }
  if (!units.length) fail('UPSTREAM_FAILURE', 'MinerU returned no document blocks')
  const resources = files.filter(file => file.path.startsWith('images/')).map(file => ({
    id: file.path, mediaType: mediaType(file.path), contentDigest: file.sha256, version: 'mineru-assets@1',
  }))
  return { format: 'pdf', title: 'PDF document', units, chapters: [], resources,
    sourceBinding: { adapterId: 'mineru', bindingSchemaVersion: BINDING_VERSION,
      engineVersion: ENGINE_VERSION, middleSchema: 'docvortex.middle', middleSchemaVersion: '2.0',
      bundlePath: bundle, files, ...(nestedText ? { projectionVersion: 2 } : {}) } }
}

export async function verifyMineruBundle(binding, { directory, storePath }) {
  if (binding?.adapterId !== 'mineru' || binding.bindingSchemaVersion !== BINDING_VERSION ||
      binding.engineVersion !== ENGINE_VERSION || typeof directory !== 'string' ||
      typeof storePath !== 'string' || typeof binding.bundlePath !== 'string' ||
      !/^[a-f0-9]{64}$/.test(binding.sourceDigest ?? '') ||
      !Array.isArray(binding.files)) fail('PRECONDITION_FAILED', 'MinerU source binding is incompatible')
  const root = canonicalPath(directory)
  const expected = bundleOf(root, storePath, binding.sourceDigest, binding.parseOptions)
  if (binding.bundlePath !== expected || binding.sourcePath !== join(expected, 'source.pdf'))
    fail('PRECONDITION_FAILED', 'MinerU source binding is outside its owning store')
  let files
  try {
    if (await realpath(root) !== root ||
        await realpath(join(root, 'sources')) !== join(root, 'sources') ||
        await realpath(expected) !== expected)
      fail('PRECONDITION_FAILED', 'MinerU source resources escape their managed directory')
    files = await inventory(expected)
  }
  catch { fail('PRECONDITION_FAILED', 'MinerU source resources are missing') }
  if (JSON.stringify(files) !== JSON.stringify(binding.files))
    fail('PRECONDITION_FAILED', 'MinerU source resources changed')
  return true
}

function mediaType(path) {
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg'
  if (/\.webp$/i.test(path)) return 'image/webp'
  return 'application/octet-stream'
}

async function inventory(root, prefix = '') {
  const files = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await inventory(root, path))
    else if (entry.isFile()) {
      const bytes = await readFile(join(root, path))
      files.push({ path, sha256: sha256(bytes), size: bytes.length })
    } else fail('UPSTREAM_FAILURE', 'MinerU saved an unsupported resource type')
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function MinerUSource(ctx, config = {}) {
  const { directory, command = 'python', tier = 'flash', ocrMode = 'auto', timeoutMs = 600_000,
    runner: selectedRunner = runner } = config
  const storePath = ctx.get('ivoraige.storePath')
  if (typeof directory !== 'string' || !directory || typeof storePath !== 'string' || !storePath ||
      (config.storePath !== undefined && (typeof config.storePath !== 'string' || !config.storePath ||
        canonicalPath(config.storePath) !== canonicalPath(storePath))) ||
      typeof command !== 'string' || !command ||
      typeof selectedRunner !== 'string' || !selectedRunner ||
      !['flash', 'standard'].includes(tier) || !['auto', 'txt', 'ocr'].includes(ocrMode) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    fail('INVALID_ARGUMENT', 'MinerU requires directory, storePath, Python command and supported parse options')
  const requestedRoot = resolve(directory)
  try {
    if (lstatSync(requestedRoot).isSymbolicLink())
      fail('PRECONDITION_FAILED', 'MinerU directory must not be a symlink')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const root = canonicalPath(directory)
  const status = { state: 'unchecked', message: 'MinerU is checked on first import' }
  const client = ctx.get('ivoraige.sidecarFactory').create({ command, args: [selectedRunner], timeoutMs })
  ctx.effect(() => () => client.close())
  const parse = async (file, persist, isReferenced) => {
    const bytes = file.content ?? await readFile(file.path)
    if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      fail('INVALID_ARGUMENT', 'Input is not a PDF file')
    const sourceDigest = sha256(bytes)
    const work = join(root, 'work')
    await mkdir(root, { recursive: true })
    if (await realpath(root) !== root) fail('PRECONDITION_FAILED', 'MinerU directory must not be a symlink')
    await mkdir(work, { recursive: true })
    if (await realpath(work) !== work) fail('PRECONDITION_FAILED', 'MinerU work directory must not be a symlink')
    const temporary = await mkdtemp(join(work, 'parse-'))
    const saved = join(temporary, 'saved')
    let retainTemporary = false
    try {
      await mkdir(saved)
      const source = join(temporary, 'source.pdf')
      await writeFile(source, bytes)
      const response = await client.request('parse', { path: source,
        options: { outputDir: saved, tier, ocrMode } },
        { signal: file.signal })
      if (response?.doc?.engineVersion !== ENGINE_VERSION || response.doc.schema !== 'docvortex.middle' ||
          response.doc.schemaVersion !== '2.0') fail('UPSTREAM_FAILURE', 'MinerU response version is incompatible')
      await writeFile(join(saved, 'source.pdf'), bytes)
      const files = await inventory(saved)
      if (!['middle_json.json', 'structured_content.json', 'markdown.md', 'source.pdf']
        .every(path => files.some(file => file.path === path)))
        fail('UPSTREAM_FAILURE', 'MinerU saved result is incomplete')
      const middle = JSON.parse(await readFile(join(saved, 'middle_json.json'), 'utf8'))
      const structured = JSON.parse(await readFile(join(saved, 'structured_content.json'), 'utf8'))
      const bundlePath = bundleOf(root, storePath, sourceDigest, { tier, ocrMode })
      const result = projectStructured(middle, structured, bundlePath, files)
      result.title = file.title ?? (file.path ? basename(file.path) : file.name ?? 'PDF document')
      result.sourceBinding.sourceDigest = sourceDigest
      result.sourceBinding.sourcePath = join(bundlePath, 'source.pdf')
      result.sourceBinding.parseOptions = { tier, ocrMode }
      file.signal?.throwIfAborted()
      await mkdir(dirname(bundlePath), { recursive: true })
      if (await realpath(dirname(bundlePath)) !== dirname(bundlePath))
        fail('PRECONDITION_FAILED', 'MinerU sources directory must not be a symlink')
      let created = false
      try { await rename(saved, bundlePath); created = true }
      catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
        await verifyMineruBundle({ ...result.sourceBinding, files }, { directory: root, storePath })
      }
      status.state = 'ready'; status.message = 'MinerU parse completed'
      try {
        await verifyMineruBundle(result.sourceBinding, { directory: root, storePath })
        return await persist(result)
      }
      catch (error) {
        if (created && !isReferenced(result.sourceBinding.sourcePath) &&
            await realpath(dirname(bundlePath)).catch(() => null) === dirname(bundlePath) &&
            await realpath(bundlePath).catch(() => null) === bundlePath)
          await rm(bundlePath, { recursive: true, force: true })
        throw error
      }
    } catch (error) {
      retainTemporary = error.details?.terminationFailed === true
      const absent = error.code === 'COMPONENT_MISSING'
      if (absent) status.state = 'unavailable'
      status.message = absent ? 'MinerU 4.0.10 or its local assets are unavailable' :
        'Last MinerU import failed; retry or inspect local diagnostics'
      if (error instanceof KernelError) throw error
      const publicError = new KernelError(absent ? 'COMPONENT_MISSING' : 'UPSTREAM_FAILURE',
        absent ? 'MinerU 4.0.10 or its local assets are unavailable' : 'MinerU import failed',
        { ...(error.details?.canceled ? { canceled: true } : {}),
          ...(error.details?.terminationFailed ? { terminationFailed: true } : {}) }, { cause: error })
      throw publicError
    } finally {
      if (!retainTemporary && await realpath(work).catch(() => null) === work &&
          await realpath(temporary).catch(() => null) === temporary)
        await rm(temporary, { recursive: true, force: true })
    }
  }
  ctx.effect(() => ctx.get('ivoraige.parse').register({
    id: 'mineru', version: '0.1.0', bindingSchemaVersion: BINDING_VERSION,
    formats: ['pdf'], inputKinds: ['bytes', 'managed-resource'], cancellable: true,
    importMode: 'queued', status: () => ({ ...status }),
    match: file => file.format !== undefined ? (file.format.toLowerCase() === 'pdf' ? 1 : 0) :
      /\.pdf$/i.test(file.path ?? file.name ?? '') ? 0.9 : 0,
    parse: () => fail('PRECONDITION_FAILED', 'Use document import to retain MinerU resources'),
    import: (file, persist, isReferenced) => parse(file, persist, isReferenced),
    readableText: (_binding, _unit, text) => text,
  }))
}
MinerUSource.inject = ['ivoraige.parse', 'ivoraige.sidecarFactory', 'ivoraige.storePath']

export default MinerUSource
