import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildWebGuides, copyUserDocs, guideDir, guideHtml, guideNames, releaseInfo, rootNames } from '../scripts/release-docs.mjs'
import { verifyRelease } from '../scripts/verify-release.mjs'
import { stageNpmPackage } from '../scripts/pack-npm.mjs'
import { create as createTar } from 'tar'

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.stderr}`)
}
async function fixture(root) {
  await mkdir(join(root, guideDir), { recursive: true })
  await mkdir(join(root, 'docs/assets/0.1.0'), { recursive: true })
  await writeFile(join(root, 'docs/assets/0.1.0/workbench.jpg'), 'test image')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'ivoraige', version: '1.2.3', type: 'module',
    files: ['src/', 'dist/web/', 'dist/dsh.mjs', 'dist/DSH-LICENSE.txt', 'dist/THIRD_PARTY_LICENSES.txt',
      ...rootNames, ...guideNames.map(name => `${guideDir}/${name}`), 'docs/assets/0.1.0/workbench.jpg'] }))
  await writeFile(join(root, '.gitignore'), 'dist/\nstage/\narchive.zip\narchive.tgz\nbuild-evidence.json\n')
  await mkdir(join(root, 'src'))
  for (const name of ['app.mjs', 'cli.mjs', 'launch.mjs']) await writeFile(join(root, 'src', name), '// test fixture\n')
  await mkdir(join(root, 'scripts'))
  await writeFile(join(root, 'scripts/build.mjs'), `import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
for (const name of ['dsh.mjs', 'DSH-LICENSE.txt', 'THIRD_PARTY_LICENSES.txt'])
  await writeFile('dist/' + name, 'fixture build: ' + name + '\\n')
`)
  await writeFile(join(root, 'scripts/build-web.mjs'), `import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('dist/web', { recursive: true })
for (const name of ['index.html', 'app.js', 'app.css'])
  await writeFile('dist/web/' + name, 'fixture build: ' + name + '\\n')
`)
  for (const name of rootNames) await writeFile(join(root, name), '# Document\n\n[Guide](docs/plan/0.1.0/pdf-guide.md)\n')
  for (const name of guideNames) await writeFile(join(root, guideDir, name), `# ${name}\n\n[PDF](pdf-guide.md)\n`)
  run('git', ['init', '-q'], root)
  run('git', ['add', '.'], root)
  run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], root)
  run('git', ['tag', 'v1.2.3'], root)
}
async function archiveFixture(root) {
  const info = await buildWebGuides(root, join(root, 'dist/web'))
  const stage = join(root, 'stage')
  await mkdir(join(stage, 'app/dist'), { recursive: true })
  await copyUserDocs(root, join(stage, 'app'))
  await cp(join(root, 'dist/web'), join(stage, 'app/dist/web'), { recursive: true })
  // Placeholder files test archive validation only; they are not executable Windows evidence.
  for (const name of ['ivoraige.cmd', 'runtime/node.exe', 'runtime/NODE-LICENSE.txt',
    'app/src/launch.mjs', 'app/src/app.mjs', 'app/dist/dsh.mjs',
    'app/dist/web/index.html', 'app/dist/web/app.js', 'app/dist/web/app.css']) {
    await mkdir(join(stage, name, '..'), { recursive: true })
    await writeFile(join(stage, name), 'fixture')
  }
  await cp(join(root, 'package.json'), join(stage, 'app/package.json'))
  const archive = join(root, 'archive.zip')
  run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-a', '-c', '-f', archive, '-C', stage, '.'], root)
  const bytes = await readFile(archive)
  const evidence = { version: info.version, source: info, output: archive, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }
  const evidencePath = join(root, 'build-evidence.json')
  await writeFile(evidencePath, JSON.stringify(evidence))
  return { info, archive, evidencePath }
}

test('bundled Markdown renders guide structure and keeps heading anchors', () => {
  const info = { version: '1.2.3', sourceTree: 'unavailable', sourceCommit: null, sourceUrl: null, sourceCommitUrl: null }
  const html = guideHtml('# 安装指南\n\n## 开始前\n\n**重要**\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```powershell\nfoo\n```\n\n[Jump](#开始前)\n', info, 'installation-guide.md')
  assert.match(html, /<title>安装指南 · ivoraige<\/title>/)
  assert.match(html, /<h2 id="开始前">/)
  assert.match(html, /<strong>重要<\/strong>/)
  assert.match(html, /<table>/)
  assert.match(html, /<pre><code class="language-powershell">foo/)
  assert.match(html, /href="#开始前"/)
  assert.doesNotMatch(html, /源码 null/)
})

