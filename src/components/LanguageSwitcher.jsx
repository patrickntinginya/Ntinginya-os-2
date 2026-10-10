import { LANGS } from '../i18n'
import { useI18n } from '../i18n/I18nContext'

/** Two large toggle buttons, always visible in the header: [ SW ] [ EN ]. */
export default function LanguageSwitcher({ className = '' }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="group" aria-label={t('lang.switcher')} className={`inline-flex rounded-xl bg-slate-100 p-1 dark:bg-white/10 ${className}`}>
      {LANGS.map((l) => {
        const on = l.code === lang
        return (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            aria-pressed={on}
            aria-label={l.label}
            title={l.label}
            onClick={() => !on && setLang(l.code)}
            className={`min-h-[44px] min-w-[48px] rounded-lg px-3 text-sm font-bold transition-colors ${
              on ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-white/10'
            }`}
          >
            <span aria-hidden="true" className="mr-1">{l.flag}</span>
            {l.short}
          </button>
        )
      })}
    </div>
  )
}
