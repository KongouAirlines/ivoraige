import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import { settingsPageId } from './settings-navigation.mjs'

export function SettingsWindow({ runtime, path, navigate, close, onGuardChange, refreshKey,
  confirmDiscard, confirmation, answerConfirmation,
  capabilities, refreshCapabilities, api, useRemote, Button, ErrorBox }) {
  const pages = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const dialog = useRef(null)
  const cancelButton = useRef(null)
  const lastPage = useRef(null)
  const id = settingsPageId(path)
  const active = pages.find(page => page.id === id)
  if (active) lastPage.current = active
  const retained = !active && lastPage.current?.id === id ? lastPage.current : null
  const page = active || retained
  const Page = page?.component
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.documentElement.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  useEffect(() => {
    if (!id && pages.length) navigate(`/settings/${pages[0].id}`, { replace: true, confirmed: true })
  }, [id, pages, navigate])
  useEffect(() => {
    if (!confirmation) return
    const previousFocus = document.activeElement
    cancelButton.current?.focus()
    return () => { if (previousFocus?.isConnected) previousFocus.focus() }
  }, [confirmation])
  return <dialog ref={dialog} className="settings-window" aria-labelledby="settings-title"
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const area = confirmation ? dialog.current.querySelector('.settings-confirm') : dialog.current
      const targets = [...area.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter(element => element.getClientRects().length && !element.closest('[inert]'))
      const first = targets[0], last = targets.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !area.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !area.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }}
    onCancel={event => { event.preventDefault(); confirmation ? answerConfirmation(false) : close() }}>
    <div className="settings-main" inert={confirmation ? '' : undefined}>
    <header className="settings-window-header"><div><span className="eyebrow">PREFERENCES</span><h1 id="settings-title">设置</h1></div>
      <button className="icon-button" aria-label="关闭设置" onClick={close}>×</button></header>
    <div className="settings-window-body"><nav className="settings-navigation" aria-label="设置导航">
      {pages.map(item => <button key={item.id} aria-current={item.id === id ? 'page' : undefined}
        onClick={() => navigate(`/settings/${item.id}`)}>{item.label}</button>)}
      {!pages.length && <p className="muted">没有可用的设置页面</p>}
    </nav><section className="settings-content" aria-label={page?.label || '设置内容'}>
      {capabilities.error && <ErrorBox message={capabilities.error}/>}
      {retained && <div role="alert" className="notice error">此设置插件已卸载，已禁止提交。可核对下方未保存内容后返回其他页面。</div>}
      {Page ? <Page key={page.id} api={api} useRemote={useRemote} Button={Button} ErrorBox={ErrorBox}
        available={!!active} onGuardChange={onGuardChange} refreshKey={refreshKey} confirmDiscard={confirmDiscard}
        pagePath={path} onPagePathChange={next => navigate(next, { confirmed: true })}
        capabilities={capabilities.value} refreshCapabilities={refreshCapabilities}/>
        : <div className="settings-empty"><h2>{id ? '设置页面不可用' : '暂无设置页面'}</h2>
          <p>请从侧边栏选择已装配的设置页面，或关闭窗口返回工作台。</p>
          <button onClick={refreshCapabilities}>刷新页面状态</button></div>}
    </section></div></div>
    {confirmation && <div className="settings-confirm-overlay"><section className="settings-confirm" role="alertdialog" aria-modal="true" aria-labelledby="settings-confirm-title" aria-describedby="settings-confirm-message">
      <h2 id="settings-confirm-title">未保存的修改</h2><p id="settings-confirm-message">{confirmation}</p>
      <div className="row"><button ref={cancelButton} className="secondary" onClick={() => answerConfirmation(false)}>继续编辑</button>
        <button onClick={() => answerConfirmation(true)}>放弃修改</button></div>
    </section></div>}
  </dialog>
}
