// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { KernelError } from '../errors.mjs'

export const txt = {
  id: 'txt',
  version: '0.1.0', bindingSchemaVersion: 1,
  formats: ['txt'],
  inputKinds: ['text', 'bytes', 'managed-resource'], cancellable: true,
  readableText: (_binding, _unit, text) => text,
  match(file) {
    if (file.format !== undefined) return file.format.toLowerCase() === 'txt' ? 1 : 0
    return /\.txt$/i.test(file.path ?? file.name ?? '') ? 0.8 : 0
  },
  async parse(file) {
    if (file.content !== undefined && file.path !== undefined) {
      throw new KernelError('INVALID_ARGUMENT', 'Provide either path or content')
    }
    if (file.content !== undefined && typeof file.content !== 'string' && !Buffer.isBuffer(file.content)) {
      throw new KernelError('INVALID_ARGUMENT', 'TXT content must be a string or Buffer')
    }
    if (file.path !== undefined && (typeof file.path !== 'string' || !file.path.trim())) {
      throw new KernelError('INVALID_ARGUMENT', 'path must be a nonempty string')
    }
    const data = file.content === undefined ? await readFile(file.path) : file.content
    let raw = data
    if (Buffer.isBuffer(data)) {
      try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) }
      catch (error) { throw new KernelError('INVALID_ARGUMENT', 'TXT input must be UTF-8 text', {}, { cause: error }) }
    }
    const lines = raw.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
    const units = []
    let start = -1
    let paragraph = []
    const flush = end => {
      if (start < 0) return
      units.push({
        order: units.length,
        kind: 'body',
        sourceText: paragraph.join('\n').trim(),
        locator: { paragraph: units.length + 1, lineStart: start + 1, lineEnd: end + 1 },
        translatable: true,
      })
      start = -1
      paragraph = []
    }
    lines.forEach((line, index) => {
      if (line.trim()) {
        if (start < 0) start = index
        paragraph.push(line)
      } else flush(index - 1)
    })
    flush(lines.length - 1)
    if (!units.length) throw new KernelError('INVALID_ARGUMENT', 'TXT source is empty')
    return {
      format: 'txt',
      title: file.title ?? (file.path ? basename(file.path) : file.name ?? 'Untitled'),
      units,
      chapters: [],
      resources: [],
      sourceBinding: { adapterId: 'txt' },
    }
  },
}

export function TxtSource(ctx) {
  ctx.effect(() => ctx.get('ivoraige.parse').register(txt))
}
TxtSource.inject = ['ivoraige.parse']
