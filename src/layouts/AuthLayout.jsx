import Logo from '../components/Logo'
import Card from '../components/ui/Card'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useI18n } from '../i18n/I18nContext'
import { tr } from '../i18n'

export default function AuthLayout({ title, subtitle, children, footer }) {
  const { t } = useI18n()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <span className="text-lg font-bold">{tr('Personal Life OS')}</span>
        </div>
        <LanguageSwitcher />
      </div>
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </Card>
      {footer && <p className="mt-5 text-center text-sm text-slate-600 dark:text-slate-400">{footer}</p>}
    </main>
  )
}
