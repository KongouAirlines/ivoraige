// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { randomUUID } from 'node:crypto'
import { Service, StorageDomain, z } from '../dist/dsh.mjs'
import { digest } from './basis.mjs'
import { KernelError } from './errors.mjs'

export const TRANSLATION_FEATURE = Object.freeze({ pluginId: 'ivoraige.translationModel',
  featureId: 'translate-unit', variables: ['sourceLang', 'targetLang', 'effectiveContext', 'effectiveTarget', 'sourceText'],
  output: 'translation-text' })
export const DEFAULT_TEMPLATE = Object.freeze({ id: 'builtin:scientific-translation', version: '3',
  name: 'Scientific translation', pluginId: TRANSLATION_FEATURE.pluginId,
  featureId: TRANSLATION_FEATURE.featureId, variables: TRANSLATION_FEATURE.variables,
  output: TRANSLATION_FEATURE.output, style: '' })

const copy = value => structuredClone(value)
const keyOf = ({ pluginId, featureId, configurationId, docId }) =>
  JSON.stringify([pluginId, featureId, configurationId, docId ?? null])
const nonempty = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new KernelError('INVALID_ARGUMENT', `${field} must be a nonempty string`)
  return value.trim()
}

export function modelConfigurationId({ provider, model, route = {} }) {
  nonempty(provider, 'provider'); nonempty(model, 'model')
  // The route, not a display label, distinguishes connections. Never persist
  // the route or credential itself in prompt metadata.
  const { models, modelOverrides, ...common } = route ?? {}
  const selected = Array.isArray(models) ? models.find(item => item.id === model) : undefined
  return digest({ provider, model, route: common, selectedModel: selected ?? null,
    override: modelOverrides?.[model] ?? null })
}

export const promptContentId = template => digest({ pluginId: template.pluginId,
  featureId: template.featureId, output: template.output, style: template.style })

export class PromptLibrary extends Service {
  static inject = ['storageDomain']

  constructor(ctx) {
    super(ctx, 'ivoraige.prompts')
    this.features = new Map()
    this.defaults = new Map()
    this.data = { templates: [], bindings: {} }
    this.write = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    this.domain = await this.ctx.get('storageDomain').open(StorageDomain.defineDomain({
      name: 'ivoraige_prompts', version: 1, layout: 'per-record',
      tables: { library: StorageDomain.domainTable(z.record(z.string(), z.unknown())) },
    }))
    this.table = this.domain.table('library')
    const value = this.table.get('library')
    if (value) this.data = copy(value)
  }

  async [Service.init]() {
    await this.ready
    this.ctx.effect(() => () => this.domain.close(), 'ivoraige.prompts lifecycle')
  }

  validData(value = this.data) {
    if (!value || !Array.isArray(value.templates) || !value.bindings ||
        typeof value.bindings !== 'object' || Array.isArray(value.bindings) ||
        Object.values(value.bindings).some(binding => !binding || typeof binding !== 'object' ||
          typeof binding.templateId !== 'string' ||
          (binding.version !== undefined && typeof binding.version !== 'string')) ||
        value.templates.some(template => !template || typeof template !== 'object' ||
          typeof template.id !== 'string' || typeof template.version !== 'string' ||
          typeof template.name !== 'string' || typeof template.pluginId !== 'string' ||
          typeof template.featureId !== 'string' || typeof template.output !== 'string' ||
          !Array.isArray(template.variables) || !template.variables.every(item => typeof item === 'string') ||
          typeof template.style !== 'string'))
      throw new KernelError('PRECONDITION_FAILED', 'Stored prompt library data is invalid')
  }

  register(feature, defaultTemplate = DEFAULT_TEMPLATE) {
    const pluginId = nonempty(feature.pluginId, 'pluginId')
    const featureId = nonempty(feature.featureId, 'featureId')
    if (!Array.isArray(feature.variables) || !feature.variables.every(value => typeof value === 'string') ||
        typeof feature.output !== 'string' || !feature.output)
      throw new KernelError('INVALID_ARGUMENT', 'Feature contract requires variables and output')
    const key = keyOf({ pluginId, featureId })
    if (this.features.has(key)) throw new KernelError('CONFLICT', 'Prompt feature already registered')
    if (!this.compatible(defaultTemplate, feature) || !defaultTemplate.id || !defaultTemplate.version ||
        typeof defaultTemplate.style !== 'string')
      throw new KernelError('INVALID_ARGUMENT', 'Built-in prompt template is incompatible with feature')
    this.features.set(key, copy(feature))
    this.defaults.set(key, copy(defaultTemplate))
    return () => { this.features.delete(key); this.defaults.delete(key) }
  }

  feature(input) {
    const feature = this.features.get(keyOf(input))
    if (!feature) throw new KernelError('COMPONENT_MISSING', 'Prompt feature plugin is unavailable',
      { pluginId: input.pluginId, featureId: input.featureId })
    return feature
  }

  hasFeature(input) { return this.features.has(keyOf(input)) }

