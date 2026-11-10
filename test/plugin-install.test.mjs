import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, symlink, chmod } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { managePlugins, pluginRuntime, pluginDiagnostic } from '../src/plugin-install.mjs'
import { bootModelSettings } from '../src/model-settings.mjs'
import { acquireProfile, snapshotProfile, acquireProbe, ownsProfile } from '../src/plugin-profile.mjs'

async function setup(t, beforeCleanup) {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-delivery-'))
  t.after(async () => {
    await beforeCleanup?.()
    await rm(root, { recursive: true, force: true })
  })
  const directory = join(root, 'profile'), source = join(root, 'package')
  await mkdir(source)
  const manifest = { name: '@ivoraige/delivery-probe', version: '0.1.0', type: 'module', exports: './index.mjs',
    peerDependencies: { '@deepseek-ai/dsh-app-boot': pluginRuntime.dshVersion },
    peerDependenciesMeta: { '@deepseek-ai/dsh-app-boot': { optional: true } },
    ivoraige: { hostApi: 1, dshCommit: pluginRuntime.dshCommit }, dsh: { bundle: { patch: 'cordis.patch.yml' } } }
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'delivery-probe', name: './index.mjs' }] }]))
  await writeFile(join(source, 'index.mjs'), 'export default function(ctx) { ctx.provide("deliveryProbe", { value: 1 }) }')
  return { root, source, directory, manifest }
}

test('real offline pnpm install, shared AppBoot, disable/restart, enable, uninstall retain data', async t => {
  const { source, directory, manifest } = await setup(t)
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
  await writeFile(join(directory, 'user-data.txt'), 'keep')
  const installed = await managePlugins({ directory, action: 'install', packageDirectory: source })
  assert.equal(installed.application, 'restart-required')
  let app = await bootModelSettings({ directory })
  assert.equal(app.ctx.get('deliveryProbe').value, 1)
  await assert.rejects(managePlugins({ directory, action: 'disable', name: manifest.name }), { code: 'CONFLICT' })
  await app.dispose()
  await managePlugins({ directory, action: 'disable', name: manifest.name })
  app = await bootModelSettings({ directory })
  assert.equal(app.ctx.get('deliveryProbe'), undefined)
  assert.ok(app.settings)
  await app.dispose()
  await managePlugins({ directory, action: 'enable', name: manifest.name })
  await managePlugins({ directory, action: 'remove', name: manifest.name })
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
  assert.equal(await readFile(join(directory, 'user-data.txt'), 'utf8'), 'keep')
})

test('incompatibility and missing dependencies are diagnosed before mutation', async t => {
  const { source, directory, manifest } = await setup(t)
  await managePlugins({ directory, action: 'list' })
  const before = await readFile(join(directory, 'package.json'), 'utf8')
  for (const [change, code] of [[{ dependencies: { missing: '1.0.0' } }, 'COMPONENT_MISSING'],
    [{ ivoraige: { hostApi: 2 } }, 'PRECONDITION_FAILED'],
    [{ peerDependencies: { '@deepseek-ai/dsh-app-boot': '99.0.0' } }, 'PRECONDITION_FAILED']]) {
    await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest, ...change }))
    await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source }), { code })
    assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
  }
})

test('activation failure restores previous package contents and manifest', async t => {
  const { source, directory, manifest } = await setup(t)
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  const before = await readFile(join(directory, 'package.json'), 'utf8')
  await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest, version: '0.1.1' }))
  await writeFile(join(source, 'index.mjs'), 'throw new Error("activation-injected")')
  await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source }))
  assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
  const app = await bootModelSettings({ directory })
  assert.equal(app.ctx.get('deliveryProbe').value, 1)
  await app.dispose()
})

