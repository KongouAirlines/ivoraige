import { spawn } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDataDirectory } from './data-directory.mjs'
import { KernelError } from './errors.mjs'
import { isSea } from 'node:sea'
import { startHost } from './app.mjs'
import { serve } from './http.mjs'
import { runCli } from './cli.mjs'

export function openBrowser(url) {
  // Only a locally generated loopback URL reaches the platform opener.
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => process.stderr.write('Could not open the browser. Run ivoraige again to open a newly paired workbench.\n'))
  child.unref()
}

export async function launch({ dataDir = defaultDataDirectory(), open = true, port = 0,
  appRoot = process.env.IVORAIGE_APP_ROOT ?? (isSea() ? dirname(process.execPath) : resolve(import.meta.dirname, '..')),
  components = {}, opener = openBrowser, registryRoot } = {}) {
  await mkdir(dataDir, { recursive: true })
  dataDir = await realpath(dataDir)
  const app = await startHost({ store: join(dataDir, 'store.sqlite'), settingsDir: join(dataDir, 'settings'),
    components: { directory: join(dataDir, 'components'), ...components }, registryRoot })
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
      // The one-time credential is delivered only to the local browser fragment.
      // It is never returned as the server URL, printed or saved in discovery.
      opener(`${url}/#owner=${encodeURIComponent(bootstrap.credential)}`)
    }
    return { app: app.reused ? undefined : app, url, reused: app.reused, dataDir,
      generation: app.generation, dataDomainRef: app.dataDomainRef,
      whenClosed: app.host?.whenClosed, close: () => app.dispose() }
  } catch (error) {
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
