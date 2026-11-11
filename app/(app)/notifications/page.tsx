import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, fmtVars } from '@/lib/i18n'
import { Top } from '@/components/ui'
import { readAll } from '@/lib/actions'
import { Pager, pageOf } from '@/components/Pager'

// Все уведомления пользователя (на главной — последние восемь)
export default async function Notifications(props: { searchParams: Promise<{ page?: string }> }) {
  const sp = await props.searchParams
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const rows = await q<{ id: string; text: string; vars: Record<string, string | number> | null; link: string | null; read: boolean; created_at: string }>(
    'select id, text, vars, link, read, created_at from portal.notifications where user_id = $1 order by created_at desc limit 1000', [c.user.id])
  const pg = pageOf(sp.page, rows.length, 50) // О55: по 50 на странице
  return (
    <>
      <Top title={T('Уведомления')} right={<form action={readAll}><button className="btn">{T('Прочитать все')}</button></form>} />
      <div className="page">
        <div className="card">
          {rows.length === 0 && <div className="muted small">{T('Пока пусто')}</div>}
          {rows.slice(pg.from, pg.to).map((n) => <Link key={n.id} href={n.link || '/'} className="kv"><span style={{ color: n.read ? 'var(--muted)' : 'var(--ink)', fontWeight: n.read ? 400 : 600 }}>{T(n.text, fmtVars(L, n.vars))}</span><span className="tiny muted">{dateTime(L, n.created_at)}</span></Link>)}
        </div>
        <Pager page={pg.page} pages={pg.pages} total={rows.length} qs="" label={T('Строк: {n}', { n: rows.length })} />
      </div>
    </>
  )
}
