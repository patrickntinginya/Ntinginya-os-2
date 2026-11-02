// Translation core. Pure JavaScript (no React) so it can be unit-tested and used from plain helpers.
//
// Two ways to translate:
//   t('nav.home')                  dotted KEY, looked up in en.js / sw.js (used for new and structured text)
//   tr('Save', {name: 'x'})        English PHRASE, looked up in sw.phrases.js (used for existing screens)
// Both fall back to English when a Kiswahili entry is missing, so a gap shows English instead of a blank.
// {placeholders} are filled from `params`. Do not translate database field names, ids or code identifiers.
import en from './en.js'
import sw from './sw.js'
import swPhrases from './sw.phrases.js'

export const LANGS = [
  { code: 'sw', label: 'Kiswahili', short: 'SW', flag: '🇹🇿', locale: 'sw-TZ' },
  { code: 'en', label: 'English', short: 'EN', flag: '🇬🇧', locale: 'en-GB' },
]
export const DEFAULT_LANG = 'sw' // first-time users see Kiswahili; they can switch at any time
export const STORAGE_KEY = 'life-os-lang'
export const catalogs = { en, sw }
export const phrases = { sw: swPhrases }

export const isLang = (code) => LANGS.some((l) => l.code === code)
export const localeOf = (code) => (LANGS.find((l) => l.code === code) || LANGS[1]).locale

// The active language is module state so plain helpers (date formatting, error messages) can translate without React.
// It starts as 'en' so unit tests of the calculation code see English; the app sets the real value at startup.
let active = 'en'
export const getLang = () => active
export const setActiveLang = (code) => {
  active = isLang(code) ? code : DEFAULT_LANG
}

export function fill(text, params) {
  if (!params) return text
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])))
}

export function t(key, params, lang = active) {
  const text = catalogs[lang]?.[key] ?? catalogs.en[key] ?? key
  return fill(text, params)
}

export function tr(text, params, lang = active) {
  if (typeof text !== 'string' || !text) return text
  const hit = lang === 'en' ? undefined : phrases[lang]?.[text]
  return fill(hit ?? text, params)
}

/** Reads the saved language. `storage` is injectable for tests; a blocked or empty store falls back to the default. */
export function readStoredLang(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(STORAGE_KEY)
    return isLang(v) ? v : null
  } catch {
    return null
  }
}

export function storeLang(code, storage = globalThis.localStorage) {
  if (!isLang(code)) return false
  try {
    storage?.setItem(STORAGE_KEY, code)
    return true
  } catch {
    return false
  }
}

export const initialLang = (storage) => readStoredLang(storage) || DEFAULT_LANG

/** '3 tasks' / '1 task'. Translated as a whole phrase ('{n} task' / '{n} tasks'), so word order can differ per language. */
export const plural = (n, one, many = `${one}s`) => tr(`{n} ${n === 1 ? one : many}`, { n })
