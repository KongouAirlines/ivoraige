import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostDomain, findHostDomain, hostRegistryDirectory,
  inspectHostDomain, recoverHostDomain } from '../src/host-domain.mjs'
import { createPrivateFile } from '../src/host-permissions.mjs'

const config = { settingsDir: '/example/settings', componentRoot: '/example/components', pdfSource: 'installed' }
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-host-domain-'))
  const registryRoot = join(dir, 'state')
  const store = join(dir, 'store.sqlite')
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, store, registryRoot }
}
async function create(f, store = f.store, ownerConfigBinding = config) {
  return createHostDomain({ store, registryRoot: f.registryRoot, ownerConfigBinding })
}

// D01.H03: initialization and reopening preserve one stable domain ID.
test('initializes a DSH host domain and protected registry once', async t => {
  const f = await fixture(t)
  const one = await create(f)
  const firstId = one.dataDomainRef
  assert.equal((await findHostDomain(f)).domainId, firstId)
  await assert.rejects(create(f), error => error.code === 'CONFLICT')
  one.storeLease.release()
  const two = await create(f)
  assert.equal(two.dataDomainRef, firstId)
  two.storeLease.release()
  const registry = JSON.parse(await readFile(join(hostRegistryDirectory(f.registryRoot), 'domains.json')))
  assert.equal(registry.schemaVersion, 1)
  assert.equal(registry.domains.length, 1)
  assert.equal(registry.domains[0].domainId, firstId)
  assert.equal(registry.domains[0].status, 'completed')
  assert.equal(registry.domains[0].ownerConfigBinding, one.ownerConfigBinding)
  assert.ok(!JSON.stringify(registry).includes('secret'))
})

test('canonical path aliases share domain and settings changes fail closed', async t => {
  const f = await fixture(t)
  const one = await create(f)
  one.storeLease.release()
  const alias = join(f.dir, '.', 'store.sqlite')
  const two = await create(f, alias)
  assert.equal(two.dataDomainRef, one.dataDomainRef)
  two.storeLease.release()
  await assert.rejects(create(f, f.store, { ...config, settingsDir: '/changed' }),
    error => error.code === 'CONFLICT' && error.details.reason === 'owner-config-mismatch')
})

test('damaged registry and store replacement cannot silently receive a new ID', async t => {
  const f = await fixture(t)
  const one = await create(f)
  one.storeLease.release()
  const registry = join(hostRegistryDirectory(f.registryRoot), 'domains.json')
  const saved = await readFile(registry)
  await writeFile(registry, '{bad')
  await assert.rejects(create(f), error => error.code === 'PRECONDITION_FAILED' && error.details.reason === 'registry-corrupt')
  await writeFile(registry, saved)
  await rm(f.store)
  const replacement = await createHostDomain({ store: join(f.dir, 'other.sqlite'), registryRoot: f.registryRoot,
    ownerConfigBinding: config })
  replacement.storeLease.release()
  await copyFile(join(f.dir, 'other.sqlite'), f.store)
  // Model an inode reuse deterministically. Creation time (or legacy
  // metadata verification) must still distinguish the replacement.
  const reused = await stat(f.store, { bigint: true })
  const registryValue = JSON.parse(saved)
  registryValue.domains[0].fileIdentity.dev = String(reused.dev)
  registryValue.domains[0].fileIdentity.ino = String(reused.ino)
  await writeFile(registry, `${JSON.stringify(registryValue)}\n`)
  await assert.rejects(findHostDomain(f), error => error.code === 'CONFLICT' &&
    error.details.reason === 'domain-registration-mismatch')
  delete registryValue.domains[0].fileIdentity.birthtimeNs
  await writeFile(registry, `${JSON.stringify(registryValue)}\n`)
  await assert.rejects(findHostDomain(f), error => error.code === 'CONFLICT' &&
    error.details.reason === 'domain-registration-mismatch')
  await assert.rejects(create(f), error => error.code === 'CONFLICT' && error.details.reason === 'domain-registration-mismatch')
})

