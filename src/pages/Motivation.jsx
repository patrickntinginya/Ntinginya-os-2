import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, LifeBuoy } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Tabs from '../components/ui/Tabs'
import Card from '../components/ui/Card'
import AskAiPanel from '../components/ai/AskAiPanel'
import Affirmations from '../components/motivation/Affirmations'
import MediaTab from '../components/motivation/MediaTab'
import RitualReminders from '../components/motivation/RitualReminders'
import { useAuth } from '../contexts/AuthContext'
import { getLang, t } from '../i18n'
import * as C from '../lib/motivationContent'
import { loadState, saveState, toggleFavorite } from '../lib/media'
import { todayISO } from '../utils/date'
import { db } from '../services/db'

const TABS = ['daily', 'morning', 'night', 'videos', 'audio', 'images', 'calm']

function Daily({ lang, today, state, setState }) {
  const d = C.dailyFor(today)
  const [added, setAdded] = useState(null)
  const online = typeof navigator === 'undefined' || navigator.onLine !== false
  const addToPlanner = async () => {
    // One task, created only when the user taps. The id of today's message is in the description so it is not duplicated.
    try {
      const existing = await db.list('tasks', { filters: [{ op: 'eq', column: 'due_date', value: today }], limit: 200 })
      if (existing.some((x) => String(x.notes || '').includes(`life-os:motivation:${d.id}:${today}`))) return setAdded('exists')
      await db.create('tasks', { title: C.pick(d.action, lang).slice(0, 120), notes: `life-os:motivation:${d.id}:${today}`, due_date: today })
      setAdded('ok')
    } catch {
      setAdded('error')
    }
  }
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="text-xl font-semibold leading-snug">{C.pick(d, lang)}</p>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300"><span className="font-semibold">{t('mot.smallAction')}: </span>{C.pick(d.action, lang)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary !min-h-[44px]" aria-pressed={state.favorites.includes(d.id)} onClick={() => setState(toggleFavorite(state, d.id))}><Heart size={18} className={state.favorites.includes(d.id) ? 'fill-red-500 text-red-500' : ''} aria-hidden="true" />{t('mot.favorite')}</button>
          <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={addToPlanner}>{t('mot.addToPlanner')}</button>
        </div>
        {added && <p role="status" className="mt-2 text-sm">{t(`mot.planner.${added}`)}</p>}
      </Card>
      {state.favorites.some((f) => C.DAILY.some((x) => x.id === f)) && (
        <Card className="p-4"><h2 className="mb-2 font-semibold">{t('mot.saved')}</h2>
          <ul className="space-y-2 text-sm">{C.DAILY.filter((x) => state.favorites.includes(x.id)).map((x) => <li key={x.id}>{C.pick(x, lang)}</li>)}</ul>
        </Card>
      )}
      {online ? (
        <AskAiPanel title={t('mot.aiTitle')} description={t('mot.aiDesc')} mode="chat" inputLabel={t('mot.aiLabel')} inputPlaceholder={t('mot.aiPlaceholder')} buttonLabel={t('mot.aiButton')} />
      ) : (
        <Card className="p-4 text-sm" role="status">{t('mot.offline')}</Card>
      )}
      <RitualReminders />
    </div>
  )
}

function QuoteCards({ lang, state, setState }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('mot.quoteCards')}>
      {C.DAILY.slice(0, 6).map((q, i) => (
        <li key={q.id} className="relative overflow-hidden rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${C.QUOTE_GRADIENTS[i % C.QUOTE_GRADIENTS.length][0]}, ${C.QUOTE_GRADIENTS[i % C.QUOTE_GRADIENTS.length][1]})` }}>
          <p className="pr-10 text-lg font-semibold leading-snug">{C.pick(q, lang)}</p>
          <button type="button" className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center" aria-pressed={state.favorites.includes(q.id)} aria-label={t('mot.favorite')} onClick={() => setState(toggleFavorite(state, q.id))}><Heart size={20} className={state.favorites.includes(q.id) ? 'fill-white' : ''} /></button>
        </li>
      ))}
    </ul>
  )
}

export default function Motivation() {
  const { user } = useAuth()
  const scope = user?.id
  const lang = getLang()
  const today = todayISO()
  const [tab, setTab] = useState('daily')
  const [state, setStateRaw] = useState(() => loadState(globalThis.localStorage, scope))
  const [saveError, setSaveError] = useState(false)
  const setState = useCallback((next) => { setStateRaw(next); setSaveError(!saveState(globalThis.localStorage, scope, next)) }, [scope])
  useEffect(() => { setStateRaw(loadState(globalThis.localStorage, scope)) }, [scope])
  const tabs = useMemo(() => TABS.map((v) => ({ value: v, label: t(`mot.tab.${v}`) })), [])

  return (
    <div>
      <PageHeader title={t('mot.title')} subtitle={t('mot.subtitle')} action={<Link to="/calm" className="btn btn-secondary !min-h-[44px] !px-3" aria-label={t('calm.quick')}><LifeBuoy size={18} aria-hidden="true" /><span className="hidden sm:inline">{t('calm.quick')}</span></Link>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('mot.title')} />
      {saveError && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{t('media.err.storage')}</p>}
      {tab === 'daily' && <Daily lang={lang} today={today} state={state} setState={setState} />}
      {tab === 'morning' && <Affirmations kind="morning" items={C.MORNING} routine={C.MORNING_ROUTINE} lang={lang} today={today} userId={scope} state={state} setState={setState} />}
      {tab === 'night' && <Affirmations kind="night" items={C.NIGHT} routine={C.NIGHT_ROUTINE} lang={lang} today={today} userId={scope} state={state} setState={setState} />}
      {tab === 'videos' && <MediaTab kind="video" curated={C.CURATED_VIDEOS} state={state} setState={setState} userId={scope} />}
      {tab === 'audio' && <MediaTab kind="audio" curated={C.CURATED_AUDIO} state={state} setState={setState} userId={scope} />}
      {tab === 'images' && <MediaTab kind="image" curated={C.CURATED_IMAGES} state={state} setState={setState} userId={scope} quotes={<QuoteCards lang={lang} state={state} setState={setState} />} />}
      {tab === 'calm' && (
        <Card className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">{t('mot.calmTitle')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('mot.calmText')}</p>
          <Link to="/calm" className="btn btn-primary w-full">{t('calm.quick')}</Link>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('calm.disclaimer')}</p>
        </Card>
      )}
    </div>
  )
}
