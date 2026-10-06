import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { KernelError } from '../errors.mjs'

const invalid = message => { throw new KernelError('INVALID_ARGUMENT', `Unsupported Markdown: ${message}`) }

function linesOf(raw) {
  const lines = []
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g
  let match
  while ((match = pattern.exec(raw)) && match[0]) {
    const whole = match[0]
    lines.push({ text: whole.replace(/\r\n$|[\r\n]$/, ''), start: match.index, end: match.index + whole.length })
  }
  return lines
}

function inline(raw, from, to, add, kind) {
  let cursor = from
  let run = from
  const flush = end => {
    const value = raw.slice(run, end)
    const leading = value.match(/^\s*/u)[0].length
    const trailing = value.match(/\s*$/u)[0].length
    const start = run + leading
    const stop = Math.max(start, end - trailing)
    if (stop > start && /[\p{L}\p{N}]/u.test(raw.slice(start, stop))) add(start, stop, kind)
  }
  const protect = end => { flush(cursor); cursor = end; run = end }
  while (cursor < to) {
    const ch = raw[cursor]
    if (ch === '\\') {
      if (cursor + 1 >= to) invalid('dangling backslash escape')
      if (raw[cursor + 1] === '(' || raw[cursor + 1] === '[') invalid('backslash-delimited math')
      protect(cursor + 2)
    } else if (ch === '`') {
      const ticks = /^`+/.exec(raw.slice(cursor, to))[0]
      const close = raw.indexOf(ticks, cursor + ticks.length)
      if (close < 0 || close + ticks.length > to) invalid('unclosed inline code')
      protect(close + ticks.length)
    } else if (ch === '$') {
      if (raw[cursor + 1] === '$') invalid('inline double-dollar math')
      let close = cursor + 1
      while ((close = raw.indexOf('$', close)) >= 0 && close < to && raw[close - 1] === '\\') close++
      if (close < 0 || close >= to || close === cursor + 1) invalid('unclosed inline math')
      protect(close + 1)
    } else if (ch === '[' || (ch === '!' && raw[cursor + 1] === '[')) {
      const image = ch === '!'
      const open = cursor + (image ? 1 : 0)
      const close = raw.indexOf(']', open + 1)
      if (close < 0 || close + 1 >= to || raw[close + 1] !== '(') invalid('reference or malformed link/image')
      let end = close + 2
      let depth = 1
      for (; end < to; end++) {
        if (raw[end] === '\\') { end++; continue }
        if (raw[end] === '(') depth++
        if (raw[end] === ')' && --depth === 0) break
      }
      if (end >= to || depth !== 0) invalid('unclosed link/image target')
      flush(cursor)
      if (close > open + 1) inline(raw, open + 1, close, add, image ? 'caption' : kind)
      cursor = end + 1
      run = cursor
    } else if (raw.startsWith('https://', cursor) || raw.startsWith('http://', cursor) ||
               (raw.startsWith('www.', cursor) && (cursor === from || /\s/.test(raw[cursor - 1])))) {
      invalid('bare URL; use an inline link')
    } else if (ch === '<' || ch === '>') {
      invalid('HTML and angle autolinks')
    } else if (ch === '&' && /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.test(raw.slice(cursor, to))) {
      const entity = /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(raw.slice(cursor, to))[0]
      protect(cursor + entity.length)
    } else if (ch === '*' || ch === '_' || ch === '~') {
      // Preserve emphasis/strike delimiters byte-for-byte. A dangling delimiter
      // is ambiguous, so fail rather than silently translating its syntax.
      const marks = new RegExp(`^\\${ch}+`).exec(raw.slice(cursor, to))[0]
      if (marks.length > 2 || (ch === '~' && marks.length !== 2) ||
          (ch === '_' && /[\p{L}\p{N}]/u.test(raw[cursor - 1] ?? ''))) {
        invalid('ambiguous emphasis or strike delimiter')
      }
      const close = raw.indexOf(marks, cursor + marks.length)
      if (close < 0 || close >= to || raw[close + marks.length] === ch ||
          /[*_~]/.test(raw.slice(cursor + marks.length, close))) {
        invalid('nested or unbalanced emphasis or strike delimiter')
      }
      flush(cursor)
      inline(raw, cursor + marks.length, close, add, kind)
      cursor = close + marks.length
      run = cursor
    } else if (ch === ']') {
      invalid('unbalanced bracket')
    } else {
      cursor++
    }
  }
  flush(to)
}

export const markdownSource = {
  id: 'markdown',
  match(file) {
    if (file.format !== undefined) return ['md', 'markdown'].includes(file.format.toLowerCase()) ? 1 : 0
    return /\.(?:md|markdown)$/i.test(file.path ?? file.name ?? '') ? 0.8 : 0
  },
  async parse(file) {
    if (file.content !== undefined && file.path !== undefined) throw new KernelError('INVALID_ARGUMENT', 'Provide either path or content')
    if (file.content !== undefined && typeof file.content !== 'string' && !Buffer.isBuffer(file.content)) throw new KernelError('INVALID_ARGUMENT', 'Markdown content must be a string or Buffer')
    if (file.path !== undefined && (typeof file.path !== 'string' || !file.path.trim())) throw new KernelError('INVALID_ARGUMENT', 'path must be a nonempty string')
    const raw = file.content === undefined ? await readFile(file.path, 'utf8') : file.content.toString('utf8')
    if (!raw.trim()) throw new KernelError('INVALID_ARGUMENT', 'Markdown source is empty')
    const lines = linesOf(raw)
    const units = []
    const spans = []
    const add = (start, end, kind = 'body') => {
      const sourceText = raw.slice(start, end)
      const line = lines.findIndex(item => item.start <= start && start < item.end) + 1
      const order = units.length
      units.push({ order, kind, sourceText, locator: { line, start, end }, translatable: true })
      spans.push({ order, start, end })
    }
    const unchanged = (start, end, kind) => {
      const sourceText = raw.slice(start, end).trim()
      if (sourceText) units.push({ order: units.length, kind, sourceText,
        locator: { line: lines.findIndex(item => item.start === start) + 1, start, end }, translatable: false })
    }
    let fence = null
    let math = null
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const value = line.text
      if (fence) {
        if (new RegExp(`^ {0,3}${fence.mark}{${fence.length},}\\s*$`).test(value)) {
          unchanged(fence.start, line.end, 'code')
          fence = null
        }
        continue
      }
      if (math) {
        if (/^\s*\$\$\s*$/.test(value)) {
          unchanged(math.start, line.end, 'formula')
          math = null
        }
        continue
      }
      if (i === 0 && /^---\s*$/.test(value)) invalid('YAML front matter')
      const opener = /^ {0,3}(`{3,}|~{3,})/.exec(value)
      if (opener) { fence = { mark: opener[1][0], length: opener[1].length, start: line.start }; continue }
      if (/^\s*\$\$\s*$/.test(value)) { math = { start: line.start }; continue }
      if (!value.trim()) continue
      if (/^(?:    |\t)/.test(value)) {
        if (/^(?: {4,}|\t)(?:[-+*]|\d+[.)])[ \t]+/.test(value)) invalid('deeply nested list')
        if (i > 0 && /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(lines[i - 1].text)) {
          invalid('indented list continuation')
        }
        const start = line.start
        while (i + 1 < lines.length && (/^(?:    |\t)/.test(lines[i + 1].text) || !lines[i + 1].text.trim())) i++
        unchanged(start, lines[i].end, 'code')
        continue
      }
      if (/^ {0,3}(?:-+|=+|\*\*\*+|___+)\s*$/.test(value)) invalid('thematic break or setext heading')
      if (/^ {0,3}\|/.test(value) || /^ {0,3}(?:\|?\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(value)) invalid('table')
      let bodyStart = line.start
      let kind = 'body'
      const heading = /^ {0,3}#{1,6}[ \t]+/.exec(value)
      const quote = /^ {0,3}>[ \t]?/.exec(value)
      const list = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.exec(value)
      if (heading) { bodyStart += heading[0].length; kind = 'heading' }
      else if (quote) bodyStart += quote[0].length
      else if (list) bodyStart += list[0].length
      else if (/^ {0,3}(?:#{1,6}|>|[-+*]|\d+[.)])$/.test(value)) invalid('empty block marker')
      const bodyEnd = line.start + value.length
      if (heading) {
        const suffix = /[ \t]+#+[ \t]*$/.exec(raw.slice(bodyStart, bodyEnd))
        inline(raw, bodyStart, suffix ? bodyEnd - suffix[0].length : bodyEnd, add, kind)
      } else inline(raw, bodyStart, bodyEnd, add, kind)
    }
    if (fence) invalid('unclosed fenced code block')
    if (math) invalid('unclosed display math block')
    if (!units.length) throw new KernelError('INVALID_ARGUMENT', 'Markdown source has no units')
    return { format: 'md', title: file.title ?? (file.path ? basename(file.path) : file.name ?? 'Untitled'),
      units, chapters: [], resources: [], sourceBinding: { adapterId: 'markdown', raw, spans } }
  },
}

export function MarkdownSource(ctx) {
  ctx.effect(() => ctx.get('ivoraige.parse').register(markdownSource))
}
MarkdownSource.inject = ['ivoraige.parse']