test('npm release validation binds actual tarball files to the clean tagged source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-npm-release-fixture-'))
  try {
    await fixture(root)
    const info = await buildWebGuides(root, join(root, 'dist/web'))
    run(process.execPath, ['scripts/build.mjs'], root)
    run(process.execPath, ['scripts/build-web.mjs'], root)
    const stage = join(root, 'stage/package')
    await stageNpmPackage(root, stage)
    const archive = join(root, 'archive.tgz'), evidencePath = join(root, 'build-evidence.json')
    const repack = async () => {
      await createTar({ file: archive, cwd: join(root, 'stage'), gzip: true }, ['package'])
      const bytes = await readFile(archive)
      await writeFile(evidencePath, JSON.stringify({ format: 'npm-tarball', version: info.version, source: info,
        output: 'archive.tgz', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }))
    }
    await repack()
    const checked = await verifyRelease(root, 'v1.2.3', evidencePath)
    assert.equal(checked.format, 'npm-tarball')
    assert.equal(checked.sourceCommit, info.sourceCommit)
    const app = join(stage, 'src/app.mjs')
    await writeFile(app, '// different application\n')
    await repack()
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /differs from release source\/build: src\/app.mjs/)
    await cp(join(root, 'src/app.mjs'), app)
    const bundle = join(stage, 'dist/web/app.js')
    await writeFile(bundle, 'tampered executable bundle\n')
    await writeFile(join(root, 'dist/web/app.js'), 'tampered executable bundle\n')
    await repack()
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /differs from release source\/build: dist\/web\/app.js/)
    await cp(join(root, 'dist/web/app.js'), bundle)
    const html = join(stage, 'dist/web/pdf-guide.html'), localHtml = join(root, 'dist/web/pdf-guide.html')
    const originalHtml = await readFile(localHtml)
    await writeFile(html, 'stale guide'); await writeFile(localHtml, 'stale guide')
    await repack()
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /Generated pdf-guide.html differs from source Markdown/)
    await writeFile(html, originalHtml); await writeFile(localHtml, originalHtml)
    await writeFile(join(stage, 'unexpected-secret.txt'), 'fixture only')
    await repack()
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /unexpected files/)
    await rm(join(stage, 'unexpected-secret.txt'))
    await rm(join(stage, 'dist/dsh.mjs'))
    await repack()
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /missing dist\/dsh.mjs/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('source archive without Git builds honest guide metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-source-archive-'))
  try {
    await fixture(root)
    await rm(join(root, '.git'), { recursive: true })
    const info = await buildWebGuides(root, join(root, 'dist/web'))
    assert.equal(info.sourceTree, 'unavailable')
    assert.equal(info.sourceCommit, null)
    assert.equal(info.sourceUrl, null)
    assert.match(await readFile(join(root, 'dist/web/pdf-guide.html'), 'utf8'), /源码来源未知/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('release validation checks tag, generated metadata and actual ZIP bytes',
  { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-release-fixture-'))
  try {
    await fixture(root)
    const { info, archive, evidencePath } = await archiveFixture(root)
    assert.equal((await verifyRelease(root, 'v1.2.3', evidencePath)).sourceCommit, info.sourceCommit)
    await assert.rejects(verifyRelease(root, 'v1.2.4', evidencePath), /differs from package version/)
    const metadataPath = join(root, 'dist/web/release-info.json')
    await writeFile(metadataPath, JSON.stringify({ ...info, version: '9.9.9' }))
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /Bundled guide metadata differs/)
    await writeFile(metadataPath, JSON.stringify(info) + '\n')
    const htmlPath = join(root, 'dist/web/pdf-guide.html')
    const originalHtml = await readFile(htmlPath)
    await writeFile(htmlPath, '<h1>stale generated guide</h1>')
    await writeFile(join(root, 'stage/app/dist/web/pdf-guide.html'), '<h1>stale generated guide</h1>')
    await rm(archive)
    run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-a', '-c', '-f', archive, '-C', join(root, 'stage'), '.'], root)
    let changed = await readFile(archive)
    await writeFile(evidencePath, JSON.stringify({ version: info.version, source: info, output: archive,
      bytes: changed.length, sha256: createHash('sha256').update(changed).digest('hex') }))
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /Generated pdf-guide.html differs from source Markdown/)
    await writeFile(htmlPath, originalHtml)
    await writeFile(join(root, 'stage/app/dist/web/pdf-guide.html'), originalHtml)
    await writeFile(archive, Buffer.concat([await readFile(archive), Buffer.from('tamper')]))
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /Artifact bytes differ/)
    await writeFile(join(root, 'stage/app/dist/web/release-info.json'), JSON.stringify({ ...info, version: '9.9.9' }))
    await rm(archive)
    run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-a', '-c', '-f', archive, '-C', join(root, 'stage'), '.'], root)
    changed = await readFile(archive)
    await writeFile(evidencePath, JSON.stringify({ version: info.version, source: info, output: archive,
      bytes: changed.length, sha256: createHash('sha256').update(changed).digest('hex') }))
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /ZIP embeds stale or incorrect source metadata/)
    await writeFile(join(root, 'stage/app/dist/web/release-info.json'), JSON.stringify(info))
    await writeFile(join(root, 'stage/app/README.md'), '# Broken\n\n[missing](no-such-guide.md)\n')
    await rm(archive)
    run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-a', '-c', '-f', archive, '-C', join(root, 'stage'), '.'], root)
    changed = await readFile(archive)
    await writeFile(evidencePath, JSON.stringify({ version: info.version, source: info, output: archive,
      bytes: changed.length, sha256: createHash('sha256').update(changed).digest('hex') }))
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /Release ZIP embeds stale README.md/)
    await writeFile(join(root, 'stage/app/README.md'), '# Document\n\n[Guide](docs/plan/0.1.0/pdf-guide.md)\n')
    await rm(join(root, 'stage/runtime/node.exe'))
    await rm(archive)
    run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-a', '-c', '-f', archive, '-C', join(root, 'stage'), '.'], root)
    changed = await readFile(archive)
    await writeFile(evidencePath, JSON.stringify({ version: info.version, source: info, output: archive,
      bytes: changed.length, sha256: createHash('sha256').update(changed).digest('hex') }))
    await assert.rejects(verifyRelease(root, 'v1.2.3', evidencePath), /Release ZIP is missing runtime\/node.exe/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
