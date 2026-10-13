import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bell, MoreHorizontal } from 'lucide-react'
import { ALL_ITEMS, NAV_ITEMS, SECONDARY_ITEMS, BOTTOM_NAV_PATHS } from '../lib/navigation'
import OfflineBanner from '../components/OfflineBanner'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDeviceNotifications, useNotificationSync, useUnreadCount } from '../hooks/useAppServices'
import Logo from '../components/Logo'
import Modal from '../components/ui/Modal'
import { isNativePlatform } from '../lib/platform'

const linkClass = ({ isActive, highlight }) =>
  `flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors ${
    highlight
      ? isActive
        ? 'bg-brand-700 text-white'
        : 'bg-brand-600 text-white hover:bg-brand-700'
      : isActive
        ? 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-100'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
  }`

const isActiveItem = (item, pathname) => pathname.startsWith(item.match || item.to)

function Sidebar({ unread, pathname }) {
  const { t } = useI18n()
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-white/10 dark:bg-surface-dark">
      <div className="flex items-center gap-3 px-5 pb-3 pt-5">
        <Logo size={34} />
        <span className="text-lg font-bold">{t('app.short')}</span>
      </div>
      <div className="px-4 pb-3"><LanguageSwitcher className="w-full justify-between" /></div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label={t('nav.main')}>
        {[...NAV_ITEMS, ...SECONDARY_ITEMS].map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to} to={item.to}
              className={() => linkClass({ isActive: isActiveItem(item, pathname), highlight: item.highlight })}
              aria-label={item.highlight ? t('nav.openAi') : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="flex-1">{t(item.labelKey)}</span>
              {item.to === '/notifications' && unread > 0 && (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{unread > 99 ? '99+' : unread}</span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}

function BottomNav({ onMore, pathname }) {
  const { t } = useI18n()
  const items = BOTTOM_NAV_PATHS.map((p) => ALL_ITEMS.find((i) => i.to === p))
  const tab = (active) =>
    `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
      active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'
    }`
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-white/10 dark:bg-surface-dark"
      aria-label={t('nav.main')}
    >
      {items.map((item) => {
        const Icon = item.icon
        const active = isActiveItem(item, pathname)
        if (item.highlight) {
          // The AI Assistant: a raised, filled button in the middle of the bar.
          return (
            <NavLink key={item.to} to={item.to} aria-label={t('nav.openAi')} className="flex min-h-[56px] flex-1 flex-col items-center justify-start">
              <span className={`-mt-5 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white dark:ring-surface-dark ${active ? 'bg-brand-800' : 'bg-brand-600'}`}>
                <Icon size={26} aria-hidden="true" />
              </span>
              <span className={`mt-0.5 text-xs font-semibold ${active ? 'text-brand-800 dark:text-brand-200' : 'text-brand-700 dark:text-brand-300'}`}>{t(item.labelKey)}</span>
            </NavLink>
          )
        }
        return (
          <NavLink key={item.to} to={item.to} className={() => tab(active)}>
            <Icon size={22} aria-hidden="true" />
            {t(item.labelKey)}
          </NavLink>
        )
      })}
      <button type="button" onClick={onMore} className={tab(false)}>
        <MoreHorizontal size={22} aria-hidden="true" />
        {t('nav.more')}
      </button>
    </nav>
  )
}

export default function AppLayout() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const { t } = useI18n()
  const unread = useUnreadCount()
  useNotificationSync()
  useDeviceNotifications(Boolean(profile?.notifications_enabled) && !isNativePlatform()) // Android uses scheduled local notifications instead
  const current = ALL_ITEMS.find((i) => isActiveItem(i, pathname))

  return (
    <div className="flex min-h-dvh">
      <Sidebar unread={unread} pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden dark:border-white/10 dark:bg-surface-dark/95">
          <Logo size={26} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{current ? t(current.labelKey) : t('app.short')}</span>
          <LanguageSwitcher />
          <Link to="/notifications" className="icon-btn relative" aria-label={`${t('nav.notifications')}${unread ? `, ${t('nav.unread', { count: unread })}` : ''}`}>
            <Bell size={20} />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-white dark:ring-surface-dark" />}
          </Link>
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          <Outlet />
        </main>
      </div>
      <BottomNav onMore={() => setMoreOpen(true)} pathname={pathname} />
      {moreOpen && (
        <Modal title={t('nav.menu')} onClose={() => setMoreOpen(false)}>
          <nav className="grid gap-1" aria-label={t('nav.all')}>
            {ALL_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <NavLink key={item.to} to={item.to} className={() => linkClass({ isActive: isActiveItem(item, pathname), highlight: item.highlight })} onClick={() => setMoreOpen(false)}>
                  <Icon size={20} aria-hidden="true" />
                  {t(item.labelKey)}
                </NavLink>
              )
            })}
          </nav>
        </Modal>
      )}
    </div>
  )
}
