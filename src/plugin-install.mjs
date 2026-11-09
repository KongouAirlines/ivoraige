#!/usr/bin/env node
// Controlled offline delivery, not a loader or a second configuration platform.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readFile, realpath, mkdir, mkdtemp, cp, lstat } from 'node:fs/promises'
import { join, resolve, basename, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import semver from 'semver'
import { AppBoot, IVORAIGE_DSH_COMMIT, runProfilePnpm, writeFileAtomic } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { ensureProfile } from './model-settings.mjs'
import { acquireProfile, recoverProfile, snapshotProfile, commitProfile, rollbackProfile } from './plugin-profile.mjs'

const fail = (code, message) => { throw new KernelError(code, message) }
export const pluginRuntime = Object.freeze({ hostApi: 1, dshCommit: IVORAIGE_DSH_COMMIT,
  cordisVersion: '4.0.4', dshVersion: AppBoot.getDshRuntimeVersion() })
async function manifestAt(directory) { return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) }
function check(manifest) {
  if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(manifest.name ?? '') || !semver.valid(manifest.version))
    fail('INVALID_ARGUMENT', 'Plugin requires a valid package name and version')
  if (manifest.name === 'ivoraige-model-settings') fail('PRECONDITION_FAILED', 'The host-owned settings bundle cannot be replaced')
  if (!manifest.dsh?.bundle?.patch) fail('INVALID_ARGUMENT', 'Plugin must declare a DSH bundle patch')
  if (manifest.ivoraige?.hostApi !== pluginRuntime.hostApi || manifest.ivoraige?.dshCommit !== pluginRuntime.dshCommit)
    fail('PRECONDITION_FAILED', 'Plugin host API or pinned DSH runtime does not match')
  const mismatch = AppBoot.evaluatePluginCompatibility(manifest)
  if (mismatch) fail('PRECONDITION_FAILED', AppBoot.pluginCompatibilityWarning(mismatch))
  // This first delivery slice accepts self-contained same-repository packages.
  // DSH/Cordis are provided by the host; pnpm must not install another copy.
  if (['dependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies'].some(key => Object.keys(manifest[key] ?? {}).length))
    fail('COMPONENT_MISSING', 'Install requires a self-contained package; external dependencies are not supplied by this offline delivery path')
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (name !== '@deepseek-ai/dsh-app-boot' || manifest.peerDependenciesMeta?.[name]?.optional !== true)
      fail('COMPONENT_MISSING', `Unsupported required runtime peer: ${name}`)
  }
  if (Object.keys(manifest.scripts ?? {}).length) fail('PRECONDITION_FAILED', 'Plugin lifecycle scripts are not supported')
}

// Explicit IDs make every nested contribution an activation target. A group
// being active does not establish that its children loaded successfully.
function bundleRows(directory, manifest) {
  const flatten = rows => rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config) : [])])
  const rows = flatten(AppBoot.composeEntries([AppBoot.bundlePatchPaths(directory, manifest.dsh.bundle)
    .flatMap(file => AppBoot.loadOverlayPatches('dsh', file))]))
  if (rows.some(row => typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name) ||
      new Set(rows.map(row => row.id)).size !== rows.length)
    fail('INVALID_ARGUMENT', 'Controlled bundle rows require explicit unique IDs and module names')
  return rows
}

