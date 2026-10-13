import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

const statusLabels = { unchecked: '已配置，尚未验证', ready: '已验证', unavailable: '不可用' }
const taskLabels = { queued: '排队中', running: '安装中', stopping: '正在取消', paused: '已暂停', completed: '安装完成', failed: '安装失败', killed: '已取消' }
const terminal = new Set(['completed', 'failed', 'killed'])
const guide = 'https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/pdf-guide.md'
const sizeMiB = bytes => Number.isFinite(bytes) ? `${(bytes / 1048576).toFixed(2)} MiB` : '大小未知'

export function PdfSettings({ api, Button = 'button', ErrorBox, capabilities, refreshCapabilities,
  available = true, refreshKey = 0, onGuardChange }) {
  const status = capabilities?.components?.babeldoc
  const managed = capabilities?.features?.includes('component-installation')
  const [component, setComponent] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [task, setTask] = useState(null)
  const [token, setToken] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [readTick, setReadTick] = useState(0)
  const localTaskId = useRef(null)

  useLayoutEffect(() => { onGuardChange?.({ dirty: !!(token || localPath), busy: !!busy }) },
    [token, localPath, busy, onGuardChange])
  useLayoutEffect(() => () => onGuardChange?.({ dirty: false, busy: false }), [onGuardChange])
  useEffect(() => {
    if (!managed || !available || !api) return
    let alive = true
    api('/components').then(data => {
      if (!alive) return
      setComponent(data)
      if (data.task) setTask(data.task)
      setError('')
    }, cause => { if (alive) setError(cause.message) })
    return () => { alive = false }
  }, [api, managed, available, refreshKey, readTick])
  useEffect(() => {
    const id = task?.taskId
    if (!managed || !available || !id || terminal.has(task.state)) return
    let alive = true
    const poll = async () => {
      try {
        const result = await api(`/components/tasks/${encodeURIComponent(id)}`)
        if (!alive) return
        setTask(result.task)
        if (terminal.has(result.task?.state)) {
          if (localTaskId.current === id) {
            if (result.task.state === 'completed') setLocalPath('')
            localTaskId.current = null
          }
          clearInterval(timer)
          setReadTick(value => value + 1)
          refreshCapabilities?.()
        }
      } catch (cause) { if (alive) setError(cause.message) }
    }
    const timer = setInterval(poll, 1000)
    void poll()
    return () => { alive = false; clearInterval(timer) }
  }, [api, managed, available, task?.taskId, task?.state, refreshCapabilities])

  async function action(name, call, success) {
    if (!available || busy) return
    setBusy(name); setError(''); setMessage('')
    try { await call(); if (success) setMessage(success) }
    catch (cause) { setError(cause.message) }
    finally { setBusy('') }
  }
  const refresh = () => { setReadTick(value => value + 1); refreshCapabilities?.() }
  const saveToken = () => action('token', async () => {
    await api('/components/credential', { method: 'POST', body: { token } })
    setToken(''); refresh()
  }, '访问凭据已保存。')
  const checkCatalog = () => action('catalog', async () => {
    const result = await api('/components/catalog', { method: 'POST', body: {} })
    setCatalog(result.catalog)
  })
  const install = () => action('install', async () => {
    const result = await api('/components/install', { method: 'POST', body: { id: 'babeldoc' } })
    localTaskId.current = null
    setTask({ taskId: result.taskId, state: 'queued' }); refresh()
  })
  const installLocal = () => action('local', async () => {
    const result = await api('/components/local', { method: 'POST', body: { path: localPath } })
    if (result.taskId) {
      localTaskId.current = result.taskId
      setTask({ taskId: result.taskId, state: 'queued' })
    }
    refresh()
  })
  const cancel = () => action('cancel', async () => {
    const id = task?.taskId
    await api(`/components/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} })
    setReadTick(value => value + 1)
  })
  const targets = catalog?.components?.filter(item => item.id === 'babeldoc') ?? []
  const installed = !!component?.installed
  const credentialConfigured = component?.credentialConfigured
  const installing = task && !terminal.has(task.state)
  const progressText = task?.progress ?? ''
  const componentStatus = statusLabels[status?.state] ?? (managed ? installed ? '已安装，待重启启用' : '未安装' : '状态暂不可读')

  return <div className="page"><div className="page-head"><div><span className="eyebrow">PDF COMPONENT</span><h2>PDF</h2>
    <p>查看组件状态并准备 PDF 处理。</p></div><button disabled={!available} onClick={refresh}>刷新状态</button></div>
    <section className="settings-card"><h3>组件状态</h3><p role="status">{componentStatus}</p>
      {status?.message && <p className="hint">{status.message}</p>}
      <p>首次实际导入或导出时，组件才会验证环境和资产。</p>
      <dl><dt>当前输入格式</dt><dd>{capabilities?.inputFormats?.join('、') || '无'}</dd>
        <dt>当前输出格式</dt><dd>{capabilities?.outputFormats?.join('、') || '无'}</dd></dl></section>
    {managed ? <>
      <section className="settings-card"><h3>安装可选 PDF 组件</h3>
        <p>需要处理原生文本英文 PDF 时，可从受控发布源安装 BabelDOC。文本与 Markdown 无需安装它。</p>
        <p role="status">{installed ? '组件包已安装' : '组件包尚未安装'}{installed && component.installed.version ? ` · ${component.installed.version}` : ''}</p>
        {component?.unavailable && <div className="notice error" role="alert">{component.unavailable}</div>}
        {component?.repository && <p className="hint">发布源：{/^https:\/\//.test(component.repository) ?
          <a href={component.repository} target="_blank" rel="noreferrer">{component.repository}</a> : component.repository}</p>}
        {component?.restartRequired && <div className="notice" role="status">组件已准备好。请保存当前工作后手动重启服务，使 PDF 功能生效。</div>}
        <div className="credential-form"><label>私有 GitHub Releases 访问令牌
          <input type="password" autoComplete="new-password" value={token} disabled={!available || !!busy}
            onChange={event => setToken(event.target.value)} placeholder={credentialConfigured ? '已保存；输入新令牌以更换' : '输入访问令牌'}/>
        </label><span className="hint">{credentialConfigured ? '访问凭据已配置' : '尚未配置访问凭据'}</span>
          <Button className="secondary" busy={busy === 'token'} disabled={!available || !!busy || !token.trim()} onClick={saveToken}>保存令牌</Button></div>
        <div className="row action-row"><Button className="secondary" busy={busy === 'catalog'} disabled={!available || !!busy || !credentialConfigured}
          onClick={checkCatalog}>检查可用版本</Button>
          <Button busy={busy === 'install'} disabled={!available || !!busy || !!installing || !credentialConfigured || !targets.length}
            onClick={install}>安装 BabelDOC</Button></div>
        {catalog && <div role="status"><p className="hint">发布目录 {catalog.releaseTag || '已读取'} · 服务会选择与运行环境匹配的构建：</p>
          {targets.length ? <ul>{targets.map(item => <li key={`${item.id}-${item.version}-${item.platform}-${item.arch}`}>
            {item.version} · {item.platform}/{item.arch} · 总大小 {sizeMiB(item.size)}</li>)}</ul> :
            <p className="hint">此发布目录没有 BabelDOC 构建。</p>}</div>}
        <div className="credential-form"><label>components-manifest.json 的服务器路径
          <input value={localPath} disabled={!available || !!busy || !!installing} onChange={event => setLocalPath(event.target.value)}
            placeholder="填写运行服务的电脑上的完整路径"/></label><span className="hint">组件包与资源归档须与清单放在同一目录。</span>
          <Button className="secondary" busy={busy === 'local'} disabled={!available || !!busy || !!installing || !localPath.trim()}
            onClick={installLocal}>从本地包安装</Button></div>
        {task && <div className="notice" role="status">{taskLabels[task.state] ?? task.state}{progressText ? ` · ${progressText}` : ''}
          {installing && <Button className="ghost" busy={busy === 'cancel'} disabled={!available || !!busy} onClick={cancel}>取消安装</Button>}</div>}
        {task?.error && <p className="hint" role="alert">{typeof task.error === 'string' ? task.error : task.error.message}</p>}
        {message && <div className="notice success" role="status">{message}</div>}
        {ErrorBox ? <ErrorBox message={error}/> : error && <div className="notice error" role="alert">{error}</div>}
      </section>
      <section className="settings-card"><h3>使用范围</h3><p>当前 PDF 功能面向原生文本英文 PDF → 中文单语 PDF。模型和翻译密钥在“模型”页设置。</p>
        <p>安装完成后请手动重启服务。<a href={guide} target="_blank" rel="noreferrer">查看 PDF 使用说明 ↗</a></p></section>
    </> : <section className="settings-card"><h3>准备与启动</h3>
      <p>当前支持原生文本英文 PDF → 中文单语 PDF。模型和密钥在“模型”页管理。</p>
      <p>此服务未启用组件安装管理。现有 PDF 配置可继续使用；需要安装说明时，请查看
        <a href={guide} target="_blank" rel="noreferrer"> PDF 使用说明 ↗</a>。</p>
      <p className="hint">更改组件配置后，请手动重启服务。</p></section>}
  </div>
}
