import Card from './ui/Card'
import { tr } from '../i18n'

export default function ConfigMissing() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="p-6">
        <h1 className="text-xl font-bold">{tr('Supabase is not configured')}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          {tr('Add these two environment variables, then restart the dev server (or redeploy on Netlify):')}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-100 p-3 text-sm dark:bg-white/10">
{`VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY`}
        </pre>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{tr('See .env.example and README.md.')}</p>
      </Card>
    </div>
  )
}
