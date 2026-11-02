import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import en from '../src/i18n/en.js'
import sw from '../src/i18n/sw.js'
import swPhrases from '../src/i18n/sw.phrases.js'
import {
  DEFAULT_LANG, LANGS, STORAGE_KEY, fill, initialLang, isLang, localeOf, plural, readStoredLang, setActiveLang, getLang, storeLang, t, tr,
} from '../src/i18n/index.js'
import * as constants from '../src/lib/constants.js'
import { AI_ERROR_TEXT } from '../src/services/aiErrors.js'

const memoryStorage = (initial = {}) => {
  const data = { ...initial }
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) }, data }
}
const sources = () => {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`)
      else if (/\.jsx?$/.test(e.name)) out.push({ file: `${dir}/${e.name}`, text: readFileSync(new URL(`../${dir}/${e.name}`, import.meta.url), 'utf8') })
    }
  }
  walk('src')
  return out
}
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

test('both languages are offered, Kiswahili is the default for first-time users', () => {
  assert.deepEqual(LANGS.map((l) => l.code), ['sw', 'en'])
  assert.equal(DEFAULT_LANG, 'sw')
  assert.equal(initialLang(memoryStorage()), 'sw')
  assert.equal(localeOf('sw'), 'sw-TZ')
})

test('the chosen language persists across refresh, logout/login and reopening (stored outside the session)', () => {
  const store = memoryStorage()
  assert.equal(storeLang('en', store), true)
  assert.equal(store.data[STORAGE_KEY], 'en')
  assert.equal(readStoredLang(store), 'en')
  assert.equal(initialLang(store), 'en') // a "new page load" with the same storage
  // Logging out clears the Supabase session, never this key.
  const auth = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8')
  assert.ok(!/localStorage\.clear|removeItem\(\s*['"]life-os-lang/.test(auth))
})

test('a bad or blocked storage never crashes language loading', () => {
  assert.equal(storeLang('fr', memoryStorage()), false)
  assert.equal(readStoredLang(memoryStorage({ [STORAGE_KEY]: 'fr' })), null)
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(initialLang(blocked), 'sw')
  assert.equal(storeLang('en', blocked), false)
  assert.equal(isLang('sw') && isLang('en') && !isLang('fr'), true)
})

test('switching language changes the text; keys fall back to English, never to a blank', () => {
  setActiveLang('en')
  assert.equal(t('nav.ai'), 'AI Assistant')
  setActiveLang('sw')
  assert.equal(getLang(), 'sw')
  assert.equal(t('nav.ai'), 'Msaidizi wa AI')
  assert.equal(t('nav.home'), 'Mwanzo')
  assert.equal(t('does.not.exist'), 'does.not.exist')
  assert.equal(tr('Save'), 'Hifadhi')
  assert.equal(tr('A sentence nobody translated yet'), 'A sentence nobody translated yet')
  setActiveLang('en')
  assert.equal(tr('Save'), 'Save')
})

test('English and Kiswahili catalogues have identical keys, no empty values, same placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(sw).sort())
  for (const k of Object.keys(en)) {
    assert.ok(String(sw[k]).trim(), `empty Kiswahili text for ${k}`)
    assert.equal(placeholders(sw[k]), placeholders(en[k]), `placeholders differ for ${k}`)
  }
})

test('the required navigation labels exist in both languages', () => {
  for (const k of ['home', 'today', 'planner', 'goals', 'projects', 'finance', 'habits', 'learning', 'notes', 'ideas', 'insights', 'ai', 'notifications', 'settings']) {
    assert.ok(en[`nav.${k}`] && sw[`nav.${k}`], `nav.${k}`)
  }
  assert.equal(sw['nav.ai'], 'Msaidizi wa AI')
})

test('every phrase written in the code with tr("...") has a Kiswahili translation', () => {
  const missing = new Set()
  for (const { file, text } of sources()) {
    if (file.startsWith('src/i18n/')) continue
    for (const m of text.matchAll(/\btr\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const phrase = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n')
      if (phrase.includes('${')) continue
      if (!(phrase in swPhrases)) missing.add(`${file}: ${phrase}`)
    }
  }
  assert.deepEqual([...missing], [])
})

test('plural forms and weekday names are translated', () => {
  const missing = []
  for (const { text } of sources()) {
    for (const m of text.matchAll(/plural\([^,]+,\s*'([^']+)'(?:,\s*'([^']+)')?\)/g)) {
      for (const k of [`{n} ${m[1]}`, `{n} ${m[2] || `${m[1]}s`}`]) if (!(k in swPhrases)) missing.push(k)
    }
  }
  for (const d of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) if (!(d in swPhrases)) missing.push(d)
  assert.deepEqual(missing, [])
  setActiveLang('sw')
  assert.equal(plural(3, 'task'), 'kazi 3')
  assert.equal(plural(1, 'goal'), 'lengo 1')
  setActiveLang('en')
  assert.equal(plural(1, 'goal'), '1 goal')
  assert.equal(plural(2, 'goal'), '2 goals')
})

test('translated phrases keep every {placeholder} of the English text', () => {
  const bad = []
  for (const [k, v] of Object.entries(swPhrases)) if (placeholders(k) !== placeholders(v)) bad.push(k)
  assert.deepEqual(bad, [])
  assert.equal(fill('Hello {name}', { name: 'Asha' }), 'Hello Asha')
  assert.equal(fill('Hello {name}', {}), 'Hello {name}')
})

test('every dropdown option (priorities, statuses, categories...) has a Kiswahili label', () => {
  const untranslated = []
  for (const [name, value] of Object.entries(constants)) {
    if (!Array.isArray(value) || !value.length || typeof value[0] !== 'object') continue
    for (const o of value) if (!/^\d+ of \d$/.test(o.label) && !(o.label in swPhrases)) untranslated.push(`${name}.${o.value}`)
  }
  assert.deepEqual(untranslated, [])
})

test('AI error messages exist in Kiswahili, including the required rate-limit wording', () => {
  for (const text of Object.values(AI_ERROR_TEXT)) assert.ok(text in swPhrases, `no Kiswahili for: ${text}`)
  setActiveLang('sw')
  assert.equal(tr(AI_ERROR_TEXT.provider_rate_limited), 'Matumizi ya AI kwa sasa yamefikia kikomo. Tafadhali jaribu baadaye.')
  setActiveLang('en')
  assert.equal(tr(AI_ERROR_TEXT.provider_rate_limited), 'Your AI usage limit has been reached. Please try again later.')
})

test('notification dedupe keys are never translated', () => {
  const rules = readFileSync(new URL('../src/utils/notificationRules.js', import.meta.url), 'utf8')
  assert.ok(!/dedupe_key:\s*tr\(/.test(rules))
})

test('texts passed to shared UI components (title, label, subtitle, empty-state text...) are translated', () => {
  const PROP = /\b(title|label|subtitle|text|action|placeholder|hint|description|singular|buttonLabel|prompt|emptyText|emptyAction|linkLabel|confirmLabel|message)\s*[:=]\s*(?:\{\s*)?(['"`])((?:\\.|(?!\2)[^\\])*)\2/g
  const missing = new Set()
  for (const { file, text } of sources()) {
    if (file.startsWith('src/i18n/')) continue
    for (const m of text.matchAll(PROP)) {
      const raw = m[3].replace(/\\'/g, "'").replace(/\\"/g, '"')
      if (raw.includes('${') || !/[A-Za-z]{3}/.test(raw)) continue
      if ((/^[a-z_]+$/.test(raw) && m[1] !== 'label') || /^(\/|#|https?:|[a-z-]+\.[a-z]|\d)/.test(raw)) continue
      if (!(raw in swPhrases)) missing.add(`${file}: ${m[1]}: ${raw}`)
    }
  }
  assert.deepEqual([...missing], [])
})

test('the generic error message is translated', () => {
  assert.ok('Something went wrong. Please try again.' in swPhrases)
})
