import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { lt } from 'semver'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { COMPONENT_SETTINGS_NS } from './component-settings.mjs'
import { downloadAsset, extractVerifiedArchive, fetchRelease, findAsset, findComponent,
  inspectComponent, loadManifest, MANIFEST_NAME, repositoryPath, TOKEN_REF } from './component-package.mjs'

const terminal = new Set(['completed', 'failed', 'killed'])

async function publishDirectory(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(source, destination) } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt >= 5) throw error
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

export class Components extends Service {
  static inject = ['jobs', 'credentials', 'settings', 'ivoraige.componentsSettings']

  constructor(ctx, config = {}) {
    super(ctx, 'ivoraige.components')
    if (typeof config.directory !== 'string' || !config.directory.trim()) {
      throw new KernelError('INVALID_ARGUMENT', 'Component installation directory is required')
    }
    this.directory = resolve(config.directory)
    this.repository = repositoryPath(config.repository)
    this.releaseTag = config.releaseTag
    this.fetcher = config.fetcher ?? fetch
    this.jobs = ctx.jobs
    this.tasks = new Map()
    this.detachController = this.jobs.attachController('ivoraige component installs')
    ctx.effect(() => () => this.detachController(), 'component install controller')
  }

  async token() {
    return (await this.ctx.credentials.resolve(TOKEN_REF))?.value ?? null
  }

