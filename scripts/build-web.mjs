import { build } from 'esbuild'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outdir = resolve(root, 'dist/web')
await mkdir(outdir, { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['web/app.jsx'], outfile: 'dist/web/app.js',
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
  loader: { '.jsx': 'jsx' } })
await copyFile(resolve(root, 'web/index.html'), resolve(outdir, 'index.html'))
await copyFile(resolve(root, 'web/app.css'), resolve(outdir, 'app.css'))
const notices = await Promise.all(['react', 'react-dom', 'scheduler'].map(async name => {
  const directory = resolve(root, 'node_modules', name)
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  return `${pkg.name} ${pkg.version}\n${await readFile(resolve(directory, 'LICENSE'), 'utf8')}`
}))
await writeFile(resolve(outdir, 'THIRD_PARTY_LICENSES.txt'), notices.join('\n\n'))
console.log('Built dist/web')
