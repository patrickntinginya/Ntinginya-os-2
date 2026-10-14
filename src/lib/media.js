// Safe handling of user-added media links (videos, audio, images). Pure functions + a small storage wrapper.
// Nothing here downloads anything. Videos are only embedded after the user taps play, and never with autoplay.
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com'])
const ID = /^[A-Za-z0-9_-]{11}$/
export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'webm']
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']
export const MAX_ITEMS = 50

export function parseHttps(value) {
  try {
    const u = new URL(String(value || '').trim())
    return u.protocol === 'https:' && !u.username && !u.password ? u : null
  } catch {
    return null
  }
}

/** YouTube video id from watch / youtu.be / embed / shorts links, else null. */
export function youTubeId(value) {
  const u = parseHttps(value)
  if (!u || !YT_HOSTS.has(u.hostname)) return null
  let id = null
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (u.pathname === '/watch') id = u.searchParams.get('v')
  else {
    const m = /^\/(embed|shorts|live)\/([^/?]+)/.exec(u.pathname)
    if (m) id = m[2]
  }
  return id && ID.test(id) ? id : null
}

/** Privacy-friendlier embed address. No autoplay parameter, ever. */
export const youTubeEmbedUrl = (id) => (ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null)
export const youTubeWatchUrl = (id) => (ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null)

const extOf = (u) => (/\.([a-z0-9]{2,5})$/i.exec(u.pathname)?.[1] || '').toLowerCase()

/** Validates a link for a kind. Returns { ok: true, url, meta } or { ok: false, error: <i18n key> }. */
export function validateMedia(kind, url) {
  const u = parseHttps(url)
  if (!u) return { ok: false, error: 'media.err.https' }
  if (kind === 'video') {
    const id = youTubeId(u.href)
    return id ? { ok: true, url: u.href, meta: { youtubeId: id } } : { ok: true, url: u.href, meta: { youtubeId: null } } // other sites: open externally
  }
  if (kind === 'audio') return AUDIO_EXT.includes(extOf(u)) ? { ok: true, url: u.href, meta: {} } : { ok: false, error: 'media.err.audio' }
  if (kind === 'image') return IMAGE_EXT.includes(extOf(u)) ? { ok: true, url: u.href, meta: {} } : { ok: false, error: 'media.err.image' }
  return { ok: false, error: 'media.err.kind' }
}

const keyFor = (scope) => `life-os-motivation:${scope || 'device'}`
const empty = () => ({ items: [], favorites: [] })

export function loadState(storage, scope) {
  try {
    const raw = JSON.parse(storage?.getItem(keyFor(scope)) || 'null')
    if (!raw || typeof raw !== 'object') return empty()
    return {
      items: Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i.id === 'string' && typeof i.url === 'string' && parseHttps(i.url)).slice(0, MAX_ITEMS) : [],
      favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x) => typeof x === 'string').slice(0, 200) : [],
    }
  } catch {
    return empty()
  }
}

export function saveState(storage, scope, state) {
  try {
    storage.setItem(keyFor(scope), JSON.stringify(state))
    return true
  } catch {
    return false // storage full or blocked: the caller shows a message
  }
}

/** Adds a link. Returns { ok, state } or { ok: false, error }. Duplicate URLs are rejected. */
export function addItem(state, { kind, title, url }, newId) {
  const checked = validateMedia(kind, url)
  if (!checked.ok) return checked
  const name = String(title || '').trim().slice(0, 80)
  if (!name) return { ok: false, error: 'media.err.title' }
  if (state.items.length >= MAX_ITEMS) return { ok: false, error: 'media.err.full' }
  if (state.items.some((i) => i.kind === kind && i.url === checked.url)) return { ok: false, error: 'media.err.dup' }
  const item = { id: newId, kind, title: name, url: checked.url, ...(checked.meta.youtubeId ? { youtubeId: checked.meta.youtubeId } : {}) }
  return { ok: true, state: { ...state, items: [...state.items, item] } }
}

export const removeItem = (state, id) => ({ ...state, items: state.items.filter((i) => i.id !== id), favorites: state.favorites.filter((f) => f !== id) })
export const toggleFavorite = (state, id) => ({ ...state, favorites: state.favorites.includes(id) ? state.favorites.filter((f) => f !== id) : [...state.favorites, id] })