test('legacy registry identity is checked against metadata and upgraded on reopen', async t => {
  const f = await fixture(t)
  const first = await create(f)
  first.storeLease.release()
  const registryPath = join(hostRegistryDirectory(f.registryRoot), 'domains.json')
  const registry = JSON.parse(await readFile(registryPath))
  delete registry.domains[0].fileIdentity.birthtimeNs
  await writeFile(registryPath, `${JSON.stringify(registry)}\n`)
  assert.equal((await findHostDomain(f)).domainId, first.dataDomainRef)
  const reopened = await create(f)
  reopened.storeLease.release()
  assert.equal(reopened.dataDomainRef, first.dataDomainRef)
  const upgraded = JSON.parse(await readFile(registryPath))
  if (reopened.fileIdentity.birthtimeNs !== undefined)
    assert.equal(upgraded.domains[0].fileIdentity.birthtimeNs, reopened.fileIdentity.birthtimeNs)
})

test('copy recovery assigns a new domain; changed diagnostic rejects before mutation', async t => {
  const f = await fixture(t)
  const original = await create(f)
  original.storeLease.release()
  const copy = join(f.dir, 'copy.sqlite')
  await copyFile(f.store, copy)
  const diagnosis = await inspectHostDomain({ store: copy, registryRoot: f.registryRoot })
  assert.equal(diagnosis.problem, 'domain-at-other-path')
  assert.deepEqual(diagnosis.availableModes, ['copy'])
  await assert.rejects(recoverHostDomain({ store: copy, mode: 'copy', expectedDiagnostic: 'stale', confirm: true,
    registryRoot: f.registryRoot }), error => error.code === 'CONFLICT' && error.details.reason === 'diagnostic-changed')
  const recovered = await recoverHostDomain({ store: copy, mode: 'copy', expectedDiagnostic: diagnosis.diagnosticRevision,
    confirm: true, registryRoot: f.registryRoot })
  assert.notEqual(recovered.dataDomainRef, original.dataDomainRef)
  assert.equal((await findHostDomain({ store: copy, registryRoot: f.registryRoot })).domainId, recovered.dataDomainRef)
  assert.equal((await findHostDomain(f)).domainId, original.dataDomainRef)
  const reopened = await create(f, copy)
  assert.equal(reopened.dataDomainRef, recovered.dataDomainRef)
  reopened.storeLease.release()
})

test('migrate retains domain identity and retires the old registered path', async t => {
  const f = await fixture(t)
  const original = await create(f)
  original.storeLease.release()
  const moved = join(f.dir, 'moved.sqlite')
  await copyFile(f.store, moved)
  const diagnosis = await inspectHostDomain({ store: moved, registryRoot: f.registryRoot })
  await assert.rejects(recoverHostDomain({ store: moved, mode: 'migrate',
    expectedDiagnostic: diagnosis.diagnosticRevision, confirm: true, registryRoot: f.registryRoot }),
  error => error.code === 'PRECONDITION_FAILED' && error.details.reason === 'source-retirement-unverified')
  const result = await recoverHostDomain({ store: moved, mode: 'migrate',
    expectedDiagnostic: diagnosis.diagnosticRevision, confirm: true, registryRoot: f.registryRoot,
    verifySourceRetired: () => true })
  assert.equal(result.dataDomainRef, original.dataDomainRef)
  assert.equal(await findHostDomain(f), null)
  await assert.rejects(create(f), error => error.code === 'CONFLICT' && error.details.reason === 'domain-registration-mismatch')
  const reopened = await create(f, moved)
  assert.equal(reopened.dataDomainRef, original.dataDomainRef)
  reopened.storeLease.release()
})

