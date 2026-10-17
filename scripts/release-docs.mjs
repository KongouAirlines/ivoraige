import { execFileSync } from 'node:child_process'
import { Marked } from 'marked'
import { gfmHeadingId } from 'marked-gfm-heading-id'
import { readFile, writeFile, mkdir, cp, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const guideNames = ['installation-guide.md', 'workbench-guide.md', 'pdf-guide.md', 'settings-guide.md', 'mcp-guide.md', 'capabilities.md']
export const rootNames = ['README.md', 'README.zh-CN.md', 'THIRD_PARTY.md', 'CONTRIBUTING.md', 'SECURITY.md']
export const guideDir = 'docs/plan/0.1.0'
const origin = 'https://github.com/KongouAirlines/ivaraige'

function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
export async function releaseInfo(root) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  try {
    // Git otherwise silently discovers a parent checkout for an unpacked archive.
    if (await realpath(git(root, 'rev-parse', '--show-toplevel')) !== await realpath(root)) throw new Error('No Git checkout at source root')
    const commit = git(root, 'rev-parse', 'HEAD')
    const dirty = Boolean(git(root, 'status', '--porcelain', '--untracked-files=normal'))
    return { version, sourceCommit: commit, sourceTree: dirty ? 'modified' : 'clean',
      sourceUrl: dirty ? null : `${origin}/tree/${commit}`,
      sourceCommitUrl: `${origin}/commit/${commit}` }
  } catch {
    return { version, sourceCommit: null, sourceTree: 'unavailable', sourceUrl: null, sourceCommitUrl: null }
  }
}

export function exactSourceLinks(markdown, info) {
  if (!info.sourceCommit) return markdown
  return markdown.replaceAll(`${origin}/blob/main/`, `${origin}/blob/${info.sourceCommit}/`)
    .replaceAll(`${origin}/tree/main/`, `${origin}/tree/${info.sourceCommit}/`)
}

