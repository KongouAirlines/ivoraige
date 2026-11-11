import './runtime.mjs'
import { randomUUID, createHash } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { KernelError } from './errors.mjs'
import { z } from 'zod'
import { createHostDomain, findHostDomain, hostRegistryDirectory } from './host-domain.mjs'
import { HostControl } from './host-control.mjs'
import { createHostTransport, connectHostTransport } from './host-transport.mjs'
import { createHostSession } from './host-session.mjs'
import { inspectRetentionDomain } from './retention-domain.mjs'

// Retain ambiguous leases even when construction never returned an app.
// Garbage collection must not accidentally admit a second writer.
const unconfirmedLeases = new Set()
const fail = (code, reason) => new KernelError(code, reason, { reason })

async function canonicalDirectory(path) {
  if (path === undefined) return null
  const absolute = resolve(path)
  try {
    const canonical = await realpath(absolute)
    if (!(await stat(canonical)).isDirectory()) throw new KernelError('INVALID_ARGUMENT', 'Expected a directory path')
    return canonical
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    // A missing leaf must still bind to the real parent. macOS commonly
    // resolves /var to /private/var after a settings directory is created;
    // comparing the unresolved spelling before creation would reject the
    // same composition on the next start. Do not treat dangling links as
    // missing leaves, since their future target could change the binding.
    try { await lstat(absolute); throw new KernelError('INVALID_ARGUMENT', 'Directory path is a dangling link') }
    catch (cause) { if (cause.code !== 'ENOENT') throw cause }
    const parent = dirname(absolute)
    if (parent === absolute) throw error
    return join(await canonicalDirectory(parent), basename(absolute))
  }
}

function fingerprint(value) {
  const sorted = input => Array.isArray(input) ? input.map(sorted) : input && typeof input === 'object' ?
    Object.fromEntries(Object.keys(input).sort().map(key => [key, sorted(input[key])])) : input
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')
}

// This binds assembly choices, never authentication material. Ports and view
// lifetime are deliberately absent. Effective settings stay owned by DSH.
export async function hostConfigBinding(options) {
  return {
    settingsDir: await canonicalDirectory(options.settingsDir),
    componentDir: await canonicalDirectory(options.components?.directory),
    componentRepository: options.components?.repository ?? process.env.IVORAIGE_COMPONENTS_REPOSITORY ?? null,
    componentRelease: options.components?.releaseTag ?? process.env.IVORAIGE_RELEASE_TAG ?? null,
    exportDir: await canonicalDirectory(options.exportDir),
    pdf: options.pdf ? fingerprint(options.pdf) : null,
    translation: options.translation ? fingerprint(options.translation) : null,
  }
}

function facade(client) {
  const invoke = (method, input = {}) => client.request('business', { method, input })
  return { reused: true, attached: client.attached, generation: client.generation,
    dataDomainRef: client.attached.dataDomainRef, client,
    cli: { invoke }, operations: { invoke },
    dispose: async () => client.close(),
  }
}

export async function attachHost({ store, registryRoot, binding } = {}) {
  const found = await findHostDomain({ store, registryRoot, verifyOwner: async candidate => {
    const verified = await connectHostTransport({ directory: hostRegistryDirectory(registryRoot),
      dataDomainRef: candidate.dataDomainRef, expectedRegistrationId: candidate.registrationId,
      signal: candidate.signal })
    try { return { dataDomainRef: verified.attached.dataDomainRef,
      registrationId: verified.attached.registrationId } }
    finally { verified.close() }
  } })
  if (!found) throw fail('NOT_FOUND', 'owner-absent')
  // The registry reader checks path/file identity; a successful socket alone
  // cannot make an unrelated database the selected domain.
  const client = await connectHostTransport({ directory: hostRegistryDirectory(registryRoot),
    dataDomainRef: found.domainId ?? found.dataDomainRef, expectedRegistrationId: found.registrationId })
  if (binding !== undefined) {
    const info = await client.request('transportInfo')
    if (JSON.stringify(info.ownerConfigBinding) !== JSON.stringify(binding)) {
      client.close()
      throw fail('CONFLICT', 'owner-config-mismatch')
    }
  }
  return facade(client)
}

