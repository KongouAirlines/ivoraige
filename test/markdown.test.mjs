import test from 'node:test'
import assert from 'node:assert/strict'
import { markdownSource } from '../src/adapters/markdown-source.mjs'
import { renderMarkdown } from '../src/adapters/markdown-output.mjs'

const resolved = (parsed, translations = {}) => ({
  sourceBinding: parsed.sourceBinding,
  units: parsed.units.map(unit => ({ unit, text: translations[unit.sourceText] ?? unit.sourceText,
    decision: { type: Object.hasOwn(translations, unit.sourceText) ? 'revision' : 'keepOriginal' } })),
})

test('Markdown rebuild translates prose spans and preserves syntax, links, math and code bytes', async () => {
  const source = '# Magnetic **samples**\r\n\r\n> See [raw data](https://example.org/a(b)?x=1 "title") and `B = 2` at $H_c$.\r\n\r\n1. The sample is *stable*.\r\n- ![image alt](figures/x y.png)\r\n\r\n```python\r\nprint("do not translate")\r\n```\r\n\r\n$$\r\nE = mc^2\r\n$$\r\n\r\n    indented_code()\r\n'
  const parsed = await markdownSource.parse({ format: 'md', content: source, title: 'Sample' })
  assert.equal(parsed.format, 'md')
  assert.equal(parsed.units.filter(unit => !unit.translatable).length, 3)
  assert.deepEqual(parsed.units.filter(unit => unit.translatable).map(unit => unit.sourceText),
    ['Magnetic', 'samples', 'See', 'raw data', 'and', 'at', 'The sample is', 'stable', 'image alt'])
  assert.equal(renderMarkdown(resolved(parsed)), source)
  const output = renderMarkdown(resolved(parsed, {
    Magnetic: '磁性', samples: '样品', 'raw data': '原始数据', 'image alt': '图片说明',
    'The sample is': '样品是', stable: '稳定的',
  }))
  assert.match(output, /^# 磁性 \*\*样品\*\*/)
  assert.match(output, /\[原始数据\]\(https:\/\/example\.org\/a\(b\)\?x=1 "title"\)/)
  assert.match(output, /`B = 2` at \$H_c\$/)
  assert.match(output, /```python\r\nprint\("do not translate"\)\r\n```/)
  assert.match(output, /\$\$\r\nE = mc\^2\r\n\$\$/)
  assert.match(output, /    indented_code\(\)/)
  assert.match(output, /\!\[图片说明\]\(figures\/x y.png\)/)
})

test('accepted text is escaped as prose and cannot create Markdown structure', async () => {
  const parsed = await markdownSource.parse({ format: 'md', content: '# Heading\n\nA sentence.\n' })
  const output = renderMarkdown(resolved(parsed, { Heading: '# new heading', 'A sentence.': '[link](evil) *bold* $math$' }))
  assert.equal(output, '# \\# new heading\n\n\\[link\\]\\(evil\\) \\*bold\\* \\$math\\$\n')
  assert.throws(() => renderMarkdown(resolved(parsed, { Heading: 'line\nnew block' })), { code: 'PRECONDITION_FAILED' })
})

test('YAML front matter stays opaque while translated body retains original offsets', async () => {
  for (const newline of ['\n', '\r\n']) {
    for (const close of ['---', '...']) {
      const header = ['\uFEFF---', 'title: "A *title*"', 'author:', '  - name: Sample',
        'abstract: >-', '  Metadata with [@reference], $math$ and https://example.org.',
        'format:', '  html:', '    toc: true', close].join(newline) + newline
      const source = header + newline + '# Heading' + newline + 'A sentence.' + newline
      const parsed = await markdownSource.parse({ format: 'md', content: source })
      assert.equal(parsed.units[0].kind, 'other')
      assert.equal(parsed.units[0].translatable, false)
      assert.deepEqual(parsed.units.filter(unit => unit.translatable).map(unit => unit.sourceText),
        ['Heading', 'A sentence.'])
      assert.equal(parsed.units[1].locator.line, 12)
      assert.equal(parsed.units[1].locator.start, source.indexOf('Heading'))
      assert.equal(renderMarkdown(resolved(parsed)), source)
      assert.equal(renderMarkdown(resolved(parsed, { Heading: '标题', 'A sentence.': '一句话。' })),
        header + newline + '# 标题' + newline + '一句话。' + newline)
    }
  }
})

test('metadata-only Markdown is preserved and unclosed headers fail explicitly', async () => {
  const source = '---\ntitle: Sample\n---'
  const parsed = await markdownSource.parse({ format: 'md', content: source })
  assert.equal(parsed.units.length, 1)
  assert.equal(parsed.units[0].translatable, false)
  assert.equal(renderMarkdown(resolved(parsed)), source)
  for (const content of ['---', '---\ntitle: Sample\n', '---\n  ---\n']) {
    await assert.rejects(markdownSource.parse({ format: 'md', content }),
      { code: 'INVALID_ARGUMENT', message: 'Unsupported Markdown: unclosed YAML front matter' })
  }
})

test('ambiguous or unsupported Markdown fails before import', async () => {
  for (const source of [
    'Title\n===', 'Title\n--', 'a | b\n- | -', '| a | b |',
    'A <span>unsafe</span>', '[label][id]', 'text $unclosed', '```js\nx',
    'See https://example.org', 'See www.example.org', '- item\n    continuation',
    '- item\n    - nested', 'a_b_c', '*a **b** c*',
  ]) {
    await assert.rejects(markdownSource.parse({ format: 'md', content: source }), { code: 'INVALID_ARGUMENT' })
  }
})
