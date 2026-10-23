// Shared fixed-source RC11 candidate resolver for the server and browser builds.
// Direct invocation builds a separate diagnostic bundle without editing DSH.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, upstream, verifySource } from '../../setup-dsh.mjs'

const candidate = resolve(root, 'experiments/vendor/cordis-rc11')
const candidateCommit = '0b96d9fd517b998e44e2209560c9e5f0671ce933'
const candidateUrl = 'https://github.com/cordiverse/cordis.git'
if (!existsSync(candidate)) {
  execFileSync('git', ['clone', '--filter=blob:none', candidateUrl, candidate], { stdio: 'inherit' })
  execFileSync('git', ['-C', candidate, 'checkout', '--detach', candidateCommit], { stdio: 'inherit' })
}
const actual = execFileSync('git', ['-C', candidate, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== candidateCommit) throw new Error(`Cordis checkout must be ${candidateCommit}; found ${actual}`)
const dirty = execFileSync('git', ['-C', candidate, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
if (dirty) throw new Error('Cordis checkout must be clean')
verifySource()

const require = createRequire(join(root, 'package.json'))
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

const replacements = new Map([
  ['@deepseek-ai/cordis', 'core'],
  ['@deepseek-ai/cordis-plugin-loader', 'loader'],
])
for (const [name, dir] of replacements) aliases.set(name, join(candidate, 'packages', dir, 'src/index.ts'))
const upstreamNames = new Map([
  ['cordis', '@deepseek-ai/cordis'],
  ['cosmokit', '@deepseek-ai/cosmokit'],
  ['schemastery', '@deepseek-ai/schemastery'],
  ['@cordisjs/plugin-loader', '@deepseek-ai/cordis-plugin-loader'],
  ['@cordisjs/plugin-include', '@deepseek-ai/cordis-plugin-include'],
  ['@cordisjs/plugin-hmr', '@deepseek-ai/cordis-plugin-hmr'],
  ['@cordisjs/plugin-timer', '@deepseek-ai/cordis-plugin-timer'],
  ['@cordisjs/plugin-group', '@deepseek-ai/cordis-plugin-group'],
])
function replaceOnce(source, before, after, id) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error(`RC11 patch ${id} does not match exactly once`)
  }
  return source.replace(before, after)
}
export const candidateBuildOptions = {
  absWorkingDir: root,
  entryPoints: ['src/dsh-bridge.ts'],
  outfile: 'dist/dsh-rc11-probe.mjs',
  bundle: true,
  platform: 'node', format: 'esm', target: 'node24', metafile: true,
  nodePaths: [join(root, 'node_modules')],
  banner: { js: 'import { createRequire as __ivoraigeCreateRequire } from "node:module"; const require = __ivoraigeCreateRequire(import.meta.url);' },
  plugins: [{ name: 'cordis-rc11-probe', setup(builder) {
    builder.onLoad({ filter: /[\\/]cordis-rc11[\\/]packages[\\/]core[\\/]src[\\/](?:fiber|reflect)\.ts$/ }, async args => {
      let contents = await readFile(args.path, 'utf8')
      if (args.path.endsWith('fiber.ts')) {
        contents = replaceOnce(contents,
          '          while (this.inertia) {\n            await this.inertia\n          }',
          '          while (this.inertia) {\n            await this.inertia\n          }\n          this._updateState(() => {})',
          'cordis-133-disposed-state')
      } else {
        contents = replaceOnce(contents,
          '          let fiber = defSite.fiber\n          while (true) {\n            let impl = fiber.committed?.[prop]',
          '          let fiber = defSite.fiber\n          let table = defSite[symbols.isolate]\n          while (true) {\n            let impl: Impl | undefined',
          'cordis-209-isolation-start')
        contents = replaceOnce(contents,
          '            if (impl) return getTraceable(ctx, impl.value)\n            if (prop in fiber.inject)',
          '            if (impl) return getTraceable(ctx, impl.value)\n            while (table !== fiber.ctx[symbols.isolate]) {\n              if (!table || Object.hasOwn(table, prop)) throw error\n              table = Object.getPrototypeOf(table)\n            }\n            impl = fiber.committed?.[prop]\n            if (impl) return getTraceable(ctx, impl.value)\n            if (prop in fiber.inject)',
          'cordis-209-isolation-boundary')
      }
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onLoad({ filter: /[\\/]deepseek-harness[\\/]packages[\\/]boot[\\/]config-editor[\\/]src[\\/]index\.ts$/ }, async args => {
      let contents = await readFile(args.path, 'utf8')
      contents = replaceOnce(contents,
        "fiber.ctx.waterfall(fiber, 'internal/config', next, () => next)",
        "fiber.ctx.waterfall('internal/config', fiber, () => next)",
        'dsh-config-editor-rc11-config-hook')
      contents = replaceOnce(contents,
        '        resolveConfig(fiber.runtime as NonNullable<typeof fiber.runtime>, resolved)',
        '        // RC11 internal/config already validates and resolves this candidate.',
        'dsh-config-editor-rc11-single-validation')
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onLoad({ filter: /[\\/]deepseek-harness[\\/]packages[\\/]boot[\\/]app-boot[\\/]src[\\/]index\.ts$/ }, async args => {
      const original = await readFile(args.path, 'utf8')
      const contents = replaceOnce(original,
        "ctx.on('internal/update', (_config, _noSave, next: () => unknown) => {",
        "ctx.on('internal/update', (_config, next: () => unknown) => {",
        'dsh-app-boot-rc11-update-hook')
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onLoad({ filter: /[\\/]deepseek-harness[\\/]packages[\\/]llm[\\/]llm-pi-ai[\\/]src[\\/]index\.ts$/ }, async args => {
      let contents = await readFile(args.path, 'utf8')
      contents = replaceOnce(contents,
        "ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _raw, next) {",
        "ctx.on('internal/config', (fiber, next) => {",
        'dsh-pi-ai-rc11-config-hook')
      contents = replaceOnce(contents, 'if (this !== ctx.fiber) return raw', 'if (fiber !== ctx.fiber) return raw', 'dsh-pi-ai-rc11-fiber-check')
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onLoad({ filter: /[\\/]cordis-rc11[\\/]packages[\\/]loader[\\/]src[\\/]config[\\/]entry\.ts$/ }, async args => {
      const original = await readFile(args.path, 'utf8')
      const before = 'this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack)'
      if (!original.includes(before)) throw new Error('RC11 Loader fiber identity patch no longer applies')
      // DSH's existing Loader V20 patch: retain the Fiber, not the registry's
      // PromiseLike context wrapper. AppBoot reads fiber.runtime/config/state.
      return { contents: original.replace(before, `${before}.ctx.fiber`), loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onLoad({ filter: /[\\/]llm[\\/]src[\\/]attribution\.ts$/ }, async args => {
      const pkg = JSON.parse(await readFile(resolve(dirname(args.path), '../package.json'), 'utf8'))
      const contents = (await readFile(args.path, 'utf8')).replace(
        /const \{ version \} = createRequire\(import\.meta\.url\)\('\.\.\/package\.json'\) as \{ version: string \}/,
        `const version = ${JSON.stringify(pkg.version)}`,
      )
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
    builder.onResolve({ filter: /^(?:@deepseek-ai\/|@cordisjs\/|cordis$|cosmokit$|schemastery$)/ }, args => {
      const path = upstreamNames.get(args.path) ?? args.path
      const name = path.startsWith('@deepseek-ai/') ? path.split('/').slice(0, 2).join('/') : path
      const main = aliases.get(name)
      if (!main) return
      const suffix = path.slice(name.length)
      return { path: suffix ? resolve(dirname(main), suffix.replace(/^\/src\//, '')) : main }
    })
  } }],
}
export const candidateSource = { path: candidate, commit: candidateCommit, replacements: [...replacements.keys()] }
export const candidatePatchIds = [
  'cordis-133-disposed-state', 'cordis-209-isolation-boundary',
  'dsh-config-editor-rc11-config-hook', 'dsh-config-editor-rc11-single-validation',
  'dsh-app-boot-rc11-update-hook', 'dsh-pi-ai-rc11-config-hook',
  'dsh-loader-v20-fiber-identity',
]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(root, 'dist'), { recursive: true })
  const result = await build(candidateBuildOptions)
  console.log(`RC11 probe built ${Object.keys(result.metafile.inputs).length} inputs from DSH ${execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()} and Cordis ${candidateCommit}`)
}
