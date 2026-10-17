import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { copyUserDocs, releaseInfo, validatePackagedLinks } from './release-docs.mjs'

export async function stageNpmPackage(root, stage) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await mkdir(stage, { recursive: true })
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const generatedDocs = new Set(['README.md', 'README.zh-CN.md', 'THIRD_PARTY.md', 'CONTRIBUTING.md', 'SECURITY.md'])
  for (const file of manifest.files) {
    if (generatedDocs.has(file) || file.startsWith('docs/plan/0.1.0/') || file === 'docs/assets/0.1.0/workbench.jpg') continue
    const source = join(root, file)
    const destination = join(stage, file)
    await mkdir(resolve(destination, '..'), { recursive: true })
    await cp(source, destination, { recursive: true })
  }
  await copyUserDocs(root, stage)
  await validatePackagedLinks(stage)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, '..')
  const destination = resolve(process.argv[2] ?? root)
  await mkdir(destination, { recursive: true })
  const temp = await mkdtemp(join(tmpdir(), 'ivoraige-npm-stage-'))
  try {
    const stage = join(temp, 'package')
    await stageNpmPackage(root, stage)
    const npmCli = process.env.npm_execpath
    if (!npmCli) throw new Error('Run with npm run pack:npm')
    const result = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination],
      { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr}`)
    const parsed = JSON.parse(result.stdout)
    const packages = Array.isArray(parsed) ? parsed : Object.values(parsed)
    if (packages.length !== 1) throw new Error('Expected one npm package')
    const pkg = packages[0]
    const bytes = await readFile(join(destination, pkg.filename))
    const evidence = { format: 'npm-tarball', version: pkg.version, source: await releaseInfo(root),
      output: pkg.filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      files: pkg.entryCount }
    const evidencePath = join(destination, pkg.filename.replace(/\.tgz$/, '.build-evidence.json'))
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2))
  } finally { await rm(temp, { recursive: true, force: true }) }
}
