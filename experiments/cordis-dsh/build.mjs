import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const upstream = resolve('../vendor/deepseek-harness')
const expected = '639ed015397290b3745d163aafe02ffee4aa3f84'
const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (commit !== expected) throw new Error(`Expected ${expected}, got ${commit}`)
const aliases = new Map()
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const child = join(dir, entry.name)
    try {
      const pkg = JSON.parse(await readFile(join(child, 'package.json'), 'utf8'))
      if (pkg.name?.startsWith('@deepseek-ai/')) aliases.set(pkg.name, join(child, 'src/index.ts'))
    } catch {}
    await scan(child)
  }
}
await scan(join(upstream, 'packages'))
await scan(join(upstream, 'vendor'))
const result = await build({
  entryPoints: ['bridge.ts'], outfile: 'bridge.bundle.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node26', metafile: true,
  packages: 'external',
  plugins: [{ name: 'pinned-dsh-source', setup(builder) {
    // Keep the real module URL for its relative package-manifest lookup.
    // Bundling normally moves import.meta.url to this experiment's directory.
    builder.onLoad({ filter: /[\\/]llm[\\/]src[\\/]attribution\.ts$/ }, async args => ({
      contents: (await readFile(args.path, 'utf8')).replace('import.meta.url', JSON.stringify(pathToFileURL(args.path).href)),
      loader: 'ts',
    }))
    builder.onResolve({ filter: /^@deepseek-ai\// }, args => {
      const name = args.path.split('/').slice(0, 2).join('/')
      const main = aliases.get(name)
      if (!main) throw new Error(`Unknown DSH package ${name}`)
      const suffix = args.path.slice(name.length)
      return { path: suffix ? resolve(main, '..', suffix.replace(/^\/src\//, '')) : main }
    })
  } }],
})
await writeFile('build-evidence.json', JSON.stringify({ commit, inputs: Object.keys(result.metafile.inputs), outputs: result.metafile.outputs }, null, 2) + '\n')
console.log(`Bundled ${Object.keys(result.metafile.inputs).length} real upstream source files at ${commit}`)