test('durable interrupted transaction recovers on boot; rollback retains complete previous version', async t => {
  const { source, directory, manifest } = await setup(t)
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  const lease = await acquireProfile(directory)
  await snapshotProfile(directory)
  await writeFile(join(directory, 'package.json'), 'interrupted')
  await rm(join(directory, 'node_modules'), { recursive: true })
  lease.release()
  let app = await bootModelSettings({ directory })
  assert.equal(app.ctx.get('deliveryProbe').value, 1)
  await app.dispose()
  await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest, version: '0.1.2' }))
  await writeFile(join(source, 'index.mjs'), 'export default function(ctx) { ctx.provide("deliveryProbe", { value: 2 }) }')
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  await managePlugins({ directory, action: 'rollback' })
  app = await bootModelSettings({ directory })
  assert.equal(app.ctx.get('deliveryProbe').value, 1)
  await app.dispose()
})

test('MinerU is a complete independent source package, installed without native assets', async t => {
  const { root, directory } = await setup(t)
  const source = join(root, 'mineru-package')
  await cp(new URL('../plugins/mineru/', import.meta.url), source, { recursive: true })
  const storePath = join(root, 'records.sqlite')
  await managePlugins({ directory, action: 'install', packageDirectory: source, storePath,
    config: { directory: join(root, 'mineru-data') } })
  const app = await bootModelSettings({ directory, storePath })
  assert.ok(app.ctx.get('ivoraige.parse'))
  assert.equal((await managePlugins({ directory: join(root, 'other-profile'), action: 'list' })).plugins.length, 0)
  await app.dispose()
})

test('legacy PDF and a profile-owned same-id source conflict explicitly and release the host', async t => {
  const { source, directory, root } = await setup(t)
  await writeFile(join(source, 'index.mjs'), `export default function(ctx) {
    ctx.effect(() => ctx.get('ivoraige.parse').register({ id:'babeldoc', formats:['pdf'],
      match:()=>1, parse:()=>({units:[]}) }))
  }`)
  const { createApp } = await import('../src/app.mjs')
  const store = join(root, 'records.sqlite')
  await managePlugins({ directory, action: 'install', packageDirectory: source, storePath: store })
  let app = await createApp({ store, settingsDir: directory })
  assert.ok(app.parse.adapters.has('babeldoc'))
  await app.dispose()
  await assert.rejects(createApp({ store, settingsDir: directory, pdf: { command: 'unused' } }),
    error => /Source adapter already registered: babeldoc/.test(error.message))
  app = await createApp({ store, settingsDir: directory })
  assert.ok(app.parse.adapters.has('babeldoc'))
  await app.dispose()
})

test('package command failure and pre-cancellation leave the previous complete profile', async t => {
  const { source, directory } = await setup(t)
  await managePlugins({ directory, action: 'list' })
  const before = await readFile(join(directory, 'package.json'), 'utf8')
  await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source,
    pnpmCommand: join(directory, 'missing-package-manager') }))
  assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
  await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source,
    signal: AbortSignal.abort() }))
  assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
  assert.ok((await managePlugins({ directory, action: 'list' })).plugins.length === 0)
})

