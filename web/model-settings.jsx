import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { emptyModelForm, modelDraftDirty, modelForm, modelSettingsPath, modelSettingsRequest,
  modelSettingsView, formForPresetChoice, sharedRouteModels, shouldReplaceModelDraft,
  mayApplyModelRead, savedModelPathAfterSave, formForProviderChange,
  formForModelChange } from './model-settings-state.mjs'

const LIST_PATH = '/settings/models'

export function Settings({ api, useRemote, Button, ErrorBox, onGuardChange,
  available = true, refreshKey = 0, pagePath = LIST_PATH, onPagePathChange, confirmDiscard }) {
  const [settings, setSettings] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [readTick, setReadTick] = useState(0)
  const data = { value: settings, error: loadError, setValue: setSettings }
  const view = modelSettingsView(pagePath)
  const viewKey = JSON.stringify(view)
  const [form, setForm] = useState(emptyModelForm)
  const [baseline, setBaseline] = useState(emptyModelForm)
  const [presetId, setPresetId] = useState('')
  const [tab, setTab] = useState('model')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadNeeded, setReloadNeeded] = useState(false)
  const [draftRevisions, setDraftRevisions] = useState(null)
  const initializedView = useRef('')
  const successNavigation = useRef('')
  const mountedView = useRef(false)
  const requestVersion = useRef(0)
  const alive = useRef(true)
  const availableRef = useRef(available)
  availableRef.current = available
  const confirmRef = useRef(false)
  const currentView = useRef(viewKey)
  currentView.current = viewKey

  useEffect(() => () => { alive.current = false; requestVersion.current += 1 }, [])
  useEffect(() => {
    if (!available) return
    let current = true
    const startedVersion = requestVersion.current
    const startedView = viewKey
    const canApply = () => mayApplyModelRead({ active: current, available: availableRef.current,
      startedVersion, currentVersion: requestVersion.current, startedView, currentView: currentView.current })
    api('/settings/modelconfig').then(result => {
      if (canApply()) { setSettings(result.settings); setLoadError('') }
    }, failure => { if (canApply()) setLoadError(failure.message) })
    return () => { current = false }
  }, [api, available, refreshKey, readTick])
  useEffect(() => {
    if (!available) {
      requestVersion.current += 1
      setSecret('')
      setBusy('')
    }
  }, [available])
  useEffect(() => {
    if (mountedView.current) requestVersion.current += 1
    else mountedView.current = true
    const keepSuccess = successNavigation.current === viewKey
    successNavigation.current = ''
    setSecret(''); setBusy(''); setError(''); if (!keepSuccess) setMessage('')
    setReloadNeeded(false); setTab('model')
  }, [viewKey])
  useEffect(() => {
    if (!shouldReplaceModelDraft({ available, settings, initializedView: initializedView.current,
      viewKey, form, baseline, secret })) return
    const next = view.kind === 'edit' ? modelForm(settings, view.provider, view.model) : emptyModelForm()
    initializedView.current = viewKey
    setForm(next); setBaseline(next); setDraftRevisions(settings.revisions); setPresetId('')
  }, [settings, viewKey, available])

  const dirty = view.kind !== 'list' && modelDraftDirty(form, baseline, secret)
  useLayoutEffect(() => { onGuardChange?.({ dirty, busy: !!busy || confirming }) }, [dirty, busy, confirming, onGuardChange])
  useLayoutEffect(() => () => onGuardChange?.({ dirty: false, busy: false }), [onGuardChange])
  useEffect(() => {
    if (!dirty && !busy && !confirming) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy, confirming])

  const guard = async () => {
    if (busy || confirmRef.current) return false
    if (!dirty) return true
    confirmRef.current = true
    setConfirming(true)
    try {
      const approved = await confirmDiscard?.(secret
        ? '有未保存的模型设置和凭据输入。离开将丢弃这些内容，确定继续吗？'
        : '有未保存的模型设置。离开将丢弃这些内容，确定继续吗？')
      return alive.current && availableRef.current && !!approved
    } finally {
      confirmRef.current = false
      if (alive.current) setConfirming(false)
    }
  }
  const go = async next => {
    if (!(await guard())) return
    requestVersion.current += 1
    setSecret('')
    initializedView.current = ''
    onPagePathChange?.(next)
  }
  const update = (field, value) => {
    if (['provider', 'credentialRef'].includes(field)) setSecret('')
    if (['provider', 'model'].includes(field)) setPresetId('')
    setError(''); setMessage('')
    setForm(current => field === 'provider'
      ? formForProviderChange(data.value, data.value?.presets ?? [], current, value)
      : field === 'model'
        ? formForModelChange(data.value, current, value)
        : { ...current, [field]: value })
  }
  const presets = data.value?.presets ?? []
  const preset = presets.find(item => item.id === presetId)
  const providerPreset = presets.find(item => item.defaults.provider === form.provider)
  const activePreset = preset ?? providerPreset
  const catalogModel = activePreset?.models?.find(item => item.id === form.model)
  const choosePreset = async id => {
    if (!(await guard())) return
    setPresetId(id); setSecret('')
    const selected = presets.find(item => item.id === id)
    setForm(selected ? formForPresetChoice(data.value, selected) : emptyModelForm())
    setMessage(''); setError('')
  }
  const reload = async () => {
    if (!available || busy || !(await guard())) return
    const version = ++requestVersion.current
    setBusy('reload'); setError('')
    try {
      const settings = (await api('/settings/modelconfig')).settings
      if (!alive.current || version !== requestVersion.current || currentView.current !== viewKey) return
      data.setValue(settings)
      setLoadError('')
      const next = view.kind === 'edit' ? modelForm(settings, view.provider, view.model) : emptyModelForm()
      setForm(next); setBaseline(next); setDraftRevisions(settings.revisions); setSecret(''); setPresetId('')
      setReloadNeeded(false)
      setMessage('已重新读取设置；请核对后再保存。')
    } catch (failure) {
      if (alive.current && version === requestVersion.current) setError(failure.message)
    } finally { if (alive.current && version === requestVersion.current) setBusy('') }
  }
  const save = async select => {
    if (!available || busy || confirmRef.current || !data.value || !draftRevisions) return
    let body
    try { body = modelSettingsRequest(form, draftRevisions, select) }
    catch (failure) { setError(failure.message); return }
    const version = ++requestVersion.current
    setBusy(select ? 'save-select' : 'save'); setError(''); setMessage('')
    try {
      const result = await api('/settings/modelconfig', { method: 'PATCH', body })
      if (!alive.current || version !== requestVersion.current || currentView.current !== viewKey) return
      data.setValue(result.settings)
      setLoadError('')
      const next = modelForm(result.settings, form.provider, form.model)
      setForm(next); setBaseline(next); setDraftRevisions(result.settings.revisions); setReloadNeeded(false)
      setMessage(select ? '模型已保存，并设为当前翻译模型。' : '模型已保存；当前翻译模型保持原选择。')
      const target = savedModelPathAfterSave(view, form)
      if (target) {
        successNavigation.current = JSON.stringify(modelSettingsView(target))
        onPagePathChange?.(target)
      }
    } catch (failure) {
      if (!alive.current || version !== requestVersion.current || currentView.current !== viewKey) return
      const partial = !!failure.details?.partialSave
      const stale = failure.code === 'CONFLICT'
      setReloadNeeded(partial || stale)
      setError(partial
        ? `提供商配置已写入，但模型记录${select ? '和当前选择' : ''}尚未完成写入。重读后模型仍可能出现在列表中；请核对设置与当前选择。${failure.message}`
        : stale ? `设置已在别处变更。${failure.message} 请重新读取并核对后再保存。` : failure.message)
    } finally { if (alive.current && version === requestVersion.current) setBusy('') }
  }
  const select = async item => {
    if (!available || busy || confirmRef.current || !data.value) return
    const version = ++requestVersion.current
    setBusy('select'); setError(''); setMessage('')
    try {
      const result = await api('/settings/modelconfig', { method: 'PATCH', body: {
        provider: item.provider, model: item.model, selectOnly: true,
        selectedRevision: data.value.revisions.selected,
      } })
      if (!alive.current || version !== requestVersion.current || currentView.current !== viewKey) return
      data.setValue(result.settings)
      setLoadError('')
      setMessage(`当前翻译模型：${item.provider} / ${item.model}`)
    } catch (failure) {
      if (!alive.current || version !== requestVersion.current || currentView.current !== viewKey) return
      setError(failure.message)
      setReloadNeeded(failure.code === 'CONFLICT')
    } finally { if (alive.current && version === requestVersion.current) setBusy('') }
  }
  const saveSecret = async () => {
    if (!available || busy || confirmRef.current || !secret || !form.credentialRef) return
    const version = ++requestVersion.current
    setBusy('secret'); setError(''); setMessage('')
    try {
      await api('/settings/credentials', { method: 'PUT', body: { ref: form.credentialRef, value: secret } })
      if (!alive.current || version !== requestVersion.current || currentView.current !== viewKey) return
      setSecret('')
      setMessage('凭据已保存。')
      try {
        const refreshed = (await api('/settings/modelconfig')).settings
        if (alive.current && version === requestVersion.current && currentView.current === viewKey) {
          data.setValue(refreshed)
          setLoadError('')
        }
      } catch (failure) {
        if (alive.current && version === requestVersion.current) {
          setError(`凭据已保存，但状态刷新失败：${failure.message}。请重新读取设置。`)
          setReloadNeeded(true)
        }
      }
    } catch (failure) {
      if (alive.current && version === requestVersion.current && currentView.current === viewKey) setError(failure.message)
    } finally { if (alive.current && version === requestVersion.current) setBusy('') }
  }

  const selected = data.value?.selected
  const canSave = !!(form.provider.trim() && form.model.trim() && Number(form.timeoutMs) > 0) &&
    !busy && !confirming && !reloadNeeded && available
  const credentialStatus = data.value?.credentials?.[form.provider]
  const affected = sharedRouteModels(data.value, form.provider)
  const identityChanged = view.kind === 'edit' &&
    (view.provider !== form.provider || view.model !== form.model)
  const retryRead = () => { setLoadError(''); setReadTick(value => value + 1) }

  return <div className="model-settings">
    {!available && <div className="notice error" role="alert">模型设置组件已卸载，当前不可保存。非秘密输入保留供核对。</div>}
    <ErrorBox message={error || data.error} onRetry={!error && data.error && available ? retryRead : undefined}/>
    {reloadNeeded && <Button className="secondary" disabled={!available || !!busy || confirming} onClick={reload}>重新读取设置</Button>}
    {message && <div className="notice success" role="status">{message}</div>}
    {!data.value ? <div className="skeleton">{!available ? '模型设置组件已卸载，无法读取设置。'
      : data.error ? '设置读取失败。请点击重试。' : '正在读取设置…'}</div> : view.kind === 'list' ? <>
      <div className="settings-heading"><h2>已保存的模型</h2><p>当前翻译模型：{selected ? `${selected.provider} / ${selected.model}` : '尚未选择'}</p></div>
      <div className="row model-settings-actions"><Button className="primary" disabled={!available || !!busy || confirming} onClick={() => go(modelSettingsPath())}>添加模型</Button></div>
      {(data.value.savedModels ?? []).map(item => {
        const active = selected?.provider === item.provider && selected?.model === item.model
        const credential = data.value.credentials?.[item.provider]
        return <div className="saved-model" key={JSON.stringify([item.provider, item.model])}>
          <div><strong>{item.model}</strong><small>{item.provider} · {credential?.exists || credential?.configured ? '凭据已配置' : '凭据未配置'}{active ? ' · 当前翻译模型' : ''}</small></div>
          <div className="row"><Button className="secondary" disabled={!available || !!busy || confirming} onClick={() => go(modelSettingsPath(item.provider, item.model))}>查看／编辑</Button>
            <Button className="secondary" disabled={!available || active || !!busy || confirming || reloadNeeded} onClick={() => select(item)}>用于翻译</Button></div>
        </div>
      })}
      {!data.value.savedModels?.length && <p className="muted">尚无已保存模型。添加模型后可选择用于翻译。</p>}
    </> : <>
      <div className="settings-heading"><button className="link" disabled={!!busy || confirming} onClick={() => go(LIST_PATH)}>← 返回模型列表</button>
        <h2>{view.kind === 'new' ? '添加模型' : `编辑 ${view.model}`}</h2>
        <p>按模型、提供商和凭据分组编辑；同一提供商的模型共享端点和凭据设置。</p></div>
      {identityChanged && <p className="hint">更改提供商标识或模型 ID 会保存为另一个模型；原模型仍保留在列表中。</p>}
      <nav className="tabs" aria-label="模型设置分类">
        {[['model', '模型'], ['provider', '提供商'], ['credential', '凭据']].map(([id, label]) =>
          <button key={id} type="button" aria-pressed={tab === id} disabled={confirming} className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {tab === 'model' && <div>
        {view.kind === 'new' && <label className="preset-picker">提供商预设<select value={presetId} disabled={!available || !!busy || confirming} onChange={event => choosePreset(event.target.value)}>
          <option value="">手动配置</option>{presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        {activePreset?.note && <p className="hint">{activePreset.note}</p>}
        <fieldset className="model-fields" disabled={!available || !!busy || confirming}><div className="form-grid">
          <label>提供商标识<input value={form.provider} onChange={event => update('provider', event.target.value)} placeholder="例如 deepseek"/></label>
          <label>模型 ID<input list="model-suggestions" value={form.model} onChange={event => update('model', event.target.value)} placeholder="服务实际支持的模型 ID"/>
            <datalist id="model-suggestions">{activePreset?.models?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></label>
          <label>请求超时 (ms)<input type="number" min="1" value={form.timeoutMs} onChange={event => update('timeoutMs', event.target.value)}/></label>
          <label>上下文窗口<input type="number" min="1" value={form.contextWindow} onChange={event => update('contextWindow', event.target.value)} placeholder={catalogModel ? '可使用目录默认' : '自定义模型填写实际容量'}/></label>
          <label>最大 token<input type="number" min="1" value={form.maxTokens} onChange={event => update('maxTokens', event.target.value)} placeholder={catalogModel ? '可使用目录默认' : '自定义模型填写实际容量'}/></label>
        </div></fieldset>
      </div>}
      {tab === 'provider' && <div>
        <p className="hint">修改提供商配置会影响以下已保存模型：{affected.length ? affected.map(item => item.model).join('、') : '尚无已保存模型'}。</p>
        <fieldset className="model-fields" disabled={!available || !!busy || confirming}><div className="form-grid">
          <label>提供商标识<input value={form.provider} onChange={event => update('provider', event.target.value)} placeholder="例如 deepseek"/></label>
          <label>API 类型<input value={form.api} onChange={event => update('api', event.target.value)} placeholder={catalogModel ? `目录默认：${catalogModel.api}` : '例如 openai-completions'}/></label>
          <label>端点 URL<input value={form.baseURL} onChange={event => update('baseURL', event.target.value)} placeholder={catalogModel ? `目录默认：${catalogModel.baseURL}` : '自定义端点 URL'}/></label>
          <label>凭据引用<input value={form.credentialRef} onChange={event => update('credentialRef', event.target.value)} placeholder="例如 DEEPSEEK_API_KEY"/></label>
          <label>推理模式<input value={form.reasoning} onChange={event => update('reasoning', event.target.value)} placeholder="可选，例如 off"/></label>
          <label>Thinking 格式<input value={form.thinkingFormat} onChange={event => update('thinkingFormat', event.target.value)} placeholder="内置目录默认"/></label>
        </div></fieldset>
      </div>}
      {tab === 'credential' && <div>
        <p>凭据由内核保存，模型配置只引用名称。凭据保存成功后输入立即清空。</p>
        <p className="credential"><code>{form.credentialRef || '尚未填写凭据引用'}</code><span>{credentialStatus?.exists || credentialStatus?.configured ? '✓ 已配置' : '○ 尚未配置'}</span></p>
        {activePreset?.placeholderCredential && <p><button className="link" disabled={!available || !!busy || confirming} onClick={() => setSecret(activePreset.placeholderCredential)}>填入本地占位凭据 local</button>，然后保存凭据。</p>}
        <div className="credential-form"><label>凭据引用<input disabled={!available || !!busy || confirming} value={form.credentialRef} onChange={event => update('credentialRef', event.target.value)}/></label>
          <label>API Key<input disabled={!available || !!busy || confirming} type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder="输入后保存"/></label>
          <Button className="secondary" busy={busy === 'secret'} disabled={!available || !!busy || confirming || !secret || !form.credentialRef} onClick={saveSecret}>保存凭据</Button></div>
      </div>}
      <div className="row model-settings-actions"><Button className="secondary" busy={busy === 'save'} disabled={!canSave} onClick={() => save(false)}>仅保存</Button>
        <Button className="primary" busy={busy === 'save-select'} disabled={!canSave} onClick={() => save(true)}>保存并用于翻译</Button>
        <Button className="ghost" disabled={!!busy || confirming} onClick={() => go(LIST_PATH)}>取消</Button></div>
    </>}
  </div>
}
