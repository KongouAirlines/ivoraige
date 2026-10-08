export const isSettingsPath = path => /^\/settings(?:\/|\?|$)/.test(path)
export const settingsPageId = path => path.split('?')[0].split('/')[2] || ''

export function hashRoute(hash) {
  const path = hash.replace(/^#/, '') || '/'
  if (!path.startsWith('/')) return '/'
  try { decodeURI(path) } catch { return '/' }
  // URLSearchParams owns query decoding. Decoding here too corrupts literal %.
  return path
}

// Settings is an overlay route; its background is a separate, mounted view.
export function settingsLocation(previous, path) {
  return { path, background: isSettingsPath(path) ? previous.background : path }
}

export function initialSettingsLocation(path) {
  return { path, background: isSettingsPath(path) ? '/' : path }
}

const HISTORY_KEY = '__ivoraigeSettings'

export function readSettingsHistory(state) {
  const value = state?.[HISTORY_KEY]
  return Number.isSafeInteger(value?.index) && value.index >= 0
    ? { index: value.index, origin: Number.isSafeInteger(value.origin) ? value.origin : null,
        background: typeof value.background === 'string' ? value.background : '/' }
    : null
}

export function settingsHistoryState(state, meta) {
  return { ...(state && typeof state === 'object' ? state : {}), [HISTORY_KEY]: meta }
}

export function nextSettingsHistory(current, location, next, replace = false) {
  const entering = !isSettingsPath(location.path) && isSettingsPath(next)
  return {
    index: current.index + (replace ? 0 : 1),
    origin: isSettingsPath(next) ? (entering ? current.index : current.origin) : null,
    background: isSettingsPath(next) ? location.background : next,
  }
}

export function reverseSettingsTraversal(current, target) {
  return current.index - target.index
}
