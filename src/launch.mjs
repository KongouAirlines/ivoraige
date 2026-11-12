import { spawn } from 'node:child_process'
import { mkdir, realpath, unlink, rmdir, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultDataDirectory } from './data-directory.mjs'
import { KernelError } from './errors.mjs'
import { isSea } from 'node:sea'
import { startHost } from './app.mjs'
import { serve } from './http.mjs'
import { runCli } from './cli.mjs'
import { assertPrivateDirectory, createPrivateFile, ensurePrivateDirectory } from './host-permissions.mjs'

const pairingLifetimeMs = 30_000

async function removePairingDirectory(directory) {
  try { await assertPrivateDirectory(directory) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  try { await unlink(join(directory, 'open.html')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await rmdir(directory) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

export async function createBrowserPairingPage(dataDir, url, credential) {
  const root = join(dataDir, '.browser-pairing')
  await ensurePrivateDirectory(root)
  // Reap only our expired, uniquely named pages. A crash cannot run a timer.
  for (const name of await readdir(root)) {
    const match = /^(\d{13})-([0-9a-f-]{36})$/.exec(name)
    if (!match || Date.now() - Number(match[1]) < pairingLifetimeMs) continue
    await removePairingDirectory(join(root, name)).catch(() => {})
  }
  const directory = join(root, `${Date.now()}-${randomUUID()}`)
  await ensurePrivateDirectory(directory)
  const path = join(directory, 'open.html')
  const target = `${url}/#owner=${encodeURIComponent(credential)}`
  // The opener sees only a file URL. The credential stays in a private file
  // until the browser loads it and moves to the loopback page.
  const html = `<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"></head><body><script>location.replace(${JSON.stringify(target)})</script></body></html>`
  let timer
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    clearTimeout(timer)
    await removePairingDirectory(directory)
    cleaned = true
  }
  try {
    await createPrivateFile(path, html)
    timer = setTimeout(() => { void cleanup().catch(() => {}) }, pairingLifetimeMs)
    return { url: pathToFileURL(path).href, cleanup }
  } catch (error) {
    await cleanup().catch(() => {})
    throw error
  }
}

export function openBrowser(url) {
  // Only a private local file URL reaches the platform opener.
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', () => reject(new Error('Could not open the browser. Run ivoraige again to open a newly paired workbench.')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export async function launch({ dataDir = defaultDataDirectory(), open = true, port = 0,
  appRoot = process.env.IVORAIGE_APP_ROOT ?? (isSea() ? dirname(process.execPath) : resolve(import.meta.dirname, '..')),
  components = {}, opener = openBrowser, registryRoot } = {}) {
  await mkdir(dataDir, { recursive: true })
  dataDir = await realpath(dataDir)
  const app = await startHost({ store: join(dataDir, 'store.sqlite'), settingsDir: join(dataDir, 'settings'),
    components: { directory: join(dataDir, 'components'), ...components }, registryRoot })
  let pairing
  try {
    let url
    if (app.reused) {
      const info = await app.client.request('transportInfo')
      if (!info.url) throw new KernelError('CONFLICT', 'The owner has no browser entry', { reason: 'owner-http-unavailable' })
      url = info.url
    } else {
      const server = await serve(app, { port, staticDir: join(appRoot, 'dist', 'web'), mcp: false })
      url = server.url
    }
    if (open) {
      const bootstrap = app.reused ? await app.client.request('ownerBootstrap') : app.host.browserBootstrap()
      pairing = await createBrowserPairingPage(dataDir, url, bootstrap.credential)
      await opener(pairing.url)
    }
    return { app: app.reused ? undefined : app, url, reused: app.reused, dataDir,
      generation: app.generation, dataDomainRef: app.dataDomainRef,
      whenClosed: app.host?.whenClosed, close: async () => {
        await pairing?.cleanup()
        await app.dispose()
      } }
  } catch (error) {
    await pairing?.cleanup().catch(() => {})
    try { await app.dispose() } catch { /* Incomplete disposal retains ownership. */ }
    throw error
  }
}

export async function runLauncher(argv = process.argv.slice(2)) {
  if (argv.length && !['--no-open', '--data-dir', '--port'].includes(argv[0])) return runCli(argv)
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--no-open') options.open = false
    else if (arg === '--data-dir' && argv[index + 1]) options.dataDir = argv[++index]
    else if (arg === '--port' && argv[index + 1]) options.port = Number(argv[++index])
    else throw new Error(`Unknown launcher option: ${arg}`)
  }
  const running = await launch(options)
  process.stdout.write(`${running.url}\n`)
  if (running.reused) return 0
  let onSignal
  try { await Promise.race([running.whenClosed, new Promise(done => {
    onSignal = done; process.once('SIGINT', done); process.once('SIGTERM', done)
  })]) }
  finally {
    if (onSignal) { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal) }
    await running.close()
  }
  return 0
}

const direct = isSea() || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (direct) {
  try { process.exitCode = await runLauncher() }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