  compatible(template, feature) {
    return !!template && Array.isArray(template.variables) &&
      template.pluginId === feature.pluginId && template.featureId === feature.featureId &&
      template.output === feature.output && template.variables.every(value => feature.variables.includes(value))
  }

  getTemplate(id, version) {
    this.validData()
    const rows = [...this.defaults.values()].filter(item => item.id === id).concat(this.data.templates.filter(item => item.id === id))
    const template = version === undefined ? rows.at(-1) : rows.find(item => item.version === version)
    if (!template) throw new KernelError('NOT_FOUND', 'Prompt template or version is missing', { id, version })
    return copy(template)
  }

  async list() {
    await this.ready
    this.validData()
    return { features: [...this.features.values()].map(copy), templates: [...this.defaults.values()].map(copy).concat(copy(this.data.templates)),
      bindings: copy(this.data.bindings) }
  }

  async persist(change) {
    await this.ready
    const operation = this.write.then(async () => {
      this.validData()
      const next = copy(this.data)
      const result = change(next)
      this.validData(next)
      if (this.table.get('library')) await this.table.update('library', () => next)
      else await this.table.put('library', next)
      this.data = copy(this.table.get('library'))
      return result
    })
    this.write = operation.catch(() => {})
    return operation
  }

  async copyTemplate({ sourceId = DEFAULT_TEMPLATE.id, sourceVersion, name } = {}) {
    return this.persist(data => {
      const source = this.getTemplate(sourceId, sourceVersion)
      const template = { ...source, id: randomUUID(), version: '1',
        name: nonempty(name ?? `${source.name} copy`, 'name'), createdAt: new Date().toISOString() }
      data.templates.push(template)
      return copy(template)
    })
  }

  async updateTemplate({ id, expectedVersion, name, style } = {}) {
    return this.persist(data => {
      const current = this.getTemplate(id)
      if ([...this.defaults.values()].some(item => item.id === id)) throw new KernelError('PRECONDITION_FAILED', 'Copy the built-in template before editing')
      if (current.version !== expectedVersion) throw new KernelError('CONFLICT', 'Prompt template version changed',
        { expected: expectedVersion, actual: current.version })
      if (style !== undefined && (typeof style !== 'string' || style.length > 12000))
        throw new KernelError('INVALID_ARGUMENT', 'style must be text no longer than 12000 characters')
      const template = { ...current, version: String(Number(current.version) + 1),
        name: name === undefined ? current.name : nonempty(name, 'name'),
        style: style === undefined ? current.style : style, createdAt: new Date().toISOString() }
      data.templates.push(template)
      return copy(template)
    })
  }

  async bind({ pluginId, featureId, configurationId, docId, templateId } = {}) {
    return this.persist(data => {
      const feature = this.feature({ pluginId, featureId })
      nonempty(configurationId, 'configurationId')
      if (docId !== undefined) nonempty(docId, 'docId')
      const template = this.getTemplate(templateId)
      if (!this.compatible(template, feature)) throw new KernelError('PRECONDITION_FAILED', 'Prompt template is incompatible with feature')
      const key = keyOf({ pluginId, featureId, configurationId, docId })
      data.bindings[key] = { templateId: template.id }
      return { scope: docId ? 'document' : 'global', template: copy(template) }
    })
  }

  async restore({ pluginId, featureId, configurationId, docId } = {}) {
    return this.persist(data => {
      this.feature({ pluginId, featureId }); nonempty(configurationId, 'configurationId')
      delete data.bindings[keyOf({ pluginId, featureId, configurationId, docId })]
      return { restored: true }
    })
  }

  async resolve({ pluginId, featureId, configurationId, docId, templateId } = {}) {
    await this.ready
    this.validData()
    const feature = this.feature({ pluginId, featureId })
    nonempty(configurationId, 'configurationId')
    let source = 'builtin', binding
    if (templateId !== undefined) { binding = { templateId }; source = 'run' }
    else if (docId && this.data.bindings[keyOf({ pluginId, featureId, configurationId, docId })]) {
      binding = this.data.bindings[keyOf({ pluginId, featureId, configurationId, docId })]; source = 'document'
    } else if (this.data.bindings[keyOf({ pluginId, featureId, configurationId })]) {
      binding = this.data.bindings[keyOf({ pluginId, featureId, configurationId })]; source = 'global'
    }
    let template, fallback
    try {
      template = this.getTemplate(binding?.templateId ?? this.defaults.get(keyOf(feature))?.id, binding?.version)
      if (!this.compatible(template, feature)) throw new KernelError('PRECONDITION_FAILED', 'Prompt template is incompatible with feature')
    } catch (error) {
      const builtin = this.defaults.get(keyOf(feature))
      if (source === 'run' || !builtin || !this.compatible(builtin, feature)) throw error
      template = copy(builtin)
      fallback = { from: source, reason: error.message }
      source = 'builtin'
    }
    return { template, source, ...(fallback ? { fallback } : {}),
      contentId: promptContentId(template), pluginId, featureId, configurationId }
  }
}
