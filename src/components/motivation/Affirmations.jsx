import { useState } from 'react'
import { Check, Heart, Sun, Moon, Sparkles } from 'lucide-react'
import { t } from '../../i18n'
import { pick } from '../../lib/motivationContent'
import { toggleFavorite } from '../../lib/media'

const routineKey = (scope, kind, date) => `life-os-routine:${scope || 'device'}:${kind}:${date}`
const readRoutine = (k) => {
  try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) }
  catch { return new Set() }
}

const VISUALS = {
  morning: {
    image: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1400&q=85',
    eyebrow: 'A FRESH BEGINNING',
    swEyebrow: 'MWANZO MPYA',
    heading: 'Rise with intention.',
    swHeading: 'Amka ukiwa na kusudi.',
    body: {
      en: 'Give yourself permission to grow at your own pace.',
      sw: 'Jipe nafasi ya kukua kwa kasi yako mwenyewe.',
    },
  },
  night: {
    image: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1400&q=85',
    eyebrow: 'SLOW DOWN & REST',
    swEyebrow: 'TULIA NA PUMZIKA',
    heading: 'You have done enough.',
    swHeading: 'Umefanya vya kutosha.',
    body: {
      en: 'Release today. Make room for a peaceful tomorrow.',
      sw: 'Achilia yaliyopita leo. Fungua nafasi kwa kesho yenye amani.',
    },
  },
}

const IMAGES = [
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80',
]

export default function Affirmations({ kind, items, routine, lang, today, userId, state, setState }) {
  const key = routineKey(userId, kind, today)
  const [done, setDone] = useState(() => readRoutine(key))
  const other = lang === 'en' ? 'sw' : 'en'
  const visual = VISUALS[kind]
  const completed = routine.filter((r) => done.has(r.id)).length
  const progress = routine.length ? Math.round((completed / routine.length) * 100) : 0
  const isMorning = kind === 'morning'

  const tick = (id) => {
    const next = new Set(done)
    next.has(id) ? next.delete(id) : next.add(id)
    setDone(next)
    try { localStorage.setItem(key, JSON.stringify([...next])) }
    catch { /* the checklist still works for this visit */ }
  }

  return (
    <div className="premium-affirmations space-y-6">
      <section className="premium-affirmation-hero">
        <img src={visual.image} alt="" className="premium-affirmation-hero-image" />
        <div className="premium-affirmation-overlay" />
        <div className="premium-affirmation-hero-content">
          <span className="premium-affirmation-eyebrow">
            {lang === 'en' ? visual.eyebrow : visual.swEyebrow}
          </span>
          <div className="mt-4 flex items-center gap-2 text-white/80">
            {isMorning ? <Sun size={19} /> : <Moon size={19} />}
            <span className="text-sm font-medium">
              {isMorning ? (lang === 'en' ? 'Morning ritual' : 'Taratibu za asubuhi') : (lang === 'en' ? 'Evening reflection' : 'Tafakari ya jioni')}
            </span>
          </div>
          <h2 className="mt-3 max-w-xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
            {lang === 'en' ? visual.heading : visual.swHeading}
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/85 sm:text-base">
            {visual.body[lang] || visual.body.en}
          </p>
          <div className="mt-6 flex items-center gap-2 text-xs font-medium text-white/80">
            <Sparkles size={15} />
            {lang === 'en' ? 'A moment for yourself' : 'Muda maalumu kwa ajili yako'}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="premium-section-kicker">
              {lang === 'en' ? 'YOUR DAILY MINDSET' : 'MTIZAMO WAKO WA LEO'}
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight">
              {lang === 'en' ? 'Words to grow with' : 'Maneno ya kukujenga'}
            </h2>
          </div>
          <span className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            {items.length} {lang === 'en' ? 'affirmations' : 'kauli'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((a, index) => (
            <article key={a.id} className="premium-affirmation-card">
              <div className="premium-affirmation-card-image">
                <img src={IMAGES[index % IMAGES.length]} alt="" loading="lazy" />
                <div className="premium-affirmation-card-shade" />
                <span className="premium-affirmation-number">{String(index + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="premium-affirmation-favorite"
                  aria-pressed={state.favorites.includes(a.id)}
                  aria-label={t('mot.favorite')}
                  onClick={() => setState(toggleFavorite(state, a.id))}
                >
                  <Heart size={19} className={state.favorites.includes(a.id) ? 'fill-current' : ''} />
                </button>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-base font-semibold leading-relaxed sm:text-lg">
                  “{pick(a, lang)}”
                </p>
                <p lang={other} className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  {pick(a, other)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="premium-routine">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="premium-section-kicker">
              {lang === 'en' ? 'BUILD YOUR MOMENT' : 'JENGA MUDA YAKO'}
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight">
              {t(kind === 'morning' ? 'mot.morningRoutine' : 'mot.nightRoutine')}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {lang === 'en' ? 'Small rituals. A stronger you.' : 'Taratibu ndogo. Wewe mwenye nguvu zaidi.'}
            </p>
          </div>
          <div className="premium-routine-score">
            <span>{progress}%</span>
            <small>{lang === 'en' ? 'DONE' : 'IMETIMIA'}</small>
          </div>
        </div>

        <div className="premium-routine-track">
          <div className="premium-routine-fill" style={{ width: `${progress}%` }} />
        </div>

        <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/10">
          {routine.map((r, index) => (
            <li key={r.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={done.has(r.id)}
                onClick={() => tick(r.id)}
                className="flex min-h-[62px] w-full items-center gap-3 py-3 text-left"
              >
                <span className={`premium-routine-check ${done.has(r.id) ? 'is-done' : ''}`}>
                  {done.has(r.id) && <Check size={17} strokeWidth={3} />}
                </span>
                <span className="flex-1">
                  <span className={`block text-sm font-medium ${done.has(r.id) ? 'text-slate-400 line-through' : ''}`}>
                    {pick(r, lang)}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {pick(r, other)}
                  </span>
                </span>
                <span className="text-xs font-medium text-slate-400">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {done.size >= routine.length && (
          <div role="status" className="mt-4 rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
            {t('mot.routineDone')}
          </div>
        )}
      </section>
    </div>
  )
}
