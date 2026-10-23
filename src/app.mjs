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
import { acquireStoreLock } from './store-lock.mjs'
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

// Composition only: business capabilities live in Cordis services.
export async function createApp({ store, exportDir, translation, settingsDir, pdf, components, mcp = true,
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
  const storeLock = store === undefined ? undefined : await acquireStoreLock(store)
  let ctx
  try {
    const retentionDomain = storeLock ? inspectRetentionDomain(storeLock.path) : undefined
    ctx = settingsDir === undefined ? new Context() :
      (await bootModelSettings({ directory: settingsDir })).ctx
    await ctx.plugin(CapabilityCatalog)
    await ctx.plugin(OperationCatalog)
    if (events) await ctx.plugin(EntryEvents)
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
    let disposed = false, disposing
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
      dispose: async () => {
        if (disposed) return
        if (!disposing) disposing = (async () => {
          let failure
          const close = async fn => { try { await fn() } catch (error) { failure ??= error } }
          await close(() => ctx.get('ivoraige.httpEntry')?.close())
          await close(() => ctx.get('ivoraige.mcpEntry')?.close())
          await close(() => ctx.get('ivoraige.cliEntry')?.close())
          // A noncooperating request must not keep writing after storage is closed.
          // A failed drain leaves the context/store owner intact for a later retry.
          await ctx.get('ivoraige.operationCatalog')?.close()
          await close(() => ctx.get('ivoraige.resources')?.close())
          await close(() => ctx.get('ivoraige.tasks')?.close())
          await close(() => ctx.get('ivoraige.components')?.close())
          await close(() => ctx.get('ivoraige.events')?.close())
          await close(() => ctx.fiber.dispose())
          await close(() => storeLock?.release())
          disposed = true
          if (failure) throw failure
        })().finally(() => { disposing = undefined })
        return disposing
      },
    }
  } catch (error) {
    try { await ctx?.get('ivoraige.httpEntry')?.close() } catch { /* Preserve boot error. */ }
    try { await ctx?.get('ivoraige.mcpEntry')?.close() } catch { /* Preserve boot error. */ }
    try { await ctx?.get('ivoraige.cliEntry')?.close() } catch { /* Preserve boot error. */ }
    try { await ctx?.get('ivoraige.operationCatalog')?.close() } catch { /* No requests during boot. */ }
    try { await ctx?.get('ivoraige.tasks')?.close() } catch { /* Preserve the boot error. */ }
    try { await ctx?.get('ivoraige.components')?.close() } catch { /* Preserve the boot error. */ }
    try { await ctx?.fiber.dispose() } catch { /* Preserve the boot error. */ }
    try { storeLock?.release() } catch { /* Preserve the boot error. */ }
    throw error
  }
}
