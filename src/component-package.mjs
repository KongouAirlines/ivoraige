import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import * as tar from 'tar'
import { KernelError } from './errors.mjs'

export const MANIFEST_NAME = 'components-manifest.json'
export const TOKEN_REF = 'IVORAIGE_COMPONENTS_GITHUB_TOKEN'
const MAX_MANIFEST_BYTES = 1024 * 1024
const HASH = /^[0-9a-f]{64}$/i
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEFAULT_REPOSITORY = 'KongouAirlines/ivaraige'

const invalid = message => new KernelError('INVALID_ARGUMENT', message)
const upstream = message => new KernelError('UPSTREAM_FAILURE', message)

export function repositoryPath(repository = DEFAULT_REPOSITORY) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw invalid('repository must be an owner/repository pair')
  }
  return repository
}

export function validateManifest(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.components)) {
    throw invalid('Component manifest requires schemaVersion 1 and components')
  }
  const keys = new Set()
  const components = value.components.map((item, index) => {
    if (!item || typeof item !== 'object') throw invalid(`Invalid component at index ${index}`)
    for (const field of ['id', 'version', 'platform', 'arch']) {
      if (typeof item[field] !== 'string' || !SAFE_NAME.test(item[field])) {
        throw invalid(`Invalid component ${field} at index ${index}`)
      }
    }
    if (item.protocolVersion !== 1) throw invalid(`Unsupported component protocol at index ${index}`)
    const key = [item.id, item.version, item.platform, item.arch].join('/')
    if (keys.has(key)) throw invalid(`Duplicate component ${key}`)
    keys.add(key)
    for (const label of ['package', 'assets']) {
      const asset = item[label]
      if (label === 'assets' && asset === undefined) continue
      if (!asset || typeof asset.name !== 'string' || !SAFE_NAME.test(asset.name) ||
          !asset.name.endsWith('.tar.gz') || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
          typeof asset.sha256 !== 'string' || !HASH.test(asset.sha256)) {
        throw invalid(`Invalid ${label} asset for ${key}`)
      }
    }
    return structuredClone(item)
  })
  return { schemaVersion: 1, components }
}

function requestHeaders(token, accept) {
  return { Authorization: `Bearer ${token}`, Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ivoraige-components' }
}

function assertGitHubApi(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.github.com' || parsed.username || parsed.password) {
    throw invalid('Component API request must use api.github.com over HTTPS')
  }
}

async function fetchChecked(fetcher, url, options, signal) {
  let response
  try { response = await fetcher(url, { ...options, signal, redirect: 'manual' }) } catch (error) {
    if (signal?.aborted) throw error
    throw upstream(`Component download failed: ${error.message}`)
  }
  return response
}

async function followAsset(fetcher, url, token, signal) {
  assertGitHubApi(url)
  let response = await fetchChecked(fetcher, url,
    { headers: requestHeaders(token, 'application/octet-stream') }, signal)
  for (let hops = 0; hops < 5 && response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get('location')
    if (!location) throw upstream('Component asset redirect lacks a location')
    const next = new URL(location, url)
    if (next.protocol !== 'https:' || next.username || next.password) {
      throw upstream('Component asset redirect is not a safe HTTPS URL')
    }
    // GitHub may send signed URLs to a separate host. Never forward credentials.
    response.body?.cancel().catch(() => {})
    url = next.href
    response = await fetchChecked(fetcher, url,
      { headers: { 'User-Agent': 'ivoraige-components' } }, signal)
  }
  if (!response.ok || response.status >= 300) throw upstream(`Component asset request failed (HTTP ${response.status})`)
  return response
}

export async function fetchRelease(fetcher, repository, releaseTag, token, signal) {
  repository = repositoryPath(repository)
  if (typeof releaseTag !== 'string' || !releaseTag.trim()) throw invalid('releaseTag is required for remote catalog')
  if (!token) throw new KernelError('PRECONDITION_FAILED', 'A GitHub token with repository Contents read access is required')
  const url = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`
  const response = await fetchChecked(fetcher, url,
    { headers: requestHeaders(token, 'application/vnd.github+json') }, signal)
  if (!response.ok) throw upstream(`Could not read private component release (HTTP ${response.status})`)
  const release = await response.json()
  if (!Array.isArray(release.assets)) throw upstream('Component release has no assets')
  return release
}

export async function downloadAsset(fetcher, repository, asset, token, path, signal, expected, onProgress) {
  const url = `https://api.github.com/repos/${repositoryPath(repository)}/releases/assets/${asset.id}`
  const response = await followAsset(fetcher, url, token, signal)
  if (!response.body) throw upstream('Component asset response is empty')
  const hash = createHash('sha256')
  let size = 0
  let nextProgress = 0
  const limit = expected?.size ?? MAX_MANIFEST_BYTES
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length
    if (size > limit) return callback(upstream('Component asset exceeds manifest size'))
    hash.update(chunk)
    if (onProgress && size >= nextProgress) {
      onProgress(size)
      nextProgress = size + 4 * 1024 ** 2
    }
    callback(null, chunk)
  } })
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(path, { flags: 'wx' }),
    { signal })
  const digest = hash.digest('hex')
  onProgress?.(size)
  if (expected && (size !== expected.size || digest !== expected.sha256.toLowerCase())) {
    throw upstream(`Component asset ${asset.name} failed size or SHA-256 verification`)
  }
  return { size, sha256: digest }
}

