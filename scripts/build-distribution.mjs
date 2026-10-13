import { cp, mkdir, mkdtemp, readFile, rm, writeFile, copyFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const version = packageJson.version
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows distribution builds must run on Windows x64')
}
if (process.versions.node !== '26.7.0') throw new Error(`Distribution build requires validated Node.js 26.7.0; found ${process.versions.node}`)

const runsRoot = resolve(root, 'evaluation', 'runs')
const distribution = join(runsRoot, `distribution-${version}`)
const stage = join(distribution, 'windows-x64')
const appDir = join(stage, 'app')
const runtimeDir = join(stage, 'runtime')
const archive = join(distribution, `ivoraige-${version}-win32-x64.zip`)
if (!resolve(distribution).startsWith(`${runsRoot}${sep}`) ||
    !resolve(stage).startsWith(`${resolve(distribution)}${sep}`)) {
  throw new Error('Refusing to write distribution output outside evaluation/runs')
}
const tempRoot = resolve(tmpdir())
const probe = await mkdtemp(join(tempRoot, 'ivoraige-dist-smoke-'))
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
const cleanHome = join(probe, 'profile')
await mkdir(cleanHome, { recursive: true })
const cleanPath = [join(systemRoot, 'System32')].join(';')
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

function run(command, args, { cwd = root, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

async function digest(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

try {
  await rm(stage, { recursive: true, force: true })
  await mkdir(appDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })
  for (const name of ['package.json', 'package-lock.json']) await copyFile(join(root, name), join(appDir, name))
  const installEnv = { ...process.env }
  delete installEnv.npm_config_allow_scripts
  delete installEnv.NPM_CONFIG_ALLOW_SCRIPTS
  run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: appDir, env: installEnv })
  await cp(join(root, 'src'), join(appDir, 'src'), { recursive: true })
  const distDir = join(appDir, 'dist')
  await mkdir(distDir, { recursive: true })
  for (const name of ['dsh.mjs', 'DSH-LICENSE.txt', 'THIRD_PARTY_LICENSES.txt']) {
    await copyFile(join(root, 'dist', name), join(distDir, name))
  }
  await cp(join(root, 'dist', 'web'), join(distDir, 'web'), { recursive: true })
  for (const name of ['README.md', 'THIRD_PARTY.md']) await copyFile(join(root, name), join(appDir, name))
  const userDocs = join(appDir, 'docs', 'plan', '0.1.0')
  await mkdir(userDocs, { recursive: true })
  for (const name of ['installation-guide.md', 'workbench-guide.md', 'pdf-guide.md', 'settings-guide.md']) {
    await copyFile(join(root, 'docs', 'plan', '0.1.0', name), join(userDocs, name))
  }

  const runtime = join(runtimeDir, 'node.exe')
  await copyFile(process.execPath, runtime)
  await copyFile(join(root, 'scripts', 'NODE-LICENSE-v26.7.0.txt'), join(runtimeDir, 'NODE-LICENSE.txt'))
  const launcher = join(stage, 'ivoraige.cmd')
  await writeFile(launcher, [
    '@echo off',
    'setlocal',
    'if not defined NODE_USE_ENV_PROXY set "NODE_USE_ENV_PROXY=1"',
    'set "NO_PROXY=localhost,127.0.0.1,::1,%NO_PROXY%"',
    'set "IVORAIGE_APP_ROOT=%~dp0app"',
    '"%~dp0runtime\\node.exe" "%~dp0app\\src\\launch.mjs" %*',
    'exit /b %errorlevel%',
    '',
  ].join('\r\n'))

  const smokeDir = join(probe, 'data')
  await mkdir(smokeDir, { recursive: true })
  const env = {
    PATH: cleanPath,
    SystemRoot: systemRoot,
    WINDIR: process.env.WINDIR ?? systemRoot,
    TEMP: probe,
    TMP: probe,
    USERPROFILE: cleanHome,
    HOME: cleanHome,
    LOCALAPPDATA: join(cleanHome, 'AppData', 'Local'),
    APPDATA: join(cleanHome, 'AppData', 'Roaming'),
    COMSPEC: join(systemRoot, 'System32', 'cmd.exe'),
    IVORAIGE_DATA_DIR: smokeDir,
    IVORAIGE_SMOKE_DIR: smokeDir,
    IVORAIGE_APP_ROOT: appDir,
    NODE_OPTIONS: '',
  }
  const nodeVersion = run(runtime, ['--version'], { cwd: stage, env }).trim()
  if (nodeVersion !== `v${process.versions.node}`) throw new Error(`Bundled runtime version mismatch: ${nodeVersion}`)
  const wrapperProbe = join(probe, 'launcher-smoke.cmd')
  await writeFile(wrapperProbe, `@call "${launcher}" help\r\n@exit /b %errorlevel%\r\n`)
  const help = run(env.COMSPEC, ['/d', '/c', wrapperProbe], { cwd: probe, env })
  if (!/ivoraige/i.test(help)) throw new Error(`Packaged launcher help was unexpected: ${help.slice(0, 400)}`)

  const bootProbe = join(probe, 'boot-probe.mjs')
  await writeFile(bootProbe, `
    import { createApp } from ${JSON.stringify(pathToFileURL(join(appDir, 'src', 'app.mjs')).href)}
    import { join } from 'node:path'
    const base = process.env.IVORAIGE_SMOKE_DIR
    const app = await createApp({ store: join(base, 'store.sqlite'), settingsDir: join(base, 'settings') })
    try {
      if (!app.records || !app.tasks || !app.settings) throw new Error('Expected DSH-backed services were not registered')
      process.stdout.write('Packaged settings and SQLite boot passed\\n')
    } finally { await app.dispose() }
  `)
  const boot = run(runtime, [bootProbe], { cwd: stage, env })
  if (!boot.includes('Packaged settings and SQLite boot passed')) throw new Error(`Settings/SQLite probe failed: ${boot}`)

  const archiveStat = await stat(archive).catch(() => null)
  if (archiveStat) await rm(archive, { force: true })
  run('tar.exe', ['-a', '-c', '-f', archive, '-C', stage, '.'])
  const archiveStatAfter = await stat(archive)
  const evidence = {
    version,
    platform: 'win32',
    arch: 'x64',
    format: 'portable-folder-zip',
    runtime: `Node.js ${process.versions.node} bundled as runtime/node.exe; official upstream license at runtime/NODE-LICENSE.txt`,
    entry: 'ivoraige.cmd -> runtime/node.exe app/src/launch.mjs',
    seaProbe: 'Node 26.7 ESM SEA built, then failed on esbuild-generated dynamic require("process") in yaml; CJS output fails at bundle time on top-level await/import.meta.',
    output: archive,
    bytes: archiveStatAfter.size,
    sha256: await digest(archive),
    checks: ['bundled runtime starts with System32-only PATH', 'cmd wrapper help with isolated user profile', 'DSH settings and SQLite boot/dispose with isolated user profile'],
    contents: ['app/src', 'app/dist including web assets and licenses', 'app/node_modules (production only)', 'app/docs/plan/0.1.0 user guides', 'runtime/node.exe', 'runtime/NODE-LICENSE.txt', 'ivoraige.cmd'],
  }
  await writeFile(join(distribution, 'build-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  const resolvedProbe = resolve(probe)
  if (!resolvedProbe.startsWith(`${tempRoot}${sep}`) || !resolvedProbe.split(sep).at(-1).startsWith('ivoraige-dist-smoke-')) {
    throw new Error(`Refusing to remove unexpected temporary directory: ${resolvedProbe}`)
  }
  await rm(resolvedProbe, { recursive: true, force: true })
}
