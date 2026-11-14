import { Link } from 'react-router-dom'
import { ArrowUpRight, Bot, BriefcaseBusiness, CalendarDays, FolderKanban, Heart, Sparkles, Target, Users, Wallet, Sun, Repeat } from 'lucide-react'
import { useI18n } from '../../i18n/I18nContext'
import { formatLongDate, greeting } from '../../utils/date'

const items = [
  ['/today','nav.today','Vipaumbele vya siku','Your daily priorities',Sun,'amber'],
  ['/planner','nav.planner','Panga muda wako','Shape your time',CalendarDays,'violet'],
  ['/goals','nav.goals','Fuatilia maendeleo','Make progress visible',Target,'green'],
  ['/projects','nav.projects','Geuza mipango vitendo','Turn plans into action',FolderKanban,'orange'],
  ['/finance','nav.finance','Dhibiti fedha zako','Know where it goes',Wallet,'cyan'],
  ['/community','nav.community','Kua pamoja na jamii','Grow together',Users,'blue'],
  ['/marketplace','nav.marketplace','Pata wataalamu','Find trusted expertise',BriefcaseBusiness,'lime'],
  ['/habits','nav.habits','Jenga tabia nzuri','Build your rhythm',Repeat,'rose'],
  ['/motivation','nav.motivation','Lishe akili yako','Feed your mindset',Heart,'gold'],
]

export default function DashboardHomeHero({ firstName = '', unread = 0 }) {
  const { t, lang } = useI18n()
  const sw = lang === 'sw'
  return (
    <div className="nt-home-intro">
      <div className="nt-home-welcome">
        <div>
          <span className="nt-eyebrow"><span className="nt-live-dot" /> {sw ? 'MAISHA YAKO, HATUA KWA HATUA' : 'YOUR LIFE, IN MOTION'}</span>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ''} <span>✦</span></h1>
          <p>{formatLongDate()} <span className="nt-welcome-divider">/</span> Ntinginya Life OS</p>
        </div>
        <Link to="/notifications" className="nt-notice-pill" aria-label={t('nav.notifications')}><span className="nt-notice-icon">⌁</span><span>{unread > 99 ? '99+' : unread}</span></Link>
      </div>

      <Link to="/ai" className="nt-ai-feature">
        <div className="nt-ai-orbit nt-ai-orbit-one" /><div className="nt-ai-orbit nt-ai-orbit-two" />
        <div className="nt-ai-copy">
          <span className="nt-ai-kicker"><Sparkles size={14} /> {sw ? 'MSHIRIKA WAKO BINAFSI WA MAWAZO' : 'YOUR PERSONAL THINKING PARTNER'}</span>
          <h2>{t('ai.title')}</h2>
          <p>{sw ? 'Pata ushauri, panga siku yako na geuza mawazo kuwa hatua.' : 'Get clarity, plan your day and turn ideas into meaningful action.'}</p>
          <span className="nt-ai-action">{sw ? 'Anza mazungumzo' : 'Start a conversation'} <ArrowUpRight size={17} /></span>
        </div>
        <div className="nt-ai-visual" aria-hidden="true"><div className="nt-ai-halo"><Bot size={54} strokeWidth={1.35} /></div><span className="nt-ai-spark nt-ai-spark-a">✦</span><span className="nt-ai-spark nt-ai-spark-b">·</span></div>
      </Link>

      <div className="nt-shortcut-heading">
        <div><span className="nt-eyebrow">{sw ? 'VIFAA VYA NTINGINYA LIFE OS' : 'THE LIFE OS TOOLKIT'}</span><h2>{sw ? 'Panga kila eneo la maisha yako' : 'Move every part of life forward'}</h2></div>
        <span className="nt-shortcut-count">09 / {sw ? 'SEHEMU' : 'MODULES'}</span>
      </div>
      <nav className="nt-shortcut-grid" aria-label={sw ? 'Sehemu za Life OS' : 'Life OS sections'}>
        {items.map(([to,key,swLabel,enLabel,Icon,tone],i) => (
          <Link to={to} key={to} className={`nt-shortcut nt-tone-${tone}`}>
            <span className="nt-shortcut-icon"><Icon size={22} strokeWidth={1.8} /></span>
            <span className="nt-shortcut-copy"><strong>{t(key)}</strong><small>{sw ? swLabel : enLabel}</small></span>
            <ArrowUpRight className="nt-shortcut-arrow" size={17} /><span className="nt-shortcut-index">{String(i+1).padStart(2,'0')}</span>
          </Link>
        ))}
      </nav>

      <Link to="/motivation" className="nt-motivation-feature">
        <div className="nt-motivation-art" aria-hidden="true"><div className="nt-mountain nt-mountain-back" /><div className="nt-mountain nt-mountain-front" /><span className="nt-motivation-sun" /><span className="nt-motivation-star">✦</span></div>
        <div className="nt-motivation-copy">
          <span className="nt-eyebrow"><Sparkles size={13} /> {sw ? 'UJUMBE KWA WEWE WA BAADAYE' : 'A NOTE TO YOUR FUTURE SELF'}</span>
          <h2>{sw ? <>Hatua ndogo. <em>Matokeo makubwa.</em></> : <>Small steps. <em>Uncommon outcomes.</em></>}</h2>
          <p>{sw ? 'Usikate tamaa. Ndoto zako ni kubwa, na una uwezo wa kuzifikia.' : 'Keep going. Your next chapter is built by the steps you take today.'}</p>
          <span className="nt-motivation-link">{t('nav.motivation')} <ArrowUpRight size={16} /></span>
        </div>
      </Link>
    </div>
  )
}
