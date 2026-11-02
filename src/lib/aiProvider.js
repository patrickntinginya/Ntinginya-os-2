// The user's AI provider choice: automatic (default) | gemini | openrouter.
// It is only a PREFERENCE sent with each request. The server decides what is configured, never lets this name an
// address or a model, and treats any unknown value as automatic. Nothing secret is stored here.
export const AI_SELECTIONS = ['auto', 'gemini', 'openrouter']
export const AI_SELECTION_KEY = 'life-os-ai-provider'

export const normalizeAiSelection = (v) => (AI_SELECTIONS.includes(v) ? v : 'auto')

const store = () => { try { return globalThis.localStorage || null } catch { return null } }

export function getAiSelection(storage = store()) {
  try { return normalizeAiSelection(storage?.getItem(AI_SELECTION_KEY)) } catch { return 'auto' }
}

export function setAiSelection(value, storage = store()) {
  const v = normalizeAiSelection(value)
  try { storage?.setItem(AI_SELECTION_KEY, v) } catch { /* private mode / quota: the choice just is not remembered */ }
  return v
}

/** Choices to show: Automatic plus only the providers the server reports as configured. */
export function selectableProviders(status) {
  const names = (status?.providers || []).map((p) => p.name).filter((n) => AI_SELECTIONS.includes(n) && n !== 'auto')
  return names.length ? ['auto', ...names] : []
}

/** A stored choice that the server no longer offers falls back to automatic instead of failing every request. */
export const effectiveSelection = (value, status) => {
  const v = normalizeAiSelection(value)
  return selectableProviders(status).includes(v) ? v : 'auto'
}