test('recover requires confirmed mode and exact diagnostic; busy owner is never stolen', async t => {
  const f = await fixture(t)
  const one = await create(f)
  const copy = join(f.dir, 'copy.sqlite')
  await copyFile(f.store, copy)
  const diagnosis = await inspectHostDomain({ store: copy, registryRoot: f.registryRoot })
  await assert.rejects(recoverHostDomain({ store: copy, mode: 'copy', expectedDiagnostic: diagnosis.diagnosticRevision,
    registryRoot: f.registryRoot }), error => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(recoverHostDomain({ store: copy, mode: 'copy', expectedDiagnostic: diagnosis.diagnosticRevision,
    confirm: true, registryRoot: f.registryRoot }), error => error.code === 'CONFLICT')
  one.storeLease.release()
})

// D01.H03: persisted intent survives each interruption boundary without minting
// another ID. These fixtures reproduce the on-disk states instead of relying
// on a timed process kill whose exact instruction boundary is nondeterministic.
test('replays interrupted initialization before and after DSH metadata commit', async t => {
  const f = await fixture(t)
  const first = await create(f)
  first.storeLease.release()
  const dir = hostRegistryDirectory(f.registryRoot)
  const registryPath = join(dir, 'domains.json')
  const intentPath = join(dir, 'domain-intent.json')
  const registry = JSON.parse(await readFile(registryPath))
  const record = registry.domains[0]
  const { createHash } = await import('node:crypto')
  const emptyRevision = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, domains: [] })).digest('hex')
  const intent = { version: 1, mode: 'initialize', transactionId: '252c3b8e-753f-4451-b937-bcb203801001',
    beforeRevision: emptyRevision, source: null, record: { ...record, fileIdentity: null } }
  await rm(registryPath)
  await createPrivateFile(intentPath, `${JSON.stringify(intent)}\n`)
  const afterMetadata = await create(f)
  assert.equal(afterMetadata.dataDomainRef, first.dataDomainRef)
  afterMetadata.storeLease.release()
  await assert.rejects(readFile(intentPath), { code: 'ENOENT' })

  await createPrivateFile(intentPath, `${JSON.stringify(intent)}\n`)
  const afterRegistry = await create(f)
  assert.equal(afterRegistry.dataDomainRef, first.dataDomainRef)
  afterRegistry.storeLease.release()
  await assert.rejects(readFile(intentPath), { code: 'ENOENT' })

  await rm(registryPath)
  await rm(f.store)
  await createPrivateFile(intentPath, `${JSON.stringify(intent)}\n`)
  const beforeMetadata = await create(f)
  assert.equal(beforeMetadata.dataDomainRef, first.dataDomainRef)
  beforeMetadata.storeLease.release()
  await assert.rejects(readFile(intentPath), { code: 'ENOENT' })
})

test('unknown host-domain version and hard-linked stores fail closed', async t => {
  const f = await fixture(t)
  const one = await create(f)
  one.storeLease.release()
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(f.store)
  try { assert.equal(db.prepare("UPDATE units SET version = 99 WHERE name = 'ivoraige_host'").run().changes, 1) }
  finally { db.close() }
  await assert.rejects(create(f), error => error.code === 'PRECONDITION_FAILED' &&
    error.details.reason === 'domain-schema-unsupported')
  const { link } = await import('node:fs/promises')
  await link(f.store, join(f.dir, 'hardlink.sqlite'))
  await assert.rejects(create(f), error => error.code === 'CONFLICT')
})

test('malformed store does not initialize a registry entry', async t => {
  const f = await fixture(t)
  await writeFile(f.store, 'not SQLite')
  await assert.rejects(create(f), error => error.code === 'PRECONDITION_FAILED' &&
    error.details.reason === 'domain-schema-unsupported')
  await assert.rejects(readFile(join(hostRegistryDirectory(f.registryRoot), 'domains.json')), { code: 'ENOENT' })
})

test('concurrent processes serialize registry updates without losing domains', async t => {
  const f = await fixture(t)
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const script = `import { createHostDomain } from './src/host-domain.mjs';
    const result = await createHostDomain({ store: process.argv[1], registryRoot: process.argv[2],
      ownerConfigBinding: {} }); result.storeLease.release(); console.log(result.dataDomainRef);`
  const stores = Array.from({ length: 6 }, (_, i) => join(f.dir, `parallel-${i}.sqlite`))
  const ids = await Promise.all(stores.map(async store => {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script, store, f.registryRoot],
      { cwd: new URL('..', import.meta.url), timeout: 30_000 })
    return stdout.trim()
  }))
  assert.equal(new Set(ids).size, stores.length)
  const registry = JSON.parse(await readFile(join(hostRegistryDirectory(f.registryRoot), 'domains.json')))
  assert.equal(registry.domains.length, stores.length)
  assert.deepEqual(new Set(registry.domains.map(item => item.domainId)), new Set(ids))
})
