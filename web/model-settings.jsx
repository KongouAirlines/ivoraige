import React, { useEffect, useRef, useState } from 'react'
import { emptyModelForm, modelForm, presetForm, modelSettingsRequest } from './model-settings-state.mjs'

export function Settings({ api, useRemote, Button, ErrorBox }) {
  const data = useRemote(() => api('/settings/modelconfig').then(result => result.settings), [])
  const initialized = useRef(false)
  const [form, setForm] = useState(emptyModelForm)
  const [presetId, setPresetId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (data.value && !initialized.current) {
      initialized.current = true
      setForm(modelForm(data.value))
    }
  }, [data.value])

  const presets = data.value?.presets ?? []
  const preset = presets.find(item => item.id === presetId)
  const providerPreset = presets.find(item => item.defaults.provider === form.provider)
  const catalogModel = (preset || providerPreset)?.models?.find(item => item.id === form.model)
  const update = (field, value) => {
    if (['provider', 'credentialRef'].includes(field)) setSecret('')
    if (['provider', 'model'].includes(field)) setPresetId('')
    setError('')
    setMessage('')
    setForm(current => ({ ...current, [field]: value,
      ...(['provider', 'model'].includes(field) ? { reasoningEfforts: null } : {}) }))
  }
  const choosePreset = id => {
    setPresetId(id)
    setSecret('')
    const selected = presets.find(item => item.id === id)
    if (selected) setForm(presetForm(selected))
    setMessage('')
    setError('')
  }
  const edit = item => {
    setForm(modelForm(data.value, item.provider, item.model))
    setPresetId('')
    setSecret('')
    setMessage('')
    setError('')
  }
  const save = async select => {
    setBusy(select ? 'save-select' : 'save'); setError(''); setMessage('')
    try {
      const result = await api('/settings/modelconfig', { method: 'PATCH',
        body: modelSettingsRequest(form, data.value.revisions, select) })
      data.setValue(result.settings)
      setForm(modelForm(result.settings, form.provider, form.model))
      setMessage(select ? '模型已保存，并设为当前翻译模型。' : '模型已保存到列表；当前翻译模型保持原选择。')
    } catch (failure) { setError(failure.message) } finally { setBusy('') }
  }
  const select = async item => {
    setBusy('select'); setError(''); setMessage('')
    try {
      const result = await api('/settings/modelconfig', { method: 'PATCH', body: {
        provider: item.provider, model: item.model, selectOnly: true,
        selectedRevision: data.value.revisions.selected,
      } })
      data.setValue(result.settings)
      setMessage(`当前翻译模型：${item.provider} / ${item.model}`)
    } catch (failure) { setError(failure.message) } finally { setBusy('') }
  }
  const saveSecret = async () => {
    setBusy('secret'); setError(''); setMessage('')
    try {
      await api('/settings/credentials', { method: 'PUT', body: { ref: form.credentialRef, value: secret } })
      setSecret('')
      data.setValue((await api('/settings/modelconfig')).settings)
      setMessage('凭据已保存。')
    } catch (failure) { setError(failure.message) } finally { setBusy('') }
  }
  const selected = data.value?.selected
  const canSave = !!(form.provider && form.model && form.timeoutMs) && !busy
  return <div className="page narrow">
    <div className="page-head"><div><span className="eyebrow">PREFERENCES</span><h1>设置</h1>
      <p>保存多个提供商和模型，选择一个用于当前文档翻译。</p></div></div>
    <ErrorBox message={data.error || error}/>
    {message && <div className="notice success">{message}</div>}
    {!data.value ? <div className="skeleton">正在读取设置…</div> : <>
      <section className="settings-card">
        <div className="settings-heading"><span className="eyebrow">01 / SAVED MODELS</span><h2>已保存的模型</h2>
          <p>当前翻译模型：{selected ? `${selected.provider} / ${selected.model}` : '尚未选择'}</p></div>
        {(data.value.savedModels ?? []).map(item => {
          const active = selected?.provider === item.provider && selected?.model === item.model
          return <div className="saved-model" key={JSON.stringify([item.provider, item.model])}>
            <div><strong>{item.model}</strong><small>{item.provider}{active ? ' · 当前翻译模型' : ''}</small></div>
            <div className="row"><Button className="secondary" disabled={!!busy} onClick={() => edit(item)}>编辑</Button>
              <Button className="secondary" disabled={active || !!busy} onClick={() => select(item)}>用于翻译</Button></div>
          </div>
        })}
        {!data.value.savedModels?.length && <p className="muted">尚无已保存模型。选择下面的预设或手动添加。</p>}
        <Button className="secondary" disabled={!!busy} onClick={() => { setForm(emptyModelForm()); setPresetId(''); setSecret(''); setMessage(''); setError('') }}>添加模型</Button>
      </section>
      <section className="settings-card">
        <div className="settings-heading"><span className="eyebrow">02 / MODEL</span><h2>模型与端点</h2>
          <p>同一提供商标识下的模型共享端点和凭据；不同账号或端点请使用不同标识。</p></div>
        <label className="preset-picker">提供商预设<select value={presetId} disabled={!!busy} onChange={event => choosePreset(event.target.value)}>
          <option value="">手动配置／已保存配置</option>{presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        {(preset || providerPreset)?.note && <p className="hint">{(preset || providerPreset).note}</p>}
        <fieldset disabled={!!busy} className="model-fields"><div className="form-grid">
          <label>提供商标识<input value={form.provider} onChange={event => update('provider', event.target.value)} placeholder="例如 deepseek"/></label>
          <label>模型 ID<input list="model-suggestions" value={form.model} onChange={event => update('model', event.target.value)} placeholder="填写服务实际支持的模型 ID"/>
            <datalist id="model-suggestions">{(preset || providerPreset)?.models?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></label>
          <label>API 类型<input value={form.api} onChange={event => update('api', event.target.value)} placeholder={catalogModel ? `目录默认：${catalogModel.api}` : '自定义端点请填写，例如 openai-completions'}/></label>
          <label>端点 URL<input value={form.baseURL} onChange={event => update('baseURL', event.target.value)} placeholder={catalogModel ? `目录默认：${catalogModel.baseURL}` : '自定义端点请填写 URL'}/></label>
          <label>凭据引用<input value={form.credentialRef} onChange={event => update('credentialRef', event.target.value)} placeholder="例如 DEEPSEEK_API_KEY"/></label>
          <label>请求超时 (ms)<input type="number" min="1" value={form.timeoutMs} onChange={event => update('timeoutMs', event.target.value)}/></label>
          <label>推理模式<input value={form.reasoning} onChange={event => update('reasoning', event.target.value)} placeholder="可选，例如 off"/></label>
          <label>Thinking 格式<input value={form.thinkingFormat} onChange={event => update('thinkingFormat', event.target.value)} placeholder="内置目录默认"/></label>
          <label>上下文窗口<input type="number" min="1" value={form.contextWindow} onChange={event => update('contextWindow', event.target.value)} placeholder="内置目录默认；自定义模型填写实际容量"/></label>
          <label>最大 token<input type="number" min="1" value={form.maxTokens} onChange={event => update('maxTokens', event.target.value)} placeholder="内置目录默认；自定义模型填写实际容量"/></label>
        </div></fieldset>
        <div className="row"><Button className="secondary" busy={busy === 'save'} disabled={!canSave} onClick={() => save(false)}>保存到模型列表</Button>
          <Button className="primary" busy={busy === 'save-select'} disabled={!canSave} onClick={() => save(true)}>保存并用于翻译</Button></div>
      </section>
      <section className="settings-card">
        <div className="settings-heading"><span className="eyebrow">03 / CREDENTIAL</span><h2>凭据</h2>
          <p>凭据由内核保存，配置只引用名称。输入内容保存后立即清空。</p></div>
        {Object.entries(data.value.credentials ?? {}).map(([provider, info]) => <div key={provider} className="credential"><code>{provider}</code>
          <span>{info?.exists || info?.configured ? '✓ 已配置' : '○ 尚未配置'}</span></div>)}
        {(preset || providerPreset)?.placeholderCredential && <p><button className="link" disabled={!!busy} onClick={() => setSecret((preset || providerPreset).placeholderCredential)}>填入本地占位凭据 local</button>，然后点击保存凭据。</p>}
        <div className="credential-form"><label>当前凭据引用<input disabled={!!busy} value={form.credentialRef} onChange={event => update('credentialRef', event.target.value)}/></label>
          <label>API Key<input disabled={!!busy} type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder="输入后保存"/></label>
          <Button className="secondary" busy={busy === 'secret'} disabled={!!busy || !secret || !form.credentialRef} onClick={saveSecret}>保存凭据</Button>
        </div>
      </section>
    </>}
  </div>
}
