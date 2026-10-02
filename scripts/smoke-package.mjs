import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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

try {
  const packResult = JSON.parse(run(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', work], root))
  const packed = Array.isArray(packResult) ? packResult : Object.values(packResult)
  if (packed.length !== 1) throw new Error(`Expected one package tarball; got ${packed.length}`)
  const files = new Set(packed[0].files.map(file => file.path.replaceAll('\\', '/')))
  const required = ['src/app.mjs', 'dist/dsh.mjs', 'dist/DSH-LICENSE.txt', 'dist/THIRD_PARTY_LICENSES.txt']
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
  console.log(`Package smoke passed: ${packed[0].filename}; ${files.size} files; isolated parsing, SQLite restart and JSON export`)
} finally {
  const resolvedWork = resolve(work)
  if (!resolvedWork.startsWith(`${tempRoot}${sep}`) || !resolvedWork.split(sep).at(-1).startsWith('ivoraige-package-smoke-')) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolvedWork}`)
  }
  await rm(resolvedWork, { recursive: true, force: true })
}
