import { spawn } from 'node:child_process'
import { writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adapter = fileURLToPath(new URL('../../experiments/pdf-injection/adapter.py', import.meta.url))
const defaultPython = fileURLToPath(new URL('../../evaluation/runs/m3-1/.venv/Scripts/python.exe', import.meta.url))

export async function renderBabeldocPdf(manifest, options) {
    const { runDir, python = defaultPython, assets, cancelFile, signal, experimentalRepairs = false, renderText } = options
    const source = manifest.sourceBinding ?? manifest.pdfSource
    if (source?.provider && source.provider !== 'babeldoc') throw new Error('BabelDOC renderer requires a BabelDOC source binding')
    if (!source?.sourcePdf) throw new Error('BabelDOC source PDF is unavailable')
    const input = resolve(options.input ?? source.sourcePdf)
    const pages = options.pages ?? source.pages
    if (!Array.isArray(pages) || !pages.length) throw new Error('BabelDOC pages are unavailable')
    await mkdir(runDir, { recursive: true })
    const records = join(runDir, 'accepted-manifest.json')
    const markdown = join(runDir, 'accepted.md')
    const json = join(runDir, 'accepted.json')
    await Promise.all([
      writeFile(records, renderText('json'), 'utf8'),
      writeFile(json, renderText('json'), 'utf8'),
      writeFile(markdown, renderText('md'), 'utf8'),
    ])
    const args = [adapter, 'replay', '--input', input, '--run-dir', runDir, '--records', records, '--pages', pages.join(','), '--md-source', markdown, '--json-source', json]
    if (source.captureConfig?.min_text_length != null) args.push('--min-text-length', String(source.captureConfig.min_text_length))
    if (assets) args.push('--assets', resolve(assets))
    const cancellation = cancelFile ? resolve(cancelFile) : join(runDir, 'cancel.requested')
    args.push('--cancel-file', cancellation)
    if (experimentalRepairs) args.push('--experimental-r03-repairs')
    if (signal?.aborted) throw new Error('PDF output cancelled')
    if (await stat(cancellation).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new Error('PDF cancellation marker already exists')
    await new Promise((accept, reject) => {
      const child = spawn(python, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000) })
      const requestCancel = () => { void writeFile(cancellation, 'cancelled\n', 'utf8').catch(error => { child.kill(); reject(error) }) }
      signal?.addEventListener('abort', requestCancel, { once: true })
      child.on('error', error => { signal?.removeEventListener('abort', requestCancel); reject(error) })
      child.on('close', code => { signal?.removeEventListener('abort', requestCancel); code === 0 ? accept() : reject(new Error(`PDF renderer failed (${code}): ${stderr.slice(-4000)}`)) })
      if (signal?.aborted) requestCancel()
    }).catch(error => { if (signal?.aborted) throw new Error('PDF output cancelled'); throw error })
    if (signal?.aborted) throw new Error('PDF output cancelled')
    const published = join(runDir, 'published')
    const pdfs = (await readdir(published)).filter(name => name.endsWith('.pdf'))
    if (!pdfs.length) throw new Error('PDF renderer published no PDF')
    return { manifest, directory: published, pdf: join(published, pdfs[0]), markdown: join(published, 'translations.md'), json: join(published, 'translations.json'), modelRequests: 0 }
}
