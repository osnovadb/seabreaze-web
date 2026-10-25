import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { canSeeJournal } from '@/lib/perm'
import { Top } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'

export default async function Journal() {
  const c = await requireCtx()
  if (!canSeeJournal(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const rows = await q<{ id: number; action: string; entity: string | null; entity_id: string | null; data: unknown; created_at: string; who: string | null; as_who: string | null }>(
    `select a.id, a.action, a.entity, a.entity_id, a.data, a.created_at, u.name who, au.name as_who from portal.audit a left join portal.users u on u.id = a.user_id left join portal.users au on au.id = a.as_user_id
     ${c.user.role === 'finance' ? "where a.action like 'deal.%' or a.action like 'conditions.%'" : c.user.role === 'market_head' ? 'where coalesce(au.market, u.market) = $1' : ''} order by a.id desc limit 300`, c.user.role === 'market_head' ? [c.user.market] : [])
  return (
    <>
      <Top title={T('Админка')} sub={T('Журнал действий: кто, что и когда. Доказательство в споре «чей клиент».')} />
      <div className="page">
        <AdminTabs lang={L} on="journal" role={c.user.role} />
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Когда', 'Кто', 'Действие', 'Объект', 'Данные'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="small muted">{dateTime(L, r.created_at)}</td><td>{r.who}{r.as_who && <div className="tiny warnc">{T('как')} {r.as_who}</div>}</td><td><code>{r.action}</code></td><td className="small">{r.entity} {r.entity_id?.slice(0, 8)}</td><td className="tiny muted">{r.data ? JSON.stringify(r.data).slice(0, 120) : ''}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  )
}
