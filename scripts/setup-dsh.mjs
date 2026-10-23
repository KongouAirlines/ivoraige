import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const DSH_COMMIT = '687f282e8625c6b8d11ff58211a90524be2e4317'
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const upstream = resolve(root, 'experiments/vendor/deepseek-harness')

export function verifySource(source = upstream) {
  const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (commit !== DSH_COMMIT) throw new Error(`DSH checkout must be ${DSH_COMMIT}; found ${commit}`)
  // Build must not silently use edited third-party source at the pinned HEAD.
  const dirty = execFileSync('git', ['-C', source, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
  if (dirty) throw new Error('DSH tracked source has local changes; use a clean pinned checkout')
  return source
}

export async function setupSource() {
  if (!existsSync(upstream)) {
    await mkdir(upstream, { recursive: true })
    execFileSync('git', ['init', upstream], { stdio: 'inherit' })
    execFileSync('git', ['-C', upstream, 'remote', 'add', 'origin', 'https://github.com/deepseek-ai/deepseek-harness.git'], { stdio: 'inherit' })
    execFileSync('git', ['-C', upstream, 'fetch', '--depth', '1', 'origin', DSH_COMMIT], { stdio: 'inherit' })
    execFileSync('git', ['-C', upstream, 'checkout', '--detach', DSH_COMMIT], { stdio: 'inherit' })
  }
  verifySource()
  console.log(`DSH source ready at ${DSH_COMMIT}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await setupSource()
