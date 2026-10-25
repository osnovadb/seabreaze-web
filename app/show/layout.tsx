import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { IdleLock } from '@/components/IdleLock'

export default async function ShowLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx()
  if (!c.show) redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const cl = c.show.clientId ? await one<{ name: string }>('select name from portal.clients where id = $1', [c.show.clientId]) : null
  return (
    <div className="show">
      <IdleLock />
      <div className="show__top">
        <img src="/brand/wordmark.svg" alt="GetsEstate" style={{ height: 22 }} />
        <span className="pill pill--ours">● {T('Презентация')}</span>
        {cl && <span className="small muted">{T('Для')} {cl.name.split(' · ').pop()}</span>}
        <nav className="row" style={{ marginInlineStart: 'auto', gap: 6 }}>
          <Link className="chip" href="/show">{T('Проекты')}</Link>
          <Link className="chip" href="/show/premium-residence">Premium Residence</Link>
        </nav>
        <Link className="btn btn--sm" href="/show/exit" title={T('Выход по PIN')}>🔒</Link>
      </div>
      {children}
    </div>
  )
}
