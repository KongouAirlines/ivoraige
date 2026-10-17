import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, posix, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { list as listTar } from 'tar'
import { guideDir, guideNames, guideHtml, portableLinks, releaseInfo, rootNames } from './release-docs.mjs'
import { stageNpmPackage } from './pack-npm.mjs'

async function verifyNpmArchive(root, info, archive) {
  const files = new Map(), names = new Set()
  let invalid
  await listTar({ file: archive, strict: true, onReadEntry(entry) {
    const name = entry.path.replaceAll('\\', '/')
    const normalized = posix.normalize(name).replace(/\/$/, '')
    if (name !== normalized && name !== `${normalized}/` || name.split('/').includes('..') ||
      (normalized !== 'package' && !normalized.startsWith('package/')) || names.has(normalized)) {
      invalid ??= new Error(`Unsafe or duplicate npm archive member: ${name}`)
      return
    }
    names.add(normalized)
    if (entry.type === 'Directory') return
    if (entry.type !== 'File' || entry.size > 32 * 1024 * 1024) {
      invalid ??= new Error(`Unsupported npm archive member: ${name}`)
      return
    }
    const chunks = []
    entry.on('data', chunk => chunks.push(chunk))
    entry.on('end', () => files.set(normalized.slice('package/'.length), Buffer.concat(chunks)))
  } })
  if (invalid) throw invalid
  for (const required of ['package.json', 'src/app.mjs', 'src/cli.mjs', 'src/launch.mjs',
    'dist/dsh.mjs', 'dist/DSH-LICENSE.txt', 'dist/THIRD_PARTY_LICENSES.txt',
    'dist/web/index.html', 'dist/web/app.js', 'dist/web/app.css', 'dist/web/release-info.json']) {
    if (!files.has(required)) throw new Error(`Npm tarball is missing ${required}`)
  }
  const work = await mkdtemp(join(tmpdir(), 'ivoraige-release-npm-'))
  try {
    // dist is ignored by Git. Rebuild it from the checked tag before comparing
    // package bytes, so a modified local bundle cannot certify itself.
    for (const script of ['build.mjs', 'build-web.mjs']) {
      execFileSync(process.execPath, [join(root, 'scripts', script)], { cwd: root, stdio: 'pipe' })
    }
    await stageNpmPackage(root, work)
    async function compare(directory, prefix = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`
        if (entry.isDirectory()) { await compare(join(directory, entry.name), `${name}/`); continue }
        if (!entry.isFile()) throw new Error(`Unsupported staged npm file: ${name}`)
        const packaged = files.get(name)
        if (!packaged) throw new Error(`Npm tarball is missing ${name}`)
        const expected = await readFile(join(directory, entry.name))
        if (!packaged.equals(expected)) throw new Error(`Npm tarball differs from release source/build: ${name}`)
        files.delete(name)
      }
    }
    await compare(work)
    if (files.size) throw new Error(`Npm tarball includes unexpected files: ${[...files.keys()].join(', ')}`)
    // Re-render from committed Markdown instead of trusting an ignored dist directory.
    for (const name of guideNames) {
      const html = name.replace(/\.md$/, '.html')
      const expected = guideHtml(await readFile(join(root, guideDir, name), 'utf8'), info, name)
      if (await readFile(join(root, 'dist/web', html), 'utf8') !== expected)
        throw new Error(`Generated ${html} differs from source Markdown`)
    }
  } finally { await rm(work, { recursive: true, force: true }) }
}

function archiveCommand(args) {
  const command = process.platform === 'win32' ? 'tar.exe' : 'tar'
  const result = spawnSync(command, args, { encoding: args.includes('-tf') ? 'utf8' : null, maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Cannot inspect release ZIP: ${result.stderr?.toString() ?? ''}`)
  return result.stdout
}
function archiveMembers(archive) {
  const names = new Map()
  for (const original of archiveCommand(['-tf', archive]).trim().split(/\r?\n/)) {
    const unix = original.replaceAll('\\', '/')
    if (unix.startsWith('/') || /^[A-Za-z]:\//.test(unix) || unix.split('/').includes('..'))
      throw new Error(`Unsafe archive member: ${original}`)
    const normalized = posix.normalize(unix).replace(/^\.\//, '').replace(/\/$/, '')
    if (!normalized || normalized === '.') continue
    if (names.has(normalized)) throw new Error(`Duplicate archive member: ${normalized}`)
    names.set(normalized, original)
  }
  return names
}
function archived(archive, names, path) {
  const member = names.get(path)
  if (!member) throw new Error(`Release ZIP is missing ${path}`)
  return archiveCommand(['-xOf', archive, member])
}
async function checkArchiveDocs(root, info, archive, names) {
  const docs = [...rootNames, ...guideNames.map(name => `${guideDir}/${name}`)]
  for (const name of docs) {
    const content = archived(archive, names, `app/${name}`).toString('utf8')
    const expected = portableLinks(await readFile(join(root, name), 'utf8'), name, info)
    if (content !== expected) throw new Error(`Release ZIP embeds stale ${name}`)
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].split('#')[0]
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue
      const target = posix.normalize(posix.join('app', posix.dirname(name), decodeURIComponent(href)))
      if (!target.startsWith('app/') || !names.has(target)) throw new Error(`Broken ZIP documentation link: ${name} -> ${href}`)
    }
  }
}

export async function verifyRelease(root, tag, evidencePath) {
  if (!tag || !evidencePath) throw new Error('Usage: verifyRelease(root, v<package-version>, build-evidence.json)')
  const info = await releaseInfo(root)
  if (info.sourceTree !== 'clean') throw new Error(`Release source provenance must be a clean Git checkout; found ${info.sourceTree}`)
  if (tag !== `v${info.version}`) throw new Error(`Release tag ${tag} differs from package version ${info.version}`)
  const tagCommit = execFileSync('git', ['rev-list', '-n', '1', `refs/tags/${tag}`], { cwd: root, encoding: 'utf8' }).trim()
  if (tagCommit !== info.sourceCommit) throw new Error(`Tag ${tag} points to ${tagCommit}, but source is ${info.sourceCommit}`)
  const metadata = JSON.parse(await readFile(join(root, 'dist/web/release-info.json'), 'utf8'))
  if (JSON.stringify(metadata) !== JSON.stringify(info)) throw new Error('Bundled guide metadata differs from release source; rebuild on tagged clean commit')
  const evidence = JSON.parse(await readFile(resolve(evidencePath), 'utf8'))
  if (evidence.version !== info.version || JSON.stringify(evidence.source) !== JSON.stringify(info))
    throw new Error('Artifact build evidence differs from release source/version')
  const archive = resolve(dirname(resolve(evidencePath)), evidence.output)
  const bytes = await readFile(archive)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if ((await stat(archive)).size !== evidence.bytes || sha256 !== evidence.sha256) throw new Error('Artifact bytes differ from build evidence')
  const result = { tag, version: info.version, sourceCommit: info.sourceCommit, sourceUrl: info.sourceUrl,
    artifact: archive, bytes: evidence.bytes, sha256 }
  if (evidence.format === 'npm-tarball') {
    if (!bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) throw new Error('Artifact is not a gzip npm tarball')
    await verifyNpmArchive(root, info, archive)
    return { ...result, format: 'npm-tarball' }
  }
  if (evidence.format && evidence.format !== 'portable-folder-zip') throw new Error(`Unsupported release format: ${evidence.format}`)
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('ZIP release verification requires Windows or macOS bsdtar')
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Artifact is not a ZIP archive')
  const names = archiveMembers(archive)
  for (const required of ['ivoraige.cmd', 'runtime/node.exe', 'runtime/NODE-LICENSE.txt',
    'app/package.json', 'app/src/launch.mjs', 'app/src/app.mjs', 'app/dist/dsh.mjs',
    'app/dist/web/index.html', 'app/dist/web/app.js', 'app/dist/web/app.css']) {
    const member = names.get(required)
    if (!member || member.endsWith('/')) throw new Error(`Release ZIP is missing ${required}`)
  }
  const appManifest = JSON.parse(archived(archive, names, 'app/package.json').toString('utf8'))
  if (appManifest.version !== info.version) throw new Error('Release ZIP app package version differs from source')
  const embedded = JSON.parse(archived(archive, names, 'app/dist/web/release-info.json').toString('utf8'))
  if (JSON.stringify(embedded) !== JSON.stringify(info)) throw new Error('Release ZIP embeds stale or incorrect source metadata')
  for (const name of guideNames) {
    const html = name.replace(/\.md$/, '.html')
    const packaged = archived(archive, names, `app/dist/web/${html}`)
    const source = await readFile(join(root, guideDir, name), 'utf8')
    const expected = Buffer.from(guideHtml(source, info, name))
    const local = await readFile(join(root, 'dist/web', html))
    if (!local.equals(expected)) throw new Error(`Generated ${html} differs from source Markdown`)
    if (!packaged.equals(expected)) throw new Error(`Release ZIP embeds stale ${html}`)
  }
  await checkArchiveDocs(root, info, archive, names)
  if (!archived(archive, names, 'app/docs/assets/0.1.0/workbench.jpg')
    .equals(await readFile(join(root, 'docs/assets/0.1.0/workbench.jpg'))))
    throw new Error('Release ZIP embeds stale workbench screenshot')
  return { ...result, format: 'portable-folder-zip' }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [tag, evidencePath] = process.argv.slice(2)
  const result = await verifyRelease(resolve(import.meta.dirname, '..'), tag, evidencePath)
  console.log(JSON.stringify(result, null, 2))
}
