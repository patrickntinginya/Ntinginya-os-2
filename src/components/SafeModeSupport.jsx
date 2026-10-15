import { useState } from 'react'
import { HeartHandshake, Search, Sparkles, Youtube } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resolveAiEndpoint } from '../lib/apiBase'
import { isNativePlatform } from '../lib/platform'
import { getLang } from '../i18n'

const COPY = {
  sw: {
    headerTitle: 'Msaidizi wa AI wa Hali Salama',
    intro: 'Eleza unavyojisikia. AI inaweza kukutia moyo na kupendekeza video zinazolingana na mahitaji yako.',
    feeling: 'Unajisikiaje sasa?',
    detail: 'Ungependa AI ijue nini zaidi? (si lazima)',
    inputHint: 'Eleza kwa ufupi kinachokusumbua au unachohitaji...',
    personalize: 'Tumia habits na tafakari zangu za hivi karibuni kubinafsisha msaada',
    consent: 'Ukiwasha hili, AI itatumia muhtasari wa mazoea yako na tafakari ulizohifadhi ili kutoa jibu linalokufaa. Maandishi haya hayatatumwa YouTube.',
    ask: 'Nisaidie',
    busy: 'Inakusaidia...',
    answer: 'Ujumbe wako wa motisha',
    videos: 'Video zinazoweza kukusaidia',
    videoIntro: 'Mapendekezo yanategemea hali uliyochagua. Tazama na uchague kinachokufaa.',
    watch: 'Tazama YouTube',
    searchYoutube: 'Tafuta video zinazofaa kwenye YouTube',
    noVideos: 'Hakuna video maalumu zilizothibitishwa kwa sasa. Unaweza kutafuta YouTube kwa mada hii.',
    error: 'Imeshindwa kupata msaada sasa. Kagua muunganisho wako kisha ujaribu tena.',
    privacy: 'AI si mtaalamu wa afya ya akili na haiwezi kufanya utambuzi wa kitabibu. Ikiwa uko kwenye hatari ya haraka, wasiliana na mtu unayemwamini, huduma za dharura za eneo lako au nenda kituo cha afya kilicho karibu.',
    moods: [
      ['stress', 'Nina msongo wa mawazo'],
      ['discouraged', 'Nimekata tamaa'],
      ['anxiety', 'Nina wasiwasi'],
      ['tired', 'Nimechoka kiakili'],
      ['low_motivation', 'Nimepoteza motisha'],
      ['life_challenge', 'Ninapitia changamoto za maisha'],
      ['growth', 'Nataka kujijenga'],
      ['calm', 'Nataka kutulia']
    ]
  },
  en: {
    headerTitle: 'Safe Mode AI Support Companion',
    intro: 'Tell us how you feel. AI can offer encouragement and suggest videos matched to what you need.',
    feeling: 'How are you feeling right now?',
    detail: 'What else would you like the AI to know? (optional)',
    inputHint: 'Briefly describe what is troubling you or what you need...',
    personalize: 'Use my recent habits and reflections to personalize support',
    consent: 'When enabled, AI uses a short summary of your habits and saved reflections. Your journal text is never sent to YouTube.',
    ask: 'Get support',
    busy: 'Preparing support...',
    answer: 'A message for you',
    videos: 'Videos that may help',
    videoIntro: 'Suggestions are based on the feeling you selected. Choose what feels right for you.',
    watch: 'Watch on YouTube',
    searchYoutube: 'Find suitable videos on YouTube',
    noVideos: 'No specific videos could be verified right now. You can search YouTube for this topic.',
    error: 'Could not get support right now. Check your connection and try again.',
    privacy: 'AI is not a mental-health professional and cannot diagnose conditions. If you are in immediate danger, contact someone you trust, local emergency services, or go to a nearby health facility.',
    moods: [
      ['stress', 'I am feeling stressed'],
      ['discouraged', 'I feel discouraged'],
      ['anxiety', 'I am feeling anxious'],
      ['tired', 'I feel mentally exhausted'],
      ['low_motivation', 'I have lost motivation'],
      ['life_challenge', 'I am facing life challenges'],
      ['growth', 'I want to grow'],
      ['calm', 'I want to calm down']
    ]
  }
}

export default function SafeModeSupport() {
  const lang = getLang() === 'en' ? 'en' : 'sw'
  const c = COPY[lang]
  const [mood, setMood] = useState('stress')
  const [details, setDetails] = useState('')
  const [personalize, setPersonalize] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function ask(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const { url } = resolveAiEndpoint({
        native: isNativePlatform(),
        apiBase: import.meta.env.VITE_API_BASE_URL,
      })
      if (!url) throw new Error('api_not_configured')
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('session_missing')
      const supportUrl = url.replace(/\/api\/ai-chat\/?$/, '/api/safe-mode-support')
      const response = await fetch(supportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mood, details: details.trim().slice(0, 600), includePersonalContext: personalize, lang }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'support_failed')
      setResult(body)
    } catch {
      setError(c.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900 dark:bg-surface-dark sm:p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-emerald-100 p-3 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"><HeartHandshake size={23} aria-hidden="true" /></span>
        <div>
          <h2 className="text-lg font-semibold">{c.headerTitle}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{c.intro}</p>
        </div>
      </div>
      <form onSubmit={ask} className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{c.feeling}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {c.moods.map(([value, text]) => (
              <label key={value} className={`flex min-h-[46px] cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${mood === value ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-white/10'}`}>
                <input type="radio" name="safe-mode-mood" value={value} checked={mood === value} onChange={() => setMood(value)} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium">
          {c.detail}
          <textarea className="input mt-1 min-h-24" maxLength={600} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={c.inputHint} />
        </label>
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">
          <input className="mt-1" type="checkbox" checked={personalize} onChange={(e) => setPersonalize(e.target.checked)} />
          <span><span className="font-medium">{c.personalize}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{c.consent}</span></span>
        </label>
        <button type="submit" className="btn btn-primary min-h-[46px] w-full sm:w-auto" disabled={busy}>
          <Sparkles size={18} aria-hidden="true" /> {busy ? c.busy : c.ask}
        </button>
      </form>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
      {result && (
        <div className="space-y-4" aria-live="polite">
          <article className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
            <h3 className="flex items-center gap-2 font-semibold"><HeartHandshake size={18} />{c.answer}</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{result.reply}</p>
          </article>
          <section className="space-y-3">
            <div>
              <h3 className="flex items-center gap-2 font-semibold"><Youtube size={19} />{c.videos}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{c.videoIntro}</p>
            </div>
            {result.videos?.length ? result.videos.map((video) => (
              <article key={video.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                <h4 className="font-medium">{video.title}</h4>
                {video.channel && <p className="mt-1 text-xs text-slate-500">{video.channel}</p>}
                {video.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{video.description}</p>}
                <a className="btn btn-secondary mt-3 min-h-[42px]" href={video.url} target="_blank" rel="noopener noreferrer">{c.watch}</a>
              </article>
            )) : <p className="text-sm text-slate-500 dark:text-slate-400">{c.noVideos}</p>}
            {result.searchUrl && <a className="btn btn-secondary min-h-[44px] w-full sm:w-auto" href={result.searchUrl} target="_blank" rel="noopener noreferrer"><Search size={17} />{c.searchYoutube}</a>}
          </section>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{c.privacy}</p>
        </div>
      )}
    </section>
  )
}