  async setToken(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new KernelError('INVALID_ARGUMENT', 'GitHub token must be a nonempty string')
    }
    await this.ctx.credentials.set(TOKEN_REF, value.trim())
    return this.ctx.credentials.describe(TOKEN_REF)
  }

  async getInstalledPdf() {
    const selected = this.ctx.get('ivoraige.componentsSettings').selected()
    if (!selected) return null
    try {
      const root = resolve(selected)
      const rel = relative(this.directory, root)
      if (!rel || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) return null
      if (await realpath(root) !== root) return null
      const config = JSON.parse(await readFile(join(root, 'component.json'), 'utf8'))
      return await inspectComponent(root, { id: 'babeldoc', version: config.version,
        platform: process.platform, arch: process.arch, protocolVersion: 1 })
    } catch { return null }
  }

  async status() {
    const selected = this.ctx.get('ivoraige.componentsSettings').selected()
    const installed = await this.getInstalledPdf()
    const latestTaskId = [...this.tasks.keys()].at(-1)
    return { installed, unavailable: selected && !installed ? 'Selected PDF component is missing or invalid' : null,
      credentialConfigured: Boolean((await this.ctx.credentials.describe(TOKEN_REF))?.configured),
      repository: this.repository, releaseTag: this.releaseTag ?? null,
      restartRequired: [...this.tasks.values()].some(row => row.restartRequired),
      task: latestTaskId ? this.getTask(latestTaskId) : null }
  }

  async release(signal) {
    const token = await this.token()
    const release = await fetchRelease(this.fetcher, this.repository, this.releaseTag, token, signal)
    const manifestAsset = release.assets.find(asset => asset.name === MANIFEST_NAME)
    if (!manifestAsset || !Number.isSafeInteger(manifestAsset.id) ||
        !Number.isSafeInteger(manifestAsset.size) || manifestAsset.size > 1024 * 1024) {
      throw new KernelError('UPSTREAM_FAILURE', 'Private release lacks a valid components-manifest.json asset')
    }
    const temporary = await mkdtemp(join(this.directory, '.catalog-'))
    try {
      const path = join(temporary, MANIFEST_NAME)
      await downloadAsset(this.fetcher, this.repository, manifestAsset, token, path, signal)
      return { release, manifest: await loadManifest(path), token }
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }

  async catalog() {
    await mkdir(this.directory, { recursive: true })
    const { manifest } = await this.release()
    return { repository: this.repository, releaseTag: this.releaseTag,
      components: manifest.components.map(({ id, version, platform, arch, protocolVersion,
        package: pkg, assets }) => ({ id, version, platform, arch, protocolVersion,
          size: pkg.size + (assets?.size ?? 0), assetsIncluded: Boolean(assets) })) }
  }

  install({ id = 'babeldoc', version, platform = process.platform, arch = process.arch } = {}) {
    if (id !== 'babeldoc') throw new KernelError('INVALID_ARGUMENT', 'Only the official BabelDOC PDF component is supported')
    return this.start({ id, version, platform, arch, source: 'release' })
  }

  installLocal({ manifestPath, id = 'babeldoc', version, platform = process.platform,
    arch = process.arch } = {}) {
    if (typeof manifestPath !== 'string' || !manifestPath.trim()) {
      throw new KernelError('INVALID_ARGUMENT', 'Local installation requires manifestPath')
    }
    if (id !== 'babeldoc') throw new KernelError('INVALID_ARGUMENT', 'Only the official BabelDOC PDF component is supported')
    return this.start({ id, version, platform, arch, source: 'local', manifestPath: resolve(manifestPath) })
  }

  start(input) {
    if ([...this.tasks.keys()].some(taskId => !terminal.has(this.jobs.get(taskId).status))) {
      throw new KernelError('CONFLICT', 'A component installation is already running')
    }
    const controller = new AbortController()
    const state = { restartRequired: false, result: null, error: null, committing: false }
    let taskId
    try {
      taskId = this.jobs.start({ kind: 'component-install',
        label: `Install ${input.id} ${input.platform}/${input.arch}`,
        run: job => ({ cancel: () => controller.abort(),
          done: this.runInstall(input, job, controller.signal, state) }) })
    } catch (error) {
      if (/background job limit reached/.test(error.message)) {
        throw new KernelError('CONFLICT', 'Wait for the active task before installing a component')
      }
      throw error
    }
    this.tasks.set(taskId, state)
    return { taskId }
  }

  async runInstall(input, job, signal, state) {
    try {
      const result = await this.performInstall(input, job, signal, state)
      state.result = result
      state.restartRequired = result.restartRequired
      return { status: 'completed', result }
    } catch (error) {
      state.error = signal.aborted ? 'Installation canceled' :
        error instanceof KernelError ? error.message : error.code === 'ENOENT' ?
          '找不到组件清单、归档或启动程序，请检查包是否完整以及路径是否正确。' :
          error.code === 'ENOSPC' ? '磁盘空间不足，请释放空间后重试安装。' :
          error instanceof SyntaxError ? '组件清单不是有效的 JSON，请重新下载完整的组件包。' :
          'Component installation failed'
      return { status: signal.aborted ? 'killed' : 'failed', detail: state.error }
    }
  }

  async stageLocal(path, destination, descriptor, signal) {
    const hash = createHash('sha256')
    let size = 0
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > descriptor.size) return callback(new KernelError('INVALID_ARGUMENT',
        `Local asset ${descriptor.name} exceeds its declared size`))
      hash.update(chunk)
      callback(null, chunk)
    } })
    await pipeline(createReadStream(path, { signal }), meter,
      createWriteStream(destination, { flags: 'wx' }), { signal })
    if (size !== descriptor.size || hash.digest('hex') !== descriptor.sha256.toLowerCase()) {
      throw new KernelError('INVALID_ARGUMENT', `Local asset ${descriptor.name} failed SHA-256 verification`)
    }
    return destination
  }

  async performInstall(input, job, signal, state) {
    await mkdir(this.directory, { recursive: true })
    job.updateProgress('正在读取组件清单')
    let manifest, release, token
    if (input.source === 'local') manifest = await loadManifest(input.manifestPath)
    else ({ manifest, release, token } = await this.release(signal))
    const component = findComponent(manifest, input)
    const installed = await this.getInstalledPdf()
    if (installed && lt(component.version, installed.version)) {
      throw new KernelError('PRECONDITION_FAILED',
        `Cannot downgrade PDF component from ${installed.version} to ${component.version}; install the same or a newer version`)
    }
    const root = join(this.directory, 'versions', component.id, component.version,
      `${component.platform}-${component.arch}`)
    const stage = await mkdtemp(join(this.directory, '.install-'))
    try {
      for (const [label, descriptor] of [['package', component.package], ['assets', component.assets]]) {
        if (!descriptor) continue
        if (signal.aborted) throw signal.reason ?? new Error('Canceled')
        const display = label === 'package' ? '组件' : '资源'
        job.updateProgress(`正在校验${display}包`)
        const archive = join(stage, descriptor.name)
        if (input.source === 'local') await this.stageLocal(
          join(dirname(input.manifestPath), descriptor.name), archive, descriptor, signal)
        else await downloadAsset(this.fetcher, this.repository, findAsset(release, descriptor), token,
          archive, signal, descriptor, bytes => job.updateProgress(
            `${display}下载与校验：${(bytes / 1024 ** 2).toFixed(1)} / ${(descriptor.size / 1024 ** 2).toFixed(1)} MiB`))
        job.updateProgress(`正在解压${display}包`)
        await extractVerifiedArchive(archive, join(stage, 'root'), signal,
          { assetsOnly: label === 'assets' })
      }
      const extracted = join(stage, 'root')
      await inspectComponent(extracted, component)
      if (signal.aborted) throw signal.reason ?? new Error('Canceled')
      state.committing = true
      job.updateProgress('正在保存安装配置，此时无法取消')
      await mkdir(dirname(root), { recursive: true })
      let backup = null
      let published = false
      try {
        try {
          await stat(root)
          const candidate = `${root}.replaced-${randomUUID()}`
          try { await publishDirectory(root, candidate) } catch (error) {
            if (['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
              throw new KernelError('PRECONDITION_FAILED',
                'The existing PDF component is in use; restart the application and retry repair')
            }
            throw error
          }
          backup = candidate
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        await publishDirectory(extracted, root)
        published = true
        const revision = this.ctx.settings.describe().find(row => row.ns === COMPONENT_SETTINGS_NS)?.revision
        if (revision === undefined) throw new Error('Component settings are not registered in the DSH profile')
        await this.ctx.settings.mutate(COMPONENT_SETTINGS_NS,
          [{ op: 'set', path: ['installedPdf'], value: root }], revision)
      } catch (error) {
        try {
          if (published) await rm(root, { recursive: true, force: true })
          if (backup) await publishDirectory(backup, root)
        } catch (rollbackError) {
          throw new KernelError('UPSTREAM_FAILURE',
            'Component activation failed and the previous version could not be restored automatically',
            { previousVersionBackup: backup }, { cause: rollbackError })
        }
        throw error
      }
      let cleanupWarning
      if (backup) {
        try { await rm(backup, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
        catch { cleanupWarning = 'Previous component files could not be removed' }
      }
      job.updateProgress('安装完成，重启后启用 PDF')
      return { installed: { id: component.id, version: component.version,
        platform: component.platform, arch: component.arch }, restartRequired: true,
        ...(cleanupWarning ? { cleanupWarning } : {}) }
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  getTask(taskId) {
    const state = this.tasks.get(taskId)
    if (!state) throw new KernelError('NOT_FOUND', 'Component installation task not found')
    const job = this.jobs.get(taskId)
    return { taskId, state: job.status, progress: job.progress ?? null, result: state.result,
      error: state.error, restartRequired: state.restartRequired }
  }

  cancel(taskId) {
    if (!this.tasks.has(taskId)) throw new KernelError('NOT_FOUND', 'Component installation task not found')
    const job = this.jobs.get(taskId)
    if (terminal.has(job.status)) return this.getTask(taskId)
    if (this.tasks.get(taskId).committing) {
      throw new KernelError('CONFLICT', 'Component activation is finishing; wait for the task to complete')
    }
    this.jobs.kill(taskId, undefined, 'canceled')
    return this.getTask(taskId)
  }

  async close() {
    for (const taskId of this.tasks.keys()) {
      const job = this.jobs.get(taskId)
      if (!terminal.has(job.status) && !this.tasks.get(taskId).committing) {
        this.jobs.kill(taskId, undefined, 'application closing')
      }
    }
    await Promise.all([...this.tasks.keys()].map(async taskId => {
      while (!terminal.has((await this.jobs.wait(taskId, 30_000)).status)) { /* Finish activation. */ }
    }))
  }
}