// compose is supplied only by app.mjs, never by a public option or wire DTO.
export async function createOwnedApp(options, { compose, lifetime, attach }) {
  const { store, registryRoot } = options
  if (store !== undefined && (typeof store !== 'string' || !store.trim()))
    throw new KernelError('INVALID_ARGUMENT', 'store must be an explicit SQLite file path')
  const generation = randomUUID()
  if (store === undefined) {
    const app = await compose(options, { generation })
    let disposing
    app.dispose = () => disposing ??= (async () => {
      let entryFailure
      const closeEntry = async entry => {
        try { await entry?.close() } catch (error) { entryFailure ??= error }
      }
      await closeEntry(app.ctx.get('ivoraige.httpEntry'))
      await closeEntry(app.ctx.get('ivoraige.mcpEntry'))
      await closeEntry(app.ctx.get('ivoraige.cliEntry'))
      await app.operationCatalog?.close()
      await app.resources?.close()
      await app.tasks?.close()
      await app.components?.close()
      await app.events?.close()
      await app.disposeStorage()
      if (entryFailure) throw entryFailure
    })().catch(error => { disposing = undefined; throw error })
    return app
  }
  const binding = await hostConfigBinding(options)
  if (attach) {
    try { return await attachHost({ store, registryRoot, binding }) }
    catch (error) {
      if (!['owner-absent', 'owner-unreachable'].includes(error.details?.reason) &&
          !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
    }
  }
  // Output location is a live assembly choice, not durable domain identity.
  // A stopped owner can reopen with a relocated export root; live attach still
  // compares the full binding and cannot silently switch the existing writer.
  const { exportDir: _exportDir, ...persistentBinding } = binding
  let domain
  try { domain = await createHostDomain({ store, ownerConfigBinding: persistentBinding, registryRoot },
    { prepareStore: inspectRetentionDomain }) }
  catch (error) {
    if (!attach || error.code !== 'CONFLICT' || error.details?.reason) throw error
    // A racing creator may hold the store before it publishes discovery.
    // Never create a second context while waiting for its authenticated IPC.
    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      await new Promise(done => setTimeout(done, 50))
      try { return await attachHost({ store, registryRoot, binding }) }
      catch (cause) {
        if (cause.details?.reason === 'temporary-owner' || cause.details?.reason === 'owner-config-mismatch') throw cause
        if (!['owner-absent', 'owner-unreachable'].includes(cause.details?.reason) &&
            !['ENOENT', 'ECONNREFUSED'].includes(cause.code)) throw cause
      }
    }
    throw fail('CONFLICT', 'owner-unreachable')
  }
  let app, transport, session, httpInfo = null, control
  const directory = hostRegistryDirectory(registryRoot)
  let shutdownEntries = false, closed = false
  let resolveClosed
  const whenClosed = new Promise(done => { resolveClosed = done })
  const closeEntries = async () => {
    if (shutdownEntries) return
    await app?.ctx.get('ivoraige.httpEntry')?.close()
    await app?.ctx.get('ivoraige.mcpEntry')?.close()
    await app?.ctx.get('ivoraige.cliEntry')?.close()
    shutdownEntries = true
  }
  try {
    app = await compose({ ...options, store: domain.canonicalStore }, { storeLease: domain.storeLease, generation })
    control = new HostControl({ dataDomainRef: domain.dataDomainRef, generation, lifetime,
      getStateRevision: () => app.events && !app.events.closed ? app.events.stateRevision : null,
      onChange: () => {
        if (control && !control.accepting) {
          app.operationCatalog?.stopAccepting()
          app.tasks?.stopAccepting()
          app.components?.stopAccepting()
          app.resources?.stopAccepting()
        }
        app.events?.publish('host.changed', { ownerOnly: true })
      },
      stages: {
        gate() {
          app.operationCatalog?.stopAccepting()
          app.tasks?.stopAccepting()
          app.components?.stopAccepting()
          app.resources?.stopAccepting()
        },
        admissions: deadline => app.operationCatalog?.close({ deadline }),
        async work(deadline) {
          await app.tasks?.close({ deadline })
          await app.components?.close({ deadline })
        },
        resources: deadline => app.resources?.close({ deadline }),
        async storage() {
          await closeEntries()
          await app.events?.close()
          await app.disposeStorage()
        },
        releaseStore: () => domain.storeLease.release(),
        async cleanupDiscovery() { await transport?.cleanupDiscovery() },
        async closeControl() {
          await transport?.finalize(control.finalizationReceipt())
          await transport?.close()
          session?.revokeAll()
          closed = true
          resolveClosed()
        },
      },
    })
    app.operationCatalog.setHostControl(control)
    const handleControl = (action, params = {}) => {
      const checked = { ...params, expectedGeneration: generation }
      if (action === 'state') return control.state(checked)
      if (action === 'operation') return control.operation(params.operationId, checked)
      if (action === 'drain' || action === 'exit') return control[action](checked)
      throw fail('INVALID_ARGUMENT', 'invalid-request')
    }
    const host = {
      generation, dataDomainRef: domain.dataDomainRef, lifetime, control, whenClosed,
      get closed() { return closed },
      get session() { return session },
      get info() { return httpInfo },
      handleControl,
      bindHttp(origin) {
        if (lifetime !== 'resident') throw fail('CONFLICT', 'temporary-owner')
        if (!app.events) throw fail('PRECONDITION_FAILED', 'event-bridge-required')
        if (session) throw fail('CONFLICT', 'owner-http-already-bound')
        session = createHostSession({ dataDomainRef: domain.dataDomainRef, generation, lifetime, origin,
          isOwnerHeld: () => control.storeOwnership === 'held' })
        httpInfo = { url: origin }
        return session
      },
      browserBootstrap() {
        if (!session) throw fail('PRECONDITION_FAILED', 'owner-http-unavailable')
        return session.issueBootstrap()
      },
    }
    app.host = host
    app.reused = false
    app.generation = generation
    app.dataDomainRef = domain.dataDomainRef
    app.dispose = async ({ budgetMs = 30_000 } = {}) => {
      if (closed) return
      const accepted = control.exit({ expectedGeneration: generation, budgetMs })
      await control.waitForAttempt()
      if (!closed) {
        const operation = control.operation(accepted.operationId, { expectedGeneration: generation })
        throw new KernelError('PRECONDITION_FAILED', 'Host shutdown is incomplete', { reason: operation.reason,
          generation, operationId: operation.operationId, phase: operation.phase })
      }
    }
    // Host projection is owner-only and is not part of the ordinary business
    // event reader set. HTTP passes an owner capability after authentication.
    if (app.events) app.events.registerOwnerState?.('host', () => control.state())
    transport = createHostTransport({ directory, dataDomainRef: domain.dataDomainRef,
      registrationId: domain.registrationId, generation, lifetime,
      getState: () => control.state(), getSession: () => session,
      getInfo: () => ({ ...httpInfo, ownerConfigBinding: binding }), handleControl,
      waitForAttempt: () => control.waitForAttempt(),
      handleBusiness: async (method, input, { signal } = {}) => {
        if (!method.startsWith('mcp.')) return app.operations.invoke(method, input, { signal })
        const registry = app.mcp
        if (!registry) throw fail('COMPONENT_MISSING', 'mcp-unavailable')
        if (method === 'mcp.describe') return {
          tools: [...registry.tools].map(([name, definition]) => ({ name,
            description: definition.description,
            inputSchema: definition.inputSchema ? z.toJSONSchema(definition.inputSchema, { target: 'draft-7' }) :
              { type: 'object', properties: {} },
            ...(definition.annotations ? { annotations: definition.annotations } : {}) })),
          resources: [...registry.resources].map(([name, definition]) => ({ name,
            template: definition.template, ...(definition.metadata ? { metadata: definition.metadata } : {}) })),
        }
        if (method === 'mcp.call') {
          const tool = registry.tools.get(input.name)
          if (!tool) throw fail('NOT_FOUND', 'mcp-tool-absent')
          return tool.invoke(input.input, { signal })
        }
        if (method === 'mcp.read') {
          const resource = registry.resources.get(input.name)
          if (!resource) throw fail('NOT_FOUND', 'mcp-resource-absent')
          const { ResourceTemplate } = await import('@modelcontextprotocol/server')
          const variables = new ResourceTemplate(resource.template, { list: undefined }).uriTemplate.match(input.uri)
          if (!variables) throw fail('INVALID_ARGUMENT', 'mcp-resource-uri-mismatch')
          return resource.read(new URL(input.uri), variables, { signal })
        }
        throw fail('INVALID_ARGUMENT', 'invalid-request')
      },
    })
    await transport.start()
    control.ready()
    return app
  } catch (error) {
    let cleanupFailure
    try {
      await closeEntries()
      await app?.operationCatalog?.close()
      await app?.resources?.close()
      await app?.tasks?.close()
      await app?.components?.close()
      await app?.events?.close()
      await app?.disposeStorage()
    } catch (cleanupError) { cleanupFailure = cleanupError }
    if (error.cleanupIncomplete || cleanupFailure) unconfirmedLeases.add(domain.storeLease)
    if (!error.cleanupIncomplete && !cleanupFailure) {
      domain.storeLease.release()
      await transport?.cleanupDiscovery()
      await transport?.close()
    }
    throw error
  }
}
