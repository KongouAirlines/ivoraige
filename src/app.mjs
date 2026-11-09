import './runtime.mjs'
import { dirname, join } from 'node:path'
import { Context, Storage, StorageDomain, StorageSqlite, LlmRuntime, LlmPiAi,
  LocalCredentialProvider, JobsLocal } from '../dist/dsh.mjs'
import { Parse } from './parse.mjs'
import { Outputs } from './outputs.mjs'
import { TxtSource } from './adapters/txt-source.mjs'
import { Records } from './records.mjs'
import { Importer } from './import.mjs'
import { Exporter } from './export.mjs'
import { TextOutputs } from './adapters/text-output.mjs'
import { KernelError } from './errors.mjs'
import { TranslationModel } from './translation-model.mjs'
import { Tasks } from './tasks.mjs'
import { Operations } from './operations.mjs'
import { MarkdownSource } from './adapters/markdown-source.mjs'
import { bootModelSettings } from './model-settings.mjs'
import { createOwnedApp } from './host-bootstrap.mjs'
import { inspectRetentionDomain } from './retention-domain.mjs'
import { Pdf } from './adapters/pdf.mjs'
import { McpRegistry } from './mcp-registry.mjs'
import * as OperationMcp from './operation-mcp.mjs'
import { SettingsPages } from './settings-pages.mjs'
import { CapabilityCatalog, CapabilityContributions } from './capability-catalog.mjs'
import { OperationCatalog } from './operation-catalog.mjs'
import * as CoreOperations from './core-operations.mjs'
import { OperationTools } from './mcp-tools.mjs'
import { EntryEvents } from './entry-events.mjs'
import { installEventState } from './event-state.mjs'
import { ResourceAccess } from './resource-access.mjs'
import { CliEntry } from './cli-entry.mjs'
import { HttpEntry } from './http.mjs'
import { McpEntry } from './mcp-entry.mjs'

function validateAppOptions({ store, exportDir, translation, settingsDir, pdf, components, mcp = true,
  entries = {}, events = true, maxArtifactBytes = null } = {}) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) ||
      Object.entries(entries).some(([key, value]) => !['cli', 'http', 'mcp'].includes(key) || typeof value !== 'boolean') ||
      typeof events !== 'boolean' || typeof mcp !== 'boolean')
    throw new KernelError('INVALID_ARGUMENT', 'Entry switches must be booleans')
  if (components !== undefined && (!settingsDir || !components || typeof components !== 'object' || Array.isArray(components))) {
    throw new KernelError('INVALID_ARGUMENT', 'Component installation requires a settings directory and configuration')
  }
  if (pdf !== undefined && (!store || !pdf || typeof pdf !== 'object' || Array.isArray(pdf))) {
    throw new KernelError('INVALID_ARGUMENT', 'PDF configuration requires a store and a component configuration')
  }
  if (store !== undefined && (typeof store !== 'string' || !store.trim())) {
    throw new KernelError('INVALID_ARGUMENT', 'store must be an explicit SQLite file path')
  }
  if (exportDir !== undefined && (typeof exportDir !== 'string' || !exportDir.trim())) {
    throw new KernelError('INVALID_ARGUMENT', 'exportDir must be a nonempty directory path')
  }
  if (settingsDir !== undefined && (typeof settingsDir !== 'string' || !settingsDir.trim())) {
    throw new KernelError('INVALID_ARGUMENT', 'settingsDir must be a nonempty directory path')
  }
  if (settingsDir !== undefined && translation !== undefined) {
    throw new KernelError('INVALID_ARGUMENT', 'settingsDir cannot be combined with translation')
  }
  if (store === undefined && (components !== undefined || exportDir !== undefined || maxArtifactBytes !== null)) {
    throw new KernelError('INVALID_ARGUMENT', 'components, exportDir and maxArtifactBytes require a store')
  }
  if (translation !== undefined) {
    if (!store || !translation || typeof translation !== 'object' || Array.isArray(translation) ||
        typeof translation.provider !== 'string' || !translation.provider.trim() ||
        typeof translation.model !== 'string' || !translation.model.trim() ||
        !translation.providers || !Object.hasOwn(translation.providers, translation.provider)) {
      throw new KernelError('INVALID_ARGUMENT', 'Translation requires a store, provider, model and explicit DSH providers configuration')
    }
    if (translation.credentialsPath !== undefined &&
        (typeof translation.credentialsPath !== 'string' || !translation.credentialsPath.trim())) {
      throw new KernelError('INVALID_ARGUMENT', 'credentialsPath must be a nonempty path')
    }
  }
}

