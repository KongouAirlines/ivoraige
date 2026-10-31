// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

// Renderers receive only resolved frozen data, never a Cordis context or service.
import { renderMarkdown } from './markdown-output.mjs'
import { readablePdfText } from './pdf-text.mjs'
const supports = binding => ['txt', 'markdown', 'babeldoc'].includes(binding?.adapterId)
const readable = (binding, item) => binding.adapterId === 'babeldoc'
  ? readablePdfText(binding, item.unit, item.text) : item.text

export const markdown = {
  id: 'md',
  supports,
  rebuild(data) {
    if (data.sourceBinding.adapterId === 'markdown') return renderMarkdown(data)
    const { snapshot, document, units } = data
    const title = document.title.replace(/[\r\n]+/g, ' ')
    return `<!-- ivoraige snapshot:${snapshot.id} revisions:${snapshot.revisionSetHash} -->\n\n` +
      `# ${title}\n\n` + units.map(item => readable(data.sourceBinding, item)).join('\n\n') + '\n'
  },
}

export const json = {
  id: 'json',
  supports,
  rebuild({ snapshot, document, units, sourceBinding }) {
    return JSON.stringify({
      snapshotId: snapshot.id,
      contentMode: snapshot.contentMode ?? 'accepted-translation',
      revisionSetHash: snapshot.revisionSetHash,
      document: {
        id: document.id, sourceId: document.sourceId, title: document.title,
        sourceLang: document.language,
        ...(snapshot.targetLang ? { targetLang: snapshot.targetLang } : {}),
      },
      units: units.map(({ unit, decision, text }) => ({
        id: unit.id, order: unit.order, kind: unit.kind, locator: unit.locator,
        sourceText: unit.sourceText, text: readable(sourceBinding, { unit, text }), decision,
      })),
    }, null, 2) + '\n'
  },
}

export function TextOutputs(ctx) {
  for (const adapter of [markdown, json]) {
    ctx.effect(() => ctx.get('ivoraige.outputs').register(adapter))
  }
}
TextOutputs.inject = ['ivoraige.outputs']