export async function loadManifest(path) {
  const info = await stat(path)
  if (info.size > MAX_MANIFEST_BYTES) throw invalid('Component manifest is too large')
  return validateManifest(JSON.parse(await readFile(path, 'utf8')))
}

export function findComponent(manifest, { id = 'babeldoc', version, platform = process.platform,
  arch = process.arch } = {}) {
  const matches = manifest.components.filter(row => row.id === id && row.platform === platform &&
    row.arch === arch && (version === undefined || row.version === version))
  if (matches.length !== 1) throw new KernelError('NOT_FOUND',
    matches.length ? 'Multiple component versions match; select a version' :
      `No ${id} component matches ${platform}/${arch}${version ? ` version ${version}` : ''}`)
  return matches[0]
}

export function findAsset(release, descriptor) {
  const match = release.assets.filter(row => row.name === descriptor.name)
  if (match.length !== 1 || !Number.isSafeInteger(match[0].id)) {
    throw upstream(`Release asset ${descriptor.name} is missing or duplicated`)
  }
  if (match[0].size !== descriptor.size) throw upstream(`Release asset ${descriptor.name} has an unexpected size`)
  return match[0]
}

export function inside(root, member) {
  if (typeof member !== 'string' || !member || isAbsolute(member) || member.includes('\\') ||
      member.includes(':') || member.includes('\0') ||
      member.split('/').some(part => part === '..' || part === '')) throw invalid('Unsafe component path')
  const target = resolve(root, member)
  const rel = relative(root, target)
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw invalid('Unsafe component path')
  return target
}

export async function extractVerifiedArchive(archive, stage, signal, { assetsOnly = false } = {}) {
  await mkdir(stage, { recursive: true })
  let total = 0
  let entries = 0
  let violation
  await tar.x({ file: archive, cwd: stage, strict: true, preservePaths: false,
    filter: (path, entry) => {
      if (violation) return false
      try {
        if (signal?.aborted) throw signal.reason ?? new Error('Canceled')
        const member = path.replace(/^\.\//, '').replace(/\/$/, '')
        if (member && member !== '.') inside(stage, member)
        else if (entry.type !== 'Directory') throw invalid('Unsafe component path')
        if (assetsOnly && member && member !== '.' && member !== 'assets' &&
            !member.startsWith('assets/')) throw invalid('Component assets archive contains a non-assets path')
        if (!['File', 'Directory'].includes(entry.type)) throw invalid('Component archive contains a link or special file')
        entries++
        total += entry.size ?? 0
        if (entries > 100_000 || total > 8 * 1024 ** 3) throw invalid('Component archive exceeds extraction limits')
        return true
      } catch (error) { violation = error; return false }
    } })
  if (violation) throw violation
}

export async function inspectComponent(root, expected) {
  const config = JSON.parse(await readFile(join(root, 'component.json'), 'utf8'))
  for (const field of ['id', 'version', 'platform', 'arch']) {
    if (typeof config[field] !== 'string' || !SAFE_NAME.test(config[field])) {
      throw invalid(`Invalid installed component ${field}`)
    }
  }
  for (const field of ['id', 'version', 'platform', 'arch', 'protocolVersion']) {
    if (config[field] !== expected[field]) throw invalid(`Installed component ${field} differs from release manifest`)
  }
  if (config.id !== 'babeldoc' || config.protocolVersion !== 1 ||
      typeof config.command !== 'string' || !Array.isArray(config.args) ||
      config.args.some(arg => typeof arg !== 'string') ||
      !config.modelDirs || typeof config.modelDirs !== 'object') {
    throw invalid('Invalid BabelDOC component.json')
  }
  const command = inside(root, config.command)
  if (!(await lstat(command)).isFile()) throw invalid('Component command is not a file')
  const modelDirs = {}
  for (const [key, value] of Object.entries(config.modelDirs)) {
    if (!SAFE_NAME.test(key) || typeof value !== 'string') throw invalid('Invalid component model directory')
    const path = inside(root, value)
    // Missing model assets are allowed; BabelDOC can manage its own cache.
    modelDirs[key] = path
  }
  return { command, args: config.args, modelDirs, root,
    id: config.id, version: config.version, platform: config.platform, arch: config.arch,
    protocolVersion: config.protocolVersion }
}
