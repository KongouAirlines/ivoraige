import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { root, upstream, DSH_COMMIT, verifySource } from './setup-dsh.mjs'

if (!existsSync(upstream)) throw new Error('DSH source missing. Run npm run setup:dsh first.')
verifySource()
const dependencies = join(root, 'node_modules')
if (!existsSync(join(dependencies, 'esbuild/package.json'))) {
  throw new Error('Project dependencies missing. Run npm ci at the repository root first.')
}
const require = createRequire(join(dependencies, '..', 'package.json'))
const { build } = require('esbuild')
const aliases = new Map()
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const child = join(dir, entry.name)
    try {
      const pkg = JSON.parse(await readFile(join(child, 'package.json'), 'utf8'))
      if (pkg.name?.startsWith('@deepseek-ai/')) aliases.set(pkg.name, join(child, 'src/index.ts'))
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await scan(child)
  }
}
await scan(join(upstream, 'packages'))
await scan(join(upstream, 'vendor'))
await mkdir(join(root, 'dist'), { recursive: true })
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/dsh-bridge.ts'], outfile: 'dist/dsh.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', metafile: true,
  nodePaths: [dependencies],
  banner: { js: 'import { createRequire as __ivoraigeCreateRequire } from "node:module"; const require = __ivoraigeCreateRequire(import.meta.url);' },
  plugins: [{ name: 'pinned-dsh-source', setup(builder) {
    builder.onLoad({ filter: /[\\/]llm[\\/]src[\\/]attribution\.ts$/ }, async args => {
      // Embed its package version so the generated bundle does not depend on
      // the original source path or read this project's package manifest.
      const pkg = JSON.parse(await readFile(resolve(dirname(args.path), '../package.json'), 'utf8'))
      const contents = (await readFile(args.path, 'utf8')).replace(
        /const \{ version \} = createRequire\(import\.meta\.url\)\('\.\.\/package\.json'\) as \{ version: string \}/,
        `const version = ${JSON.stringify(pkg.version)}`,
      )
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onResolve({ filter: /^@deepseek-ai\// }, args => {
      const name = args.path.split('/').slice(0, 2).join('/')
      const main = aliases.get(name)
      if (!main) throw new Error(`Unknown DSH package ${name}`)
      const suffix = args.path.slice(name.length)
      return { path: suffix ? resolve(dirname(main), suffix.replace(/^\/src\//, '')) : main }
    })
  } }],
})
await copyFile(join(upstream, 'LICENSE'), join(root, 'dist/DSH-LICENSE.txt'))
// Keep the actual licenses of every bundled dependency with the output.
const licenseRoots = new Set([upstream])
for (const input of Object.keys(result.metafile.inputs)) {
  const normalized = input.replaceAll('\\', '/')
  const npmRoot = normalized.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/)?.[1]
  const vendorRoot = normalized.match(/^(.*\/vendor\/(?:cordis|cosmokit|schemastery))(?:\/|$)/)?.[1]
  if (npmRoot || vendorRoot) licenseRoots.add(resolve(root, npmRoot ?? vendorRoot))
}
const licenseSections = []
const pinnedLicenseFallbacks = new Map([
  ['@earendil-works/pi-ai@0.87.1', 'pi-MIT.txt'],
  ['@earendil-works/pi-ai@1.1.0', 'pi-MIT.txt'],
  ['standardwebhooks@1.1.1', 'standardwebhooks-MIT.txt'],
])
for (const directory of [...licenseRoots].sort()) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const names = (await readdir(directory)).filter(name => /^(license|licence|copying|notice)(?:\.|$)/i.test(name))
  const texts = await Promise.all(names.map(name => readFile(join(directory, name), 'utf8')))
  if (!texts.some(value => value.trim())) {
    const key = `${pkg.name}@${pkg.version}`
    if (key === 'data-uri-to-buffer@4.0.1') {
      const readme = await readFile(join(directory, 'README.md'), 'utf8')
      const start = readme.indexOf('\nLicense\n-------\n')
      if (start < 0) throw new Error(`Bundled dependency ${key} has no identifiable README license`)
      const remainder = readme.slice(start + '\nLicense\n-------\n'.length)
      const notice = remainder.split(/\n\[[^\]]+\]:/)[0].trim()
      if (!/copyright/i.test(notice) || !/permission is hereby granted/i.test(notice)) {
        throw new Error(`Bundled dependency ${key} has no complete README license`)
      }
      texts.push(notice)
    } else if (pinnedLicenseFallbacks.has(key)) {
      texts.push(await readFile(join(root, 'scripts/licenses/0.1.0', pinnedLicenseFallbacks.get(key)), 'utf8'))
    }
  }
  if (!texts.some(value => value.trim())) {
    throw new Error(`Bundled dependency ${pkg.name}@${pkg.version} lacks a verified license notice`)
  }
  licenseSections.push(`${pkg.name} ${pkg.version} (${pkg.license ?? 'see notice'})\n${texts.join('\n').trim()}`)
}
await writeFile(join(root, 'dist/THIRD_PARTY_LICENSES.txt'), licenseSections.join('\n\n====================\n\n') + '\n')
await writeFile(join(root, 'dist/build-evidence.json'), JSON.stringify({ dshCommit: DSH_COMMIT, inputs: Object.keys(result.metafile.inputs) }, null, 2) + '\n')
console.log(`Built dist/dsh.mjs from ${Object.keys(result.metafile.inputs).length} source files (${DSH_COMMIT})`)
