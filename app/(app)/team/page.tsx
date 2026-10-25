import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { NewAgent } from './form'
import { toggleAgencyAgent } from '@/lib/actions'

export default async function Team() {
  const c = await requireCtx()
  if (c.user.role !== 'agency_head') redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const rows = await q<{ id: string; name: string; email: string; role: string; active: boolean; last_login_at: string | null; clients: number; bookings: number; deals: number }>(
    `select u.id, u.name, u.email, u.role, u.active, u.last_login_at, (select count(*)::int from portal.clients where owner_id = u.id) clients,
      (select count(*)::int from portal.bookings where agent_id = u.id and status in ('requested','confirmed')) bookings, (select count(*)::int from portal.deals where agent_id = u.id) deals
     from portal.users u where u.agency_id = $1 order by u.role, u.name`, [c.user.agency_id])
  return (
    <>
      <Top title={T('Сотрудники агентства')} sub={T('Клиенты закрепляются за агентством; руководитель видит клиентов и брони сотрудников')} />
      <div className="page">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Сотрудник', 'Клиенты', 'Брони', 'Сделки', 'Последний вход', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><b>{r.name}</b><div className="tiny muted">{r.email}</div></td><td>{r.clients}</td><td>{r.bookings}</td><td>{r.deals}</td><td className="small muted">{date(L, r.last_login_at)}</td><td>{r.role === 'agent' && <form action={toggleAgencyAgent} className="row" style={{ gap: 6 }}><input type="hidden" name="id" value={r.id} />{!r.active && <Pill kind="off">{T('отключён')}</Pill>}<button className="btn btn--sm">{r.active ? T('Отключить') : T('Включить')}</button></form>}</td></tr>)}</tbody>
        </table></div>
        <div className="mt16"><NewAgent lang={L} /></div>
      </div>
    </>
  )
}
