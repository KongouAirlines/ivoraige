import { spawn } from 'node:child_process'

const liveServers = new Set()

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise(resolveExit => {
    const onExit = () => { clearTimeout(timer); resolveExit(true) }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit(hasExited(child))
    }, timeoutMs)
    child.once('exit', onExit)
    if (hasExited(child)) onExit()
  })
}

export async function stopServer(child, stopTimeoutMs = 5_000) {
  if (hasExited(child) || child.pid === undefined) return
  child.kill('SIGTERM')
  if (await waitForExit(child, stopTimeoutMs)) return
  child.kill('SIGKILL')
  if (await waitForExit(child, stopTimeoutMs)) return
  throw new Error(`Packaged CLI serve did not exit after SIGKILL (pid ${child.pid})`)
}

export async function stopLiveServers() {
  // If cleanup fails, the caller must not remove files still used by a server.
  for (const child of liveServers) await stopServer(child)
}

export async function startServer(cli, cwd, store, settingsDir, startupTimeoutMs = 20_000) {
  const child = spawn(process.execPath,
    [cli, 'serve', '--store', store, '--settings-dir', settingsDir, '--port', '0'],
    { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  liveServers.add(child)
  child.once('exit', () => liveServers.delete(child))
  child.once('error', () => { if (child.pid === undefined) liveServers.delete(child) })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  // Keep an error listener for the entire child lifetime, including shutdown.
  let childError
  child.on('error', error => { childError = error })
  try {
    const url = await new Promise((resolveUrl, rejectUrl) => {
      const onError = error => finish(error)
      const onExit = (code, signal) => finish(new Error(`Packaged CLI serve exited ${code ?? signal}: ${stderr}`))
      const onData = () => {
        const match = /https?:\/\/[^\s]+/.exec(stdout)
        if (match) finish(null, match[0])
      }
      const timer = setTimeout(() => finish(new Error(`Packaged CLI serve timed out: ${stderr}`)), startupTimeoutMs)
      function finish(error, value) {
        clearTimeout(timer)
        child.off('error', onError)
        child.off('exit', onExit)
        child.stdout.off('data', onData)
        if (error) rejectUrl(error)
        else resolveUrl(value)
      }
      child.on('error', onError)
      child.on('exit', onExit)
      child.stdout.on('data', onData)
      onData()
    })
    if (childError || hasExited(child)) throw childError ?? new Error(`Packaged CLI serve exited during startup: ${stderr}`)
    return { url, close: (stopTimeoutMs) => stopServer(child, stopTimeoutMs) }
  } catch (error) {
    try { await stopServer(child) }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Packaged CLI serve failed and could not be stopped') }
    throw error
  }
}