/** All changes require a stopped host; data, credentials and record stores are never removed. */
export async function managePlugins({ directory, action, packageDirectory, name, storePath, config,
  signal, pnpmCommand = 'pnpm' } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) fail('INVALID_ARGUMENT', 'A profile directory is required')
  directory = resolve(directory)
  const lease = await acquireProfile(directory)
  directory = lease.directory
  try {
    const recovered = await recoverProfile(directory)
    await ensureProfile(directory)
    const location = { binName: 'dsh', profileDir: directory, installAnchor: join(directory, 'package.json') }
    if (action === 'list' || action === 'recover') return { recovered, runtime: pluginRuntime,
      plugins: AppBoot.readProfilePlugins(location).dependencies }
    if (action === 'rollback') {
      await rollbackProfile(directory)
      return { application: 'restart-required' }
    }
    if (!['install', 'enable', 'disable', 'remove'].includes(action)) fail('INVALID_ARGUMENT', 'Unknown plugin action')
    let source
    if (action === 'install') {
      if (typeof packageDirectory !== 'string') fail('INVALID_ARGUMENT', 'A local package directory is required')
      source = await realpath(packageDirectory)
      if (source === directory || source.startsWith(directory + sep) || directory.startsWith(source + sep)) fail('INVALID_ARGUMENT', 'Package source must be outside its profile')
      const manifest = await manifestAt(source)
      check(manifest)
      name = manifest.name
      bundleRows(source, manifest)
    } else {
      if (name === 'ivoraige-model-settings') fail('PRECONDITION_FAILED', 'The host-owned settings bundle cannot be changed')
      const installed = AppBoot.readProfilePlugins(location).dependencies.find(row => row.name === name)
      if (!installed) fail('COMPONENT_MISSING', `Plugin is not installed: ${name}`)
      if (action === 'enable') check(await manifestAt(join(directory, 'node_modules', name)))
    }
    signal?.throwIfAborted()
    if (action === 'install') {
      // pnpm file-directory imports can hard-link the input. Never point its
      // dependency at an editable checkout or overwrite an earlier version.
      const packages = join(directory, '.plugin-packages')
      await mkdir(packages, { recursive: true })
      const staged = await mkdtemp(join(packages, 'source-'))
      await cp(source, staged, { recursive: true, filter: async path => {
        if (['node_modules', '.git'].includes(basename(path))) return false
        if ((await lstat(path)).isSymbolicLink()) fail('INVALID_ARGUMENT', 'Local package sources must not contain symlinks')
        return true
      } })
      source = staged
      check(await manifestAt(source))
    }
    await snapshotProfile(directory)
    let validationPid
    try {
      if (action === 'install' || action === 'remove') {
        const args = action === 'install' ? ['add', `file:${source}`] : ['remove', name]
        const result = await runProfilePnpm({ profile: 'ivoraige', dir: directory,
          installAnchor: location.installAnchor, cwd: directory }, args, {
          // Upstream repair invokes pnpm a second time using options.args, not
          // the primary argv. Keep every safety restriction on that shared prefix.
          args: ['--config.offline=true', '--config.ignore-scripts=true',
            `--store-dir=${join(directory, '.plugin-store')}`, '--config.auto-install-peers=false',
            '--config.dedupe-peer-dependents=false', '--package-import-method=copy'],
          command: pnpmCommand, execution: 'service', outputBytes: 32768, idleTimeoutMs: 30000,
          signal, activateNewBundles: false,
        })
        if (result.exitCode !== 0 || result.timedOut) fail('UPSTREAM_FAILURE', result.output || 'Offline package operation failed')
      }
      signal?.throwIfAborted()
      if (action === 'install') check(await manifestAt(join(directory, 'node_modules', name)))
      const manifest = await manifestAt(directory)
      const bundles = (manifest.dsh?.profile?.bundles ?? []).filter(bundle => bundle !== name)
      if (action === 'install' || action === 'enable') bundles.push(name)
      AppBoot.writeProfileBundles(directory, manifest, bundles)
      if (config !== undefined) {
        if (action !== 'install' || !config || typeof config !== 'object' || Array.isArray(config)) fail('INVALID_ARGUMENT', 'config must be an install configuration object')
        const installed = await manifestAt(join(directory, 'node_modules', name))
        const rows = AppBoot.composeEntries([AppBoot.bundlePatchPaths(join(directory, 'node_modules', name), installed.dsh.bundle)
          .flatMap(file => AppBoot.loadOverlayPatches('dsh', file))])
        if (rows.length !== 1 || !rows[0].id) fail('INVALID_ARGUMENT', 'config requires a single-entry bundle')
        const patchPath = join(directory, 'cordis.patch.yml')
        const patches = AppBoot.loadOverlayPatches('dsh', patchPath)
        patches.push({ id: rows[0].id, config })
        await writeFileAtomic(patchPath, JSON.stringify(patches) + '\n', { mode: 0o600 })
      }
      if (action === 'install' || action === 'enable') {
        const installed = await manifestAt(join(directory, 'node_modules', name))
        const ids = bundleRows(join(directory, 'node_modules', name), installed).map(row => row.id)
        // Fresh process: ESM caches must not validate a previous installed version.
        lease.releaseProbe()
        let validationFailure
        try {
          const validation = promisify(execFile)(process.execPath, [fileURLToPath(new URL('./plugin-validate.mjs', import.meta.url)),
          JSON.stringify({ directory, storePath, ids })], { timeout: 30000, maxBuffer: 32768, signal })
          validationPid = validation.child.pid
          await validation
        }
        catch (error) { validationFailure = new KernelError('PRECONDITION_FAILED',
          `Plugin activation failed: ${error.stderr || error.message}`, {}, { cause: error }) }
        // A child may release its lease between this attempt and the outer
        // recovery retry. Do not replace its activation failure with a transient
        // ownership error when the retry can safely complete recovery.
        try { await lease.reacquireProbe() }
        catch (error) { throw validationFailure ?? error }
        if (validationFailure) throw validationFailure
      }
      await commitProfile(directory)
      return { name, application: 'restart-required', runtime: pluginRuntime }
    } catch (error) {
      // execFile cancellation/timeout can reject before a SIGTERM-resistant
      // validator exits. Never restore packages while that process owns them.
      try { await lease.reacquireProbe() }
      catch (cause) {
        throw new KernelError('CONFLICT', 'Plugin validation is still running; package recovery is pending until it exits',
          { recoveryPending: true, ...(validationPid ? { validationPid } : {}) }, { cause })
      }
      await recoverProfile(directory)
      throw error
    }
  } finally { lease.release() }
}

// Only operational recovery fields cross the CLI boundary; never dump causes
// or arbitrary plugin-provided details into the diagnostic object.
export function pluginDiagnostic(error) {
  const details = {}
  if (error.details?.recoveryPending === true) details.recoveryPending = true
  if (Number.isSafeInteger(error.details?.validationPid) && error.details.validationPid > 0)
    details.validationPid = error.details.validationPid
  return { code: error.code ?? 'UPSTREAM_FAILURE', message: error.message,
    ...(Object.keys(details).length ? { details } : {}) }
}

function invokedAsCli() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])) }
  catch { return false }
}

// Recovery remains available without starting AppBoot or the optional plugin.
// Canonicalize both sides for npm bin links and macOS temporary-directory aliases.
if (invokedAsCli()) {
  try {
    const [action, directory, target, configuration] = process.argv.slice(2)
    console.log(JSON.stringify(await managePlugins({ action, directory, name: target,
      packageDirectory: target, ...(configuration ? JSON.parse(configuration) : {}) })))
  } catch (error) {
    console.error(JSON.stringify(pluginDiagnostic(error)))
    process.exitCode = 1
  }
}