test('process death after durable journal publication restores packages at next boot', async t => {
  const { source, directory } = await setup(t)
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { acquireProfile, snapshotProfile, acquireProbe } from ${JSON.stringify(new URL('../src/plugin-profile.mjs', import.meta.url).href)};
    import { writeFile, rm } from 'node:fs/promises';
    import { join } from 'node:path';
    const directory = ${JSON.stringify(directory)};
    await acquireProfile(directory);
    await snapshotProfile(directory);
    await writeFile(join(directory, 'package.json'), 'interrupted');
    await rm(join(directory, 'node_modules'), {recursive:true});
    process.kill(process.pid, 'SIGKILL');
  `], { encoding: 'utf8' })
  assert.ok(child.signal || child.status !== 0, child.stderr)
  const app = await bootModelSettings({ directory })
  assert.equal(app.ctx.get('deliveryProbe').value, 1)
  await app.dispose()
})

test('missing runtime injection rolls back without preventing the recovery entry', async t => {
  const { source, directory } = await setup(t)
  await writeFile(join(source, 'index.mjs'), `function probe() {}
    probe.inject = ['missingRequiredService']; export default probe`)
  await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source }),
    error => error.code === 'PRECONDITION_FAILED' && /missingRequiredService/.test(error.message))
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
  const app = await bootModelSettings({ directory })
  assert.ok(app.settings)
  await app.dispose()
})


test('canonical profile aliases cannot bypass source/profile overlap rejection', async t => {
  const { root, source, directory } = await setup(t)
  await mkdir(directory)
  const alias = join(root, 'profile-alias')
  await symlink(directory, alias, 'junction')
  const nested = join(directory, 'source-package')
  await cp(source, nested, { recursive: true })
  await assert.rejects(managePlugins({ directory: alias, action: 'install', packageDirectory: nested }),
    error => error.code === 'INVALID_ARGUMENT' && /outside its profile/.test(error.message))
  const app = await bootModelSettings({ directory: alias })
  await assert.rejects(managePlugins({ directory, action: 'list' }), { code: 'CONFLICT' })
  await app.dispose()
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
})


test('native compatibility repair inherits every offline package restriction', { skip: process.platform === 'win32' }, async t => {
  const { root, source, directory } = await setup(t)
  const stub = join(root, 'pnpm-stub')
  const calls = join(root, 'calls.jsonl')
  await writeFile(stub, `#!${process.execPath}
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
const args = process.argv.slice(2);
await appendFile(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args.includes('add')) {
  const path = join(process.cwd(), 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, 'delivery-probe': 'file:fixture' };
  await writeFile(path, JSON.stringify(manifest));
  const installed = join(process.cwd(), 'node_modules', 'delivery-probe');
  await mkdir(installed, {recursive:true});
  await writeFile(join(installed, 'package.json'), JSON.stringify({name:'delivery-probe',version:'1.0.0',
    peerDependencies:{'@deepseek-ai/dsh-app-boot':'99.0.0'}}));
}
`)
  await chmod(stub, 0o755)
  await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source, pnpmCommand: stub }),
    { code: 'UPSTREAM_FAILURE' })
  const argv = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(argv.length, 2)
  assert.ok(argv[0].includes('add'))
  assert.ok(argv[1].includes('install'))
  for (const args of argv) {
    for (const flag of ['--config.offline=true', '--config.ignore-scripts=true',
      '--config.auto-install-peers=false', '--config.dedupe-peer-dependents=false', '--package-import-method=copy'])
      assert.ok(args.includes(flag), `Missing ${flag} in ${JSON.stringify(args)}`)
    assert.ok(args.some(flag => flag.startsWith('--store-dir=')))
  }
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
})

test('nested missing-service and disabled contributions cannot pass installation validation', async t => {
  const { source, directory } = await setup(t)
  await writeFile(join(source, 'index.mjs'), `function probe() {}
    probe.inject = ['missingGroupService']; export default probe`)
  for (const disabled of [false, true]) {
    await writeFile(join(source, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'outer-group',
      name: 'cordis:group', group: true, config: [{ id: 'inner-probe', name: './index.mjs', disabled }] }] }]))
    await assert.rejects(managePlugins({ directory, action: 'install', packageDirectory: source }),
      error => error.code === 'PRECONDITION_FAILED' &&
        (disabled ? /absent, disabled or inactive: inner-probe/.test(error.message) : /missingGroupService/.test(error.message)))
    assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
  }
})


test('cancelled validation respects platform termination and releases ownership before cleanup', async t => {
  const abort = new AbortController()
  let pid, outcome, root, source, directory, marker
  const stopValidator = async () => {
    abort.abort()
    if (outcome) await outcome
    if (!directory) return
    let lease
    const stopped = Date.now() + 5000
    while (!lease && Date.now() < stopped) {
      if (!pid && marker) {
        try { pid = Number(await readFile(marker, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      if (pid) {
        try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
        pid = undefined
        marker = undefined // Never address an already reaped PID during later cleanup.
      }
      try { lease = await acquireProbe(directory) } catch (error) { if (error.code !== 'CONFLICT') throw error }
      if (!lease) await new Promise(resolve => setTimeout(resolve, 15))
    }
    assert.ok(lease, 'Validator retained its lease after termination')
    lease.release()
  }
  ;({ root, source, directory } = await setup(t, stopValidator))
  marker = join(root, 'validator-pid')
  await writeFile(join(source, 'index.mjs'), `import { writeFile } from 'node:fs/promises';
    export default async function() {
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      await writeFile(${JSON.stringify(marker)}, String(process.pid));
      await new Promise(() => {});
    }`)
  const operation = managePlugins({ directory, action: 'install', packageDirectory: source, signal: abort.signal })
  outcome = operation.then(value => ({value}), error => ({error}))
  const deadline = Date.now() + 30000
  while (!pid && Date.now() < deadline) {
    try { pid = Number(await readFile(marker, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!pid) await new Promise(resolve => setTimeout(resolve, 15))
  }
  assert.ok(pid, 'Validator did not reach its explicit activation barrier')
  abort.abort()
  const result = await outcome
  const pending = result.error?.details?.recoveryPending === true
  // POSIX ignores SIGTERM here; Windows forcibly terminates the target and may
  // already release its lease before the installer attempts rollback.
  if (process.platform !== 'win32') assert.equal(pending, true)
  if (pending) {
    assert.equal(result.error.code, 'CONFLICT')
    assert.ok(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).dependencies['@ivoraige/delivery-probe'])
    assert.ok(await readFile(join(directory, '.plugin-transaction', 'ready')))
    if (process.platform !== 'win32')
      await assert.rejects(managePlugins({ directory, action: 'recover' }), {code:'CONFLICT'})
  } else {
    assert.equal(result.error?.code, 'PRECONDITION_FAILED')
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).dependencies, {})
  }
  await stopValidator()
  const recovered = await managePlugins({ directory, action: 'recover' })
  assert.equal(recovered.recovered, pending)
  assert.equal(recovered.plugins.length, 0)
})


test('plugin CLI runs through directory aliases and stays inert when imported', async t => {
  const { root } = await setup(t)
  const checkout = fileURLToPath(new URL('../', import.meta.url))
  const alias = join(root, 'checkout-alias')
  await symlink(checkout, alias, 'junction')
  for (const [index, entry] of [join(checkout, 'src/plugin-install.mjs'), join(alias, 'src/plugin-install.mjs')].entries()) {
    const result = spawnSync(process.execPath, [entry, 'list', join(root, `cli-profile-${index}`)], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.notEqual(result.stdout.trim(), '', 'CLI alias must not silently skip dispatch')
    assert.deepEqual(JSON.parse(result.stdout).plugins, [])
  }
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('../src/plugin-install.mjs', import.meta.url).href)})`], { encoding: 'utf8' })
  assert.equal(imported.status, 0, imported.stderr)
  assert.equal(imported.stdout, '')
})


