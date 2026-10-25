import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { canReviewAgents } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { reviewApplication } from '@/lib/actions'
import { CreateAccess } from './access'

export default async function Agents() {
  const c = await requireCtx()
  if (!canReviewAgents(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const own = c.user.role === 'owner'
  const apps = await q<any>(`select * from portal.agent_applications ${own ? '' : 'where market = $1'} order by case status when 'new' then 0 when 'review' then 1 when 'contract' then 2 else 3 end, created_at desc`, own ? [] : [c.user.market])
  const curators = await q<{ id: string; name: string }>(`select id, name from portal.users where active and role in ('seller','market_head','owner') ${own ? '' : 'and market = $1'} order by name`, own ? [] : [c.user.market])
  const canAccess = ['owner', 'market_head'].includes(c.user.role)
  const agents = await q<{ id: string; name: string; email: string; role: string; market: string; agency: string | null; curator: string | null; license_note: string | null; contract_signed_at: string | null; clients: number; bookings: number; deals: number }>(
    `select u.id, u.name, u.email, u.role, u.market, a.name agency, cu.name curator, u.license_note, u.contract_signed_at,
      (select count(*)::int from portal.clients where owner_id = u.id) clients, (select count(*)::int from portal.bookings where agent_id = u.id and status in ('requested','confirmed')) bookings,
      (select count(*)::int from portal.deals where agent_id = u.id) deals
     from portal.users u left join portal.agencies a on a.id = u.agency_id left join portal.users cu on cu.id = u.curator_id where u.role in ('agent','agency_head') ${own ? '' : 'and u.market = $1'} order by u.name`, own ? [] : [c.user.market])
  const st: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { new: ['новая', 'warn'], review: ['на проверке', 'warn'], contract: ['договор', 'ink'], approved: ['одобрена', 'ok'], rejected: ['отказ', 'bad'] }
  return (
    <>
      <Top title={T('Агенты')} sub={T('Заявки на партнёрство и подключённые агенты рынка')} />
      <div className="page">
        <AdminTabs lang={L} on="agents" role={c.user.role} />
        <div className="h2">{T('Заявки')}</div>
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Заявитель', 'Рынок', 'Лицензия маклера', 'Объём / каналы', 'Дата', 'Статус', 'Решение'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{apps.map((a) => (
            <tr key={a.id}>
              <td><b>{a.name}</b>{a.company && <div className="small">{a.company}</div>}<div className="tiny muted">{T(a.kind === 'agency' ? 'Агентство' : 'Частный агент')} · {a.email} · {a.city} · {a.languages}</div></td>
              <td>{a.market}</td><td className="small">{a.license || '—'}</td><td className="small">{a.volume}<div className="tiny muted">{a.channels}</div></td>
              <td className="small muted">{date(L, a.created_at)}</td><td><Pill kind={st[a.status][1]}>{T(st[a.status][0])}</Pill></td>
              <td><form action={reviewApplication} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><input type="hidden" name="id" value={a.id} />
                <select className="in" name="status" defaultValue={a.status} style={{ height: 30, width: 140 }}>{Object.entries(st).map(([k, [l]]) => <option key={k} value={k}>{T(l)}</option>)}</select>
                <input className="in" name="note" placeholder={T('комментарий')} defaultValue={a.note || ''} style={{ height: 30, width: 150 }} /><button className="btn btn--sm">OK</button></form>
                {canAccess && !a.user_id && ['contract', 'approved'].includes(a.status) && <div className="mt8"><CreateAccess lang={L} id={a.id} curators={curators} /></div>}
                {a.user_id && <div className="tiny okc mt8">{T('Доступ создан')} · <Link href={`/admin/users/${a.user_id}`}>{T('Открыть')}</Link></div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="small muted mt8">{T('Путь заявки: новая → проверка (созвон, лицензия) → договор на бумаге → одобрена (доступ, проекты рынка, лимит броней). Отказ — с причиной.')}</div>
        <div className="h2 mt24">{T('Подключённые агенты')}</div>
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Агент', 'Агентство', 'Куратор', 'Лицензия', 'Договор', 'Клиенты', 'Брони', 'Сделки'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{agents.map((a) => <tr key={a.id}><td>{canAccess ? <Link href={`/admin/users/${a.id}`}><b>{a.name}</b></Link> : <b>{a.name}</b>}<div className="tiny muted">{a.email} · {a.market}</div></td><td className="small">{a.agency || T('частный')}</td><td className="small">{a.curator || '—'}</td><td className="small">{a.license_note || '—'}</td><td className="small">{a.contract_signed_at ? T('подписан {d}', { d: date(L, a.contract_signed_at) }) : '—'}</td><td>{a.clients}</td><td>{a.bookings}</td><td>{a.deals}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  )
}
