// A response belongs to the view and request that started it. Dirty edits keep
// their original revision base until the user saves or discards them.
export function refreshDisposition(request, latestRequest, view, activeView, dirty) {
  if (request !== latestRequest || view !== activeView) return { apply: false, replaceEditor: false }
  return { apply: true, replaceEditor: !dirty }
}

export function savedEditIsCurrent(view, activeView, version, activeVersion) {
  return view === activeView && version === activeVersion
}
