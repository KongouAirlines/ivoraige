import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = resolve(tmpdir())
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this check with npm run smoke:package')
const work = await mkdtemp(join(tempRoot, 'ivoraige-package-smoke-'))

function run(command, args, cwd) {
  const env = { ...process.env }
  // npm run forwards npm 12's allow-scripts flag; a nested project install
  // rejects that flag. This smoke explicitly disables all lifecycle scripts.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key]
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

async function startServer(cli, cwd, store, settingsDir) {
  const child = spawn(process.execPath,
    [cli, 'serve', '--store', store, '--settings-dir', settingsDir, '--port', '0'],
    { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const url = await new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error(`Packaged CLI serve timed out: ${stderr}`)), 20_000)
    const fail = error => { clearTimeout(timer); rejectUrl(error) }
    child.once('error', fail)
    child.once('exit', code => fail(new Error(`Packaged CLI serve exited ${code}: ${stderr}`)))
    const onData = () => {
      const match = /https?:\/\/[^\s]+/.exec(stdout)
      if (!match) return
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolveUrl(match[0])
    }
    child.stdout.on('data', onData)
    onData()
  })
  return { url, async close() {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await new Promise((resolveExit, rejectExit) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); rejectExit(new Error(`CLI serve did not stop: ${stderr}`)) }, 10_000)
      child.once('exit', () => { clearTimeout(timer); resolveExit() })
    })
  } }
}