// Public persistent construction always goes through the same ownership root.
// The composition callback and its lease are never caller-provided options.
export async function createApp(options = {}) {
  validateAppOptions(options)
  return createOwnedApp(options, { compose: composeKernel, lifetime: 'ephemeral', attach: false })
}
export async function startHost(options = {}) {
  validateAppOptions(options)
  return createOwnedApp(options, { compose: composeKernel, lifetime: 'resident', attach: true })
}

// Composition only: business capabilities live in Cordis services.
async function composeKernel({ store, exportDir, translation, settingsDir, pdf, components, mcp = true,
  entries = {}, events = true, maxArtifactBytes = null } = {}, { storeLease: storeLock, generation } = {}) {
  let ctx
  try {
    const retentionDomain = storeLock ? inspectRetentionDomain(storeLock.path) : undefined
    ctx = settingsDir === undefined ? new Context() :
      (await bootModelSettings({ directory: settingsDir })).ctx
    await ctx.plugin(CapabilityCatalog)
    await ctx.plugin(OperationCatalog)
    if (events) await ctx.plugin(EntryEvents, { generation })
    if (!ctx.get('ivoraige.settingsPages')) await ctx.plugin(SettingsPages)
    await ctx.plugin(Outputs)
    await ctx.plugin(Parse)
    await ctx.plugin(TxtSource)
    await ctx.plugin(MarkdownSource)
    if (store !== undefined) {
      await ctx.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
      if (components !== undefined) {
        const { Components } = await import('./components.mjs')
        await ctx.plugin(Components, { repository: process.env.IVORAIGE_COMPONENTS_REPOSITORY ?? 'KongouAirlines/ivaraige',
          releaseTag: process.env.IVORAIGE_RELEASE_TAG ?? 'v0.1.0-dev.0', ...components })
        pdf ??= await ctx.get('ivoraige.components').getInstalledPdf() ?? undefined
      }
      if (pdf !== undefined) await ctx.plugin(Pdf, { ...pdf,
        directory: join(dirname(storeLock.path), 'pdf'), storePath: storeLock.path })
      else if (components !== undefined) ctx.effect(() => ctx.get('ivoraige.settingsPages').register({ id: 'pdf', label: 'PDF', order: 20 }))
      await ctx.plugin(Storage)
      await ctx.plugin(StorageSqlite, { path: storeLock.path })
      await ctx.plugin(StorageDomain, { backend: 'sqlite' })
      await ctx.plugin(Records, { storageVersion: retentionDomain.version,
        activateRetention: retentionDomain.activateRetention })
      await ctx.get('ivoraige.records').ready
      await ctx.plugin(ResourceAccess, { maxArtifactBytes })
      await ctx.plugin(Importer)
      await ctx.plugin(TextOutputs)
      await ctx.plugin(Exporter, { root: exportDir ?? join(dirname(store), 'exports') })
      if (translation !== undefined) {
        await ctx.plugin(LocalCredentialProvider, {
          path: translation.credentialsPath ?? join(dirname(store), '.credentials.yaml'), watch: false,
        })
        await ctx.plugin(LlmRuntime)
        await ctx.plugin(LlmPiAi, { providers: translation.providers })
        await ctx.plugin(TranslationModel, {
          provider: translation.provider, model: translation.model,
          ...(translation.timeoutMs === undefined ? {} : { timeoutMs: translation.timeoutMs }),
        })
      } else if (settingsDir !== undefined) {
        await ctx.plugin(TranslationModel, { select: () => ctx.get('ivoraige.modelSettings')?.resolve() })
      }
      await ctx.plugin(Tasks)
      await ctx.get('ivoraige.tasks').ready
    }
    await ctx.plugin(Operations, { dataDirectory: storeLock ? dirname(storeLock.path) : settingsDir })
    await ctx.plugin(CoreOperations)
    if (entries.cli !== false) await ctx.plugin(CliEntry)
    if (entries.http !== false) await ctx.plugin(HttpEntry)
    if (mcp && entries.mcp !== false) {
      await ctx.plugin(McpRegistry)
      await ctx.plugin(OperationTools)
      if (store !== undefined) await ctx.plugin(OperationMcp)
      await ctx.plugin(McpEntry)
    }
    await ctx.plugin(CapabilityContributions)
    if (events) ctx.effect(() => installEventState(ctx))
    // Keep these owner handles even after Cordis withdraws their services.
    // A later explicit close confirms that a swallowed effect failure did not
    // leave a writer alive; dependent consumers must finish disposal first.
    const recordsDomain = ctx.get('ivoraige.records')?.domain
    const domainFacility = ctx.get('storageDomain')
    const sqliteBackend = store === undefined ? undefined : ctx.storage.backend.get('sqlite')
    let storageDisposed = false
    let storageCloseFailure
    return {
      ctx,
      parse: ctx.get('ivoraige.parse'),
      outputs: ctx.get('ivoraige.outputs'),
      records: ctx.get('ivoraige.records'),
      exporter: ctx.get('ivoraige.export'),
      tasks: ctx.get('ivoraige.tasks'),
      mcp: ctx.get('ivoraige.mcp'),
      operations: ctx.get('ivoraige.operations'),
      settings: ctx.get('ivoraige.modelSettings'),
      components: ctx.get('ivoraige.components'),
      capabilities: ctx.get('ivoraige.capabilities'),
      operationCatalog: ctx.get('ivoraige.operationCatalog'),
      events: ctx.get('ivoraige.events'),
      resources: ctx.get('ivoraige.resources'),
      cli: ctx.get('ivoraige.cliEntry'),
      async disposeStorage() {
        if (storageDisposed) return
        if (storageCloseFailure) throw storageCloseFailure
        if (store === undefined) await ctx.fiber.dispose()
        else try {
          // Cordis owns dependency order, but logs and swallows some effect
          // failures. Join its disposal, then explicitly confirm each cached
          // writer has closed before the bootstrap releases the store lease.
          await ctx.fiber.dispose()
          if (!recordsDomain || !domainFacility || !sqliteBackend)
            throw new Error('Storage owner is unavailable during disposal')
          await recordsDomain.close()
          await domainFacility.closeAll()
          await sqliteBackend.close()
        } catch (error) {
          // DSH's domain caches a rejected close; never infer a safe retry or
          // release the store lease after this ambiguous outcome.
          storageCloseFailure = new KernelError('PRECONDITION_FAILED',
            'Storage disposal could not be confirmed', { reason: 'storage-disposal-unconfirmed' }, { cause: error })
          throw storageCloseFailure
        }
        storageDisposed = true
      },
    }
  } catch (error) {
    // Bootstrap retains the store lease if any cleanup fails. Never release a
    // writer's ownership from a finally block after an incomplete shutdown.
    try {
      await ctx?.get('ivoraige.httpEntry')?.close()
      await ctx?.get('ivoraige.mcpEntry')?.close()
      await ctx?.get('ivoraige.cliEntry')?.close()
      await ctx?.get('ivoraige.operationCatalog')?.close()
      await ctx?.get('ivoraige.resources')?.close()
      await ctx?.get('ivoraige.tasks')?.close()
      await ctx?.get('ivoraige.components')?.close()
      await ctx?.get('ivoraige.events')?.close()
      // Cordis may log rather than propagate effect failures. Even failed
      // assembly must explicitly certify the writer is closed before the
      // bootstrap releases its lease.
      const recordsDomain = ctx?.get('ivoraige.records')?.domain
      const domainFacility = ctx?.get('storageDomain')
      const sqliteBackend = store === undefined ? undefined : ctx?.storage?.backend.get('sqlite')
      await ctx?.fiber.dispose()
      await recordsDomain?.close()
      await domainFacility?.closeAll()
      await sqliteBackend?.close()
    } catch (cleanupError) {
      Object.defineProperty(error, 'cleanupIncomplete', { value: true })
      Object.defineProperty(error, 'cleanupError', { value: cleanupError })
    }
    throw error
  }
}
