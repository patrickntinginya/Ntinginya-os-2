import { Link } from 'react-router-dom'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { useI18n } from '../../i18n/I18nContext'

export default function DashboardMotivationBanner() {
  const { t, lang } = useI18n()
  const sw = lang === 'sw'

  return (
    <Link to="/motivation" className="nt-motivation-feature">
      <div className="nt-motivation-art" aria-hidden="true">
        <div className="nt-mountain nt-mountain-back" />
        <div className="nt-mountain nt-mountain-front" />
        <span className="nt-motivation-sun" />
        <span className="nt-motivation-star">✦</span>
      </div>
      <div className="nt-motivation-copy">
        <span className="nt-eyebrow"><Sparkles size={13} /> {sw ? 'UJUMBE KWA WEWE WA BAADAYE' : 'A NOTE TO YOUR FUTURE SELF'}</span>
        <h2>{sw ? <>Hatua ndogo. <em>Matokeo makubwa.</em></> : <>Small steps. <em>Uncommon outcomes.</em></>}</h2>
        <p>{sw ? 'Usikate tamaa. Ndoto zako ni kubwa, na una uwezo wa kuzifikia.' : 'Keep going. Your next chapter is built by the steps you take today.'}</p>
        <span className="nt-motivation-link">{t('nav.motivation')} <ArrowUpRight size={16} /></span>
      </div>
    </Link>
  )
}
