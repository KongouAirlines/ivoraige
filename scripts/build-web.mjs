import { build } from 'esbuild'
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outdir = resolve(root, 'dist/web')
await mkdir(outdir, { recursive: true })
const dsh = resolve(root, 'experiments/vendor/deepseek-harness')
const pinnedClient = {
  '@deepseek-ai/dsh-client-ui-slots': resolve(dsh, 'packages/client/ui-slots/src/index.ts'),
  '@deepseek-ai/cordis': resolve(dsh, 'vendor/cordis/src/index.ts'),
  '@deepseek-ai/cosmokit': resolve(dsh, 'vendor/cosmokit/src/index.ts'),
}
const plugin = { name: 'pinned-dsh-client', setup(builder) {
  builder.onResolve({ filter: /^@deepseek-ai\// }, args => {
    const path = pinnedClient[args.path]
    if (!path) throw new Error(`Unbundled DSH client dependency: ${args.path}`)
    return { path }
  })
} }
// Node tests need an importable build of the browser source. This file is
// outside dist/web and outside the package's published "files" allowlist.
await build({ absWorkingDir: root, entryPoints: ['web/settings-runtime.mjs'], outfile: 'dist/settings-runtime-test.mjs',
  bundle: true, minify: false, format: 'esm', platform: 'neutral', target: 'es2022', plugins: [plugin] })
// Remove the browser duplicate produced by an earlier build layout. The SPA
// includes the runtime in app.js; no page fetches this standalone file.
await rm(resolve(outdir, 'settings-runtime.mjs'), { force: true })
const appBuild = await build({ absWorkingDir: root, entryPoints: ['web/app.jsx'], outfile: 'dist/web/app.js',
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
  loader: { '.jsx': 'jsx' }, plugins: [plugin] })
for (const output of appBuild.outputFiles) {
  if (output.path.endsWith('app.js')) await writeFile(output.path, output.contents)
}
const generatedCss = appBuild.outputFiles.find(output => output.path.endsWith('app.css'))?.text ?? ''
await writeFile(resolve(outdir, 'app.css'), `${await readFile(resolve(root, 'web/app.css'), 'utf8')}\n${generatedCss}`)
await copyFile(resolve(root, 'web/index.html'), resolve(outdir, 'index.html'))
const notices = await Promise.all(['react', 'react-dom', 'scheduler'].map(async name => {
  const directory = resolve(root, 'node_modules', name)
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  return `${pkg.name} ${pkg.version}\n${await readFile(resolve(directory, 'LICENSE'), 'utf8')}`
}))
for (const directory of [dsh, resolve(dsh, 'vendor/cordis'), resolve(dsh, 'vendor/cosmokit')]) {
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  notices.push(`${pkg.name} ${pkg.version}\n${await readFile(resolve(directory, 'LICENSE'), 'utf8')}`)
}
await writeFile(resolve(outdir, 'THIRD_PARTY_LICENSES.txt'), notices.join('\n\n'))
console.log('Built dist/web')