function escapeHtml(text) { return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }
function sourceTarget(path, info) { return `${origin}/blob/${info.sourceCommit ?? 'main'}/${path}` }
function guideTarget(href, info) {
  if (/^(?:installation-guide|workbench-guide|pdf-guide|settings-guide|mcp-guide|capabilities)\.md(?:#.*)?$/.test(href))
    return href.replace('.md', '.html')
  if (/^(?:https?:|mailto:|#)/.test(href)) return href
  return sourceTarget(`${guideDir}/${href}`, info)
}
export function guideHtml(markdown, info, name = 'pdf-guide.md') {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? name.replace(/\.md$/, '')
  const parser = new Marked({ gfm: true, renderer: {
    link({ href, title: linkTitle, tokens }) {
      const target = guideTarget(href, info)
      const label = this.parser.parseInline(tokens)
      return `<a href="${escapeHtml(target)}"${linkTitle ? ` title="${escapeHtml(linkTitle)}"` : ''}>${label}</a>`
    },
    html({ text }) { return escapeHtml(text) },
  } })
  parser.use(gfmHeadingId())
  const body = parser.parse(exactSourceLinks(markdown, info))
  const status = info.sourceTree === 'clean'
    ? `<a href="${info.sourceUrl}">源码 ${info.sourceCommit.slice(0, 12)}</a>`
    : info.sourceTree === 'modified'
      ? `本地修改构建 · 基础提交 <a href="${info.sourceCommitUrl}">${info.sourceCommit.slice(0, 12)}</a>；本页面内容可能未包含在该提交中`
      : '源码来源未知；此构建未包含 Git 元数据，无法证明其对应的提交'
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ivoraige</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1.2rem;color:#223;background:#fafbfc}a{color:#2459a6}code{background:#e8edf4;padding:.1em .3em;border-radius:3px}pre{overflow:auto;padding:1rem;background:#e8edf4;border-radius:6px}pre code{padding:0}li{margin:.35em 0}header{padding:1rem;border:1px solid #ccd5df;border-radius:8px;background:white}main{margin-top:2rem}h1,h2,h3{line-height:1.3}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ccd5df;padding:.4rem .6rem}</style></head><body><header>ivoraige ${escapeHtml(info.version)} · ${status}<br><small>随此安装包固定的指南。需要查看完整文档时，请使用包内 docs/plan/0.1.0/。</small></header><main>${body}</main></body></html>\n`
}

export async function buildWebGuides(root, outdir) {
  const info = await releaseInfo(root)
  await mkdir(outdir, { recursive: true })
  for (const name of guideNames) {
    const source = await readFile(join(root, guideDir, name), 'utf8')
    await writeFile(join(outdir, name.replace(/\.md$/, '.html')), guideHtml(source, info, name))
  }
  await writeFile(join(outdir, 'release-info.json'), JSON.stringify(info, null, 2) + '\n')
  await validateWebGuideLinks(outdir)
  return info
}


export async function validateWebGuideLinks(outdir) {
  const failures = []
  for (const name of guideNames.map(value => value.replace(/\.md$/, '.html'))) {
    const content = await readFile(join(outdir, name), 'utf8')
    for (const match of content.matchAll(/href=\"([^\"]+)\"/g)) {
      const href = match[1].split('#')[0]
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue
      const target = resolve(outdir, href)
      if (!target.startsWith(`${resolve(outdir)}${sep}`)) { failures.push(`${name}: escapes bundle: ${href}`); continue }
      try { await readFile(target) } catch { failures.push(`${name}: missing ${href}`) }
    }
  }
  if (failures.length) throw new Error(`Bundled HTML guides have broken links:\n${failures.join('\n')}`)
}

const shipped = new Set([...rootNames, ...guideNames.map(name => `${guideDir}/${name}`), 'docs/assets/0.1.0/workbench.jpg'])
export function portableLinks(markdown, sourceName, info) {
  const sourceDir = dirname(join('/', sourceName))
  return exactSourceLinks(markdown, info).replace(/(!?\[[^\]]*\]\()([^)]*)(\))/g, (whole, open, href, close) => {
    if (!href || /^(?:https?:|mailto:|#)/.test(href)) return whole
    const [path, anchor = ''] = href.split('#', 2)
    const target = relative('/', resolve(sourceDir, path)).replaceAll('\\', '/')
    if (shipped.has(target)) return whole
    return `${open}${sourceTarget(target, info)}${anchor ? `#${anchor}` : ''}${close}`
  })
}

export async function copyUserDocs(root, destination) {
  const info = await releaseInfo(root)
  for (const name of rootNames) {
    const source = join(root, name)
    const output = join(destination, name)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, portableLinks(await readFile(source, 'utf8'), name, info))
  }
  const target = join(destination, guideDir)
  await mkdir(target, { recursive: true })
  for (const name of guideNames) {
    await writeFile(join(target, name), portableLinks(await readFile(join(root, guideDir, name), 'utf8'), `${guideDir}/${name}`, info))
  }
  await mkdir(join(destination, 'docs/assets/0.1.0'), { recursive: true })
  await cp(join(root, 'docs/assets/0.1.0/workbench.jpg'), join(destination, 'docs/assets/0.1.0/workbench.jpg'))
  await validatePackagedLinks(destination, info)
  return info
}

export async function validatePackagedLinks(destination, info = null) {
  const docs = [...rootNames, ...guideNames.map(name => `${guideDir}/${name}`)]
  const failures = []
  for (const name of docs) {
    const content = await readFile(join(destination, name), 'utf8')
    if (info?.sourceCommit && new RegExp(`https://github\\.com/KongouAirlines/ivaraige/(?:blob|tree)/main/`).test(content))
      failures.push(`${name}: mutable main source link remains`)
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].split('#')[0]
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue
      const target = resolve(dirname(join(destination, name)), decodeURIComponent(href))
      if (!target.startsWith(`${resolve(destination)}${sep}`)) { failures.push(`${name}: escapes package: ${href}`); continue }
      try { await readFile(target) } catch { failures.push(`${name}: missing ${href}`) }
    }
  }
  if (failures.length) throw new Error(`Packaged documentation has broken links:\n${failures.join('\n')}`)
}
