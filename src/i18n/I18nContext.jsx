import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { initialLang, localeOf, setActiveLang, storeLang, t, tr } from './index'
import { setDateLocale } from '../utils/date'

const I18nContext = createContext(null)

/**
 * Holds the chosen language. Changing it remounts everything below (key={lang}) so every screen re-renders in the new
 * language at once. The choice is saved in localStorage, which logging out does not clear, so it survives refresh,
 * logout/login and reopening the app.
 */
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang)
  // Set synchronously during render so child components (and plain helpers) already see the right language.
  setActiveLang(lang)
  setDateLocale(localeOf(lang))

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((code) => {
    storeLang(code)
    setActiveLang(code)
    setDateLocale(localeOf(code))
    setLangState(code)
  }, [])

  const value = useMemo(() => ({ lang, setLang, t, tr }), [lang, setLang])
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