test('borrowed profile lease accepts a canonical alias and recovers before boot', async t => {
  let lease
  const { root, directory } = await setup(t, () => lease?.release())
  await managePlugins({ directory, action: 'list' })
  lease = await acquireProfile(directory)
  const alias = join(root, 'borrowed-profile-alias')
  await symlink(directory, alias, 'junction')
  assert.equal(ownsProfile(lease, directory), true)
  assert.equal(ownsProfile(lease, alias), true)
  await snapshotProfile(directory)
  await writeFile(join(directory, 'package.json'), 'interrupted')
  const app = await bootModelSettings({ directory: alias, profileLease: lease })
  assert.ok(app.settings)
  await app.dispose()
  // Disposal must not release ownership borrowed from the embedding caller.
  await assert.rejects(managePlugins({ directory, action: 'list' }), { code: 'CONFLICT' })
  lease.release()
  assert.equal(ownsProfile(lease, alias), false)
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
})

test('CLI diagnostic retains only safe recovery fields', () => {
  const diagnostic = pluginDiagnostic({ code:'CONFLICT', message:'Recovery pending',
    details:{recoveryPending:true,validationPid:12345,credential:'secret'}, cause:new Error('private') })
  assert.deepEqual(diagnostic, {code:'CONFLICT',message:'Recovery pending',
    details:{recoveryPending:true,validationPid:12345}})
  assert.deepEqual(pluginDiagnostic({message:'Failure',details:{validationPid:-1,recoveryPending:'yes'}}),
    {code:'UPSTREAM_FAILURE',message:'Failure'})
})