async function api(base, method, path, body) {
  const response = await fetch(new URL(path, base), { method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(result)}`)
  assert.equal(result.apiVersion, '2.0')
  return result
}

async function waitTask(base, taskId) {
  for (let i = 0; i < 100; i++) {
    const { task } = await api(base, 'GET', `/api/tasks/${taskId}`)
    if (task.state === 'succeeded') return task
    if (['failed', 'canceled', 'paused'].includes(task.state))
      throw new Error(`Packaged task ${taskId} ended ${task.state}: ${JSON.stringify(task.error)}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Packaged task ${taskId} did not finish`)
}

try {
  const packResult = JSON.parse(run(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', work], root))
  const packed = Array.isArray(packResult) ? packResult : Object.values(packResult)
  if (packed.length !== 1) throw new Error(`Expected one package tarball; got ${packed.length}`)
  const files = new Set(packed[0].files.map(file => file.path.replaceAll('\\', '/')))
  const required = ['src/app.mjs', 'src/cli.mjs', 'src/http.mjs', 'dist/dsh.mjs',
    'dist/web/index.html', 'dist/web/app.js', 'dist/web/app.css',
    'dist/DSH-LICENSE.txt', 'dist/THIRD_PARTY_LICENSES.txt']
  for (const path of required) {
    if (!files.has(path)) throw new Error(`Package is missing required file: ${path}`)
  }
  for (const path of files) {
    if (/^(?:experiments|vendor|evaluation\/private|evaluation\/runs)(?:\/|$)/.test(path)) {
      throw new Error(`Package unexpectedly includes excluded path: ${path}`)
    }
    if (/(?:^|\/)\.env(?:\..*)?$/.test(path)) {
      throw new Error(`Package unexpectedly includes an environment file: ${path}`)
    }
  }

  const tarball = join(work, packed[0].filename)
  await writeFile(join(work, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  run(process.execPath, [npmCli, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', tarball], work)
  const probe = join(work, 'installed-package-smoke.mjs')
  await writeFile(probe, `
    import assert from 'node:assert/strict'
    import { readFile } from 'node:fs/promises'
    import { createApp } from ${JSON.stringify(packed[0].name)}
    const app = await createApp()
    try {
      if (!app.parse || !app.outputs || typeof app.dispose !== 'function') {
        throw new Error('Installed package createApp() did not expose the expected parse/output services')
      }
      const parsed = await app.parse.parse({ format: 'txt', content: 'First paragraph.\\n\\nSecond paragraph.' })
      if (parsed.units.length !== 2) throw new Error('Installed TXT parser failed')
    } finally {
      await app.dispose()
    }
    const persistent = await createApp({ store: './smoke.sqlite', exportDir: './outputs' })
    let docId
    try {
      const { document } = await persistent.records.importDocument({ format: 'txt', content: 'Package test.' },
        { sourceId: 'package:smoke', language: 'en' })
      docId = document.id
      const [unit] = persistent.records.listUnits(docId, { targetLang: 'zh' })
      const revision = await persistent.records.writeRevision(unit.id,
        { targetLang: 'zh', text: '安装包测试。', origin: 'imported', baseRevisionId: null })
      await persistent.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
      const { artifacts } = await persistent.exporter.exportDocument(docId,
        { targetLang: 'zh', outputs: [{ format: 'json' }] })
      assert.equal(JSON.parse(await readFile(artifacts[0].path, 'utf8')).units[0].text, '安装包测试。')
    } finally { await persistent.dispose() }
    const reopened = await createApp({ store: './smoke.sqlite' })
    try { assert.equal(reopened.records.getDocument(docId).sourceId, 'package:smoke') }
    finally { await reopened.dispose() }
  `)
  run(process.execPath, [probe], work)
  const cli = join(work, 'node_modules', packed[0].name, 'src', 'cli.mjs')
  assert.match(run(process.execPath, [cli, 'help'], work), /Commands: import, documents/)
  const store = join(work, 'http.sqlite')
  const settingsDir = join(work, 'settings')
  let server = await startServer(cli, work, store, settingsDir)
  let docId
  try {
    for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/app.css', 'text/css']]) {
      const response = await fetch(new URL(path, server.url))
      assert.equal(response.status, 200, `Packaged UI ${path}`)
      assert.match(response.headers.get('content-type'), new RegExp(type))
      assert.ok((await response.text()).length > 20)
    }
    const before = await api(server.url, 'GET', '/api/settings/modelconfig')
    assert.equal(before.settings.selected, null)
    const configured = await api(server.url, 'PATCH', '/api/settings/modelconfig', {
      provider: 'smoke', model: 'scientific', api: 'openai-completions',
      baseURL: 'http://127.0.0.1:9999/v1', credentialRef: 'IVORAIGE_SMOKE_KEY',
      contextWindow: 8192, maxTokens: 512,
    })
    assert.equal(configured.settings.selected.provider, 'smoke')
    const credential = await api(server.url, 'PUT', '/api/settings/credentials',
      { ref: 'IVORAIGE_SMOKE_KEY', value: 'smoke-fake-token' })
    assert.doesNotMatch(JSON.stringify(credential), /smoke-fake-token/)
    assert.equal((await api(server.url, 'GET', '/api/settings/modelconfig')).settings.credentials.smoke.configured, true)
    const imported = await api(server.url, 'POST', '/api/documents/import', {
      contentBase64: Buffer.from('# Findings\n\nThe sample is stable.').toString('base64'),
      format: 'md', language: 'en', sourceId: 'package:markdown', origin: 'cli',
    })
    docId = imported.document.id
    await waitTask(server.url, imported.taskId)
    const { items: units } = await api(server.url, 'GET',
      `/api/documents/${docId}/units?targetLang=zh-CN`)
    assert.ok(units.length >= 2)
    for (const unit of units.filter(item => item.translatable)) {
      const { revision } = await api(server.url, 'PATCH', `/api/units/${unit.id}`, {
        targetLang: 'zh-CN', baseRevisionId: null, text: `译文 ${unit.sourceText}`,
      })
      await api(server.url, 'POST', `/api/revisions/${revision.id}/accept`,
        { expectedAcceptedRevisionId: null })
    }
    const exported = await api(server.url, 'POST', `/api/documents/${docId}/export`, {
      targetLang: 'zh-CN', outputs: [{ format: 'md' }, { format: 'json' }],
    })
    const task = await waitTask(server.url, exported.taskId)
    assert.equal(task.artifacts.length, 2)
    assert.ok(task.artifacts.every(item => item.snapshotId === exported.snapshotId))
    const markdown = task.artifacts.find(item => item.format === 'md')
    const download = await fetch(new URL(`/api/artifacts/${markdown.id}/download`, server.url))
    assert.equal(download.status, 200)
    assert.match(await download.text(), /译文/)
  } finally { await server.close() }
  server = await startServer(cli, work, store, settingsDir)
  try {
    const settings = await api(server.url, 'GET', '/api/settings/modelconfig')
    assert.equal(settings.settings.selected.provider, 'smoke')
    assert.equal(settings.settings.credentials.smoke.configured, true)
    const { document } = await api(server.url, 'GET', `/api/documents/${docId}`)
    assert.equal(document.sourceId, 'package:markdown')
    const { items: artifacts } = await api(server.url, 'GET', `/api/documents/${docId}/artifacts`)
    assert.equal(artifacts.length, 2)
  } finally { await server.close() }
  console.log(`Package smoke passed: ${packed[0].filename}; ${files.size} files; isolated parsing, SQLite restart, CLI/HTTP settings, Markdown export and static UI`)
} finally {
  const resolvedWork = resolve(work)
  if (!resolvedWork.startsWith(`${tempRoot}${sep}`) || !resolvedWork.split(sep).at(-1).startsWith('ivoraige-package-smoke-')) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolvedWork}`)
  }
  await rm(resolvedWork, { recursive: true, force: true })
}
