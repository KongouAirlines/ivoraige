// Browser-safe subscription-first state synchronization. Notifications only
// invalidate: state is always read from the authoritative, active session.
const sameScope = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) ===
  JSON.stringify(Object.entries(b ?? {}).sort())
const validRevision = value => Number.isSafeInteger(value) && value >= 0

export function createStateSync({ connect, snapshot, onState, onStatus = () => {}, scope = {},
  retryMs = 500, maxBuffer = 128 } = {}) {
  if (![connect, snapshot, onState, onStatus].every(value => typeof value === 'function') ||
      !Number.isFinite(retryMs) || retryMs < 0 || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1)
    throw new TypeError('State synchronization requires transport, snapshot and application callbacks')
  const queryScope = structuredClone(scope)
  let stopped = false, active, timer, status = 'connecting', current, failures = 0
  function setStatus(value) {
    status = value
    try { onStatus(value) } catch { /* diagnostics do not own the transport */ }
  }
  function disposeConnection(connection) {
    connection?.controller.abort()
    try { connection?.close?.() } catch { /* continue invalidation */ }
  }
  function invalidate(connection) {
    if (stopped || active !== connection) return
    active = undefined
    disposeConnection(connection)
    setStatus('resync-required')
    if (timer === undefined) timer = setTimeout(() => {
      timer = undefined
      begin()
    }, Math.min(retryMs * 2 ** Math.min(failures++, 6), 30000))
  }
  function notice(connection, value) {
    if (stopped || active !== connection) return
    if (!connection.ready) {
      if (connection.early.length >= maxBuffer) { invalidate(connection); return }
      connection.early.push(value)
      return
    }
    const ready = connection.ready
    if (value?.subscriptionId !== ready.subscriptionId) return // delayed old transport message
    if (value.generation !== ready.generation || !sameScope(value.scope, ready.scope) ||
        value.type === 'resync-required' || !validRevision(value.stateRevision)) {
      invalidate(connection)
      return
    }
    if (value.stateRevision <= connection.revision) return
    connection.pending.add(value.stateRevision)
    if (connection.pending.size > maxBuffer) { invalidate(connection); return }
    setStatus('synchronizing')
    void refresh(connection)
  }
  async function refresh(connection) {
    if (connection.reading || stopped || active !== connection || !connection.ready) return
    connection.reading = true
    try {
      do {
        const value = await snapshot(structuredClone(connection.ready), { signal: connection.controller.signal })
        if (stopped || active !== connection) return
        if (value?.subscriptionId !== connection.ready.subscriptionId ||
            value.generation !== connection.ready.generation || !sameScope(value.scope, connection.ready.scope) ||
            !validRevision(value.stateRevision) || value.stateRevision < connection.ready.barrierRevision ||
            value.stateRevision < connection.revision) {
          invalidate(connection)
          return
        }
        // Application may be asynchronous. The same subscription keeps buffering
        // throughout; applying r never discards notifications newer than r.
        await onState(structuredClone(value))
        if (stopped || active !== connection) return
        current = structuredClone(value)
        connection.revision = value.stateRevision
        for (const revision of connection.pending) if (revision <= connection.revision) connection.pending.delete(revision)
      } while (connection.pending.size)
      failures = 0
      setStatus('synchronized')
      // A consumer callback can synchronously observe another committed state.
      // Its notice arrived while reading was still true; preserve that final
      // invalidation even when no later producer event will wake us.
      if (connection.pending.size && !stopped && active === connection) setStatus('synchronizing')
    } catch {
      invalidate(connection)
    } finally {
      connection.reading = false
      if (!stopped && active === connection && connection.pending.size)
        queueMicrotask(() => { void refresh(connection) })
    }
  }
  function ready(connection, value) {
    if (stopped || active !== connection) return
    if (!value || typeof value.subscriptionId !== 'string' || typeof value.generation !== 'string' ||
        !validRevision(value.barrierRevision) || !sameScope(value.scope, queryScope)) {
      invalidate(connection)
      return
    }
    if (connection.ready) { invalidate(connection); return }
    connection.ready = structuredClone(value)
    connection.revision = -1
    setStatus('synchronizing')
    for (const value of connection.early.splice(0)) notice(connection, value)
    void refresh(connection)
  }
  function begin() {
    if (stopped) return
    setStatus('connecting')
    const connection = { controller: new AbortController(), pending: new Set(), early: [], reading: false }
    active = connection
    try {
      connection.close = connect({ scope: structuredClone(queryScope),
        onReady: value => ready(connection, value), onNotice: value => notice(connection, value),
        onDisconnect: () => invalidate(connection) })
      if (typeof connection.close !== 'function') throw new TypeError('connect must return a disposer')
      if (stopped || active !== connection) disposeConnection(connection)
    } catch { invalidate(connection) }
  }
  begin()
  return {
    get status() { return status },
    get current() { return current === undefined ? undefined : structuredClone(current) },
    stop() {
      if (stopped) return
      stopped = true
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      const connection = active
      active = undefined
      disposeConnection(connection)
      setStatus('closed')
    },
  }
}