test('death between commit renames preserves the previous complete rollback point', async t => {
  const { source, directory, manifest } = await setup(t)
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  await writeFile(join(source, 'package.json'), JSON.stringify({...manifest,version:'0.1.1'}))
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { acquireProfile, snapshotProfile } from ${JSON.stringify(new URL('../src/plugin-profile.mjs', import.meta.url).href)};
    import { writeFile, rename } from 'node:fs/promises';
    import { join } from 'node:path';
    const directory = ${JSON.stringify(directory)};
    await acquireProfile(directory);
    await snapshotProfile(directory);
    await writeFile(join(directory, 'package.json'), 'interrupted');
    await rename(join(directory, '.plugin-previous'), join(directory, '.plugin-obsolete'));
    process.kill(process.pid, 'SIGKILL');
  `], {encoding:'utf8'})
  assert.ok(child.signal || child.status !== 0, child.stderr)
  assert.equal((await managePlugins({directory,action:'recover'})).recovered, true)
  const installed = join(directory, 'node_modules', manifest.name, 'package.json')
  assert.equal(JSON.parse(await readFile(installed, 'utf8')).version, '0.1.1')
  await managePlugins({directory,action:'rollback'})
  assert.equal(JSON.parse(await readFile(installed, 'utf8')).version, '0.1.0')
})


test('explicit rollback never promotes partially removed obsolete bytes', async t => {
  const { source, directory } = await setup(t)
  await managePlugins({ directory, action: 'install', packageDirectory: source })
  const obsolete = join(directory, '.plugin-obsolete')
  await mkdir(obsolete)
  await writeFile(join(obsolete, 'ready'), JSON.stringify(['node_modules']))
  await managePlugins({ directory, action: 'rollback' })
  assert.equal((await managePlugins({ directory, action: 'list' })).plugins.length, 0)
  await assert.rejects(managePlugins({ directory, action: 'rollback' }), /No previous complete/)
})


for (const busyAttempts of [[2], [2, 3]]) {
  test(`validation failure survives probe reacquisition schedule ${busyAttempts.join(',')}`, async t => {
    const { source, directory, manifest } = await setup(t)
    await managePlugins({ directory, action: 'list' })
    const before = await readFile(join(directory, 'package.json'), 'utf8')
    await writeFile(join(source, 'index.mjs'), `function probe() {}
      probe.inject = ['originalValidationDependency']; export default probe`)
    const exec = DatabaseSync.prototype.exec
    let attempts = 0
    const injected = t.mock.method(DatabaseSync.prototype, 'exec', function(sql, ...args) {
      if (sql === 'BEGIN IMMEDIATE' && this.location('main')?.endsWith('.plugin-validation.owner.sqlite')) {
        attempts++
        if (busyAttempts.includes(attempts))
          throw Object.assign(new Error('Injected transient validation ownership conflict'), { errcode: 5 })
      }
      return Reflect.apply(exec, this, [sql, ...args])
    })
    const error = await managePlugins({ directory, action: 'install', packageDirectory: source }).then(
      () => assert.fail('Missing expected validation failure'), error => error)
    assert.equal(attempts, 3, 'Exercise the first reacquisition and the outer recovery retry')
    injected.mock.restore()
    if (busyAttempts.length === 1) {
      assert.equal(error.code, 'PRECONDITION_FAILED')
      assert.match(error.message, /originalValidationDependency/)
      assert.equal(error.details?.recoveryPending, undefined)
      assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
    } else {
      assert.equal(error.code, 'CONFLICT')
      assert.equal(error.details?.recoveryPending, true)
      assert.ok(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).dependencies[manifest.name])
      assert.ok(await readFile(join(directory, '.plugin-transaction', 'ready')))
      assert.equal((await managePlugins({ directory, action: 'recover' })).recovered, true)
      assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
    }
  })
}
