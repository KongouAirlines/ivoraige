import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDataDirectory } from './data-directory.mjs'
import { KernelError } from './errors.mjs'
export { defaultDataDirectory } from './data-directory.mjs'
import { isSea } from 'node:sea'
import { createApp } from './app.mjs'
import { serve } from './http.mjs'
import { runCli } from './cli.mjs'

export function openBrowser(url) {
  // Only a locally generated loopback URL reaches the platform opener.
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => process.stderr.write(`Open the workbench in your browser: ${url}\n`))
  child.unref()
}

async function existingInstance(path, timeout = 1500) {
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'))
    const url = new URL(saved.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return
    const response = await fetch(new URL('/api/instance', url), { signal: AbortSignal.timeout(timeout) })
    if (response.ok && (await response.json()).id === saved.id) return saved.url
  } catch { /* A stale instance record is replaced after acquiring the store lock. */ }
}

export async function launch({ dataDir = defaultDataDirectory(), open = true, port = 0,
  appRoot = process.env.IVORAIGE_APP_ROOT ?? (isSea() ? dirname(process.execPath) : resolve(import.meta.dirname, '..')),
  components = {}, opener = openBrowser } = {}) {
  await mkdir(dataDir, { recursive: true })
  dataDir = await realpath(dataDir)
  const instancePath = join(dataDir, 'instance.json')
  const reused = await existingInstance(instancePath)
  if (reused) {
    if (open) opener(reused)
    return { url: reused, reused: true, close: async () => {} }
  }
  let app, server
  const id = randomUUID()
  try {
    app = await createApp({ store: join(dataDir, 'store.sqlite'), settingsDir: join(dataDir, 'settings'),
      components: { directory: join(dataDir, 'components'), ...components } })
    server = await serve(app, { port, staticDir: join(appRoot, 'dist', 'web'), instance: { id } })
    await writeFile(instancePath, JSON.stringify({ id, url: server.url }) + '\n')
    if (open) opener(server.url)
    let closing
    return { app, url: server.url, reused: false, dataDir, close() {
      return closing ??= (async () => {
        try { await server.close() } finally {
          try { await rm(instancePath, { force: true }) } finally { await app.dispose() }
        }
      })()
    } }
  } catch (error) {
    await server?.close()
    await app?.dispose()
    if (error.code === 'CONFLICT') {
      // A second launch may race the first between store lock and HTTP startup.
      const deadline = performance.now() + 10_000
      while (performance.now() < deadline) {
        await new Promise(done => setTimeout(done, Math.min(200, deadline - performance.now())))
        const remaining = Math.ceil(deadline - performance.now())
        if (remaining <= 0) break
        const url = await existingInstance(instancePath, Math.min(1500, remaining))
        if (url) { if (open) opener(url); return { url, reused: true, close: async () => {} } }
      }
      throw new KernelError('CONFLICT', '已有实例正在启动或占用数据目录，请稍后重试。', {}, { cause: error })
    }
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
  try { await new Promise(done => { process.once('SIGINT', done); process.once('SIGTERM', done) }) }
  finally { await running.close() }
  return 0
}

const direct = isSea() || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (direct) {
  try { process.exitCode = await runLauncher() }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
