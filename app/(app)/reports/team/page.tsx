import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, num, monthName, bakuToday } from '@/lib/i18n'
import { Top } from '@/components/ui'

type R = { id: string; name: string; role: string; market: string | null; clients: number; bookings: number; expired: number; deals: number; deals_usd: number; conv_b: number; conv_d: number; overdue: number; open_b: number; idle: number }
const ROLE: Record<string, string> = { owner: 'владелец', market_head: 'руководитель рынка', seller: 'продавец', agency_head: 'агентство', agent: 'агент' }

// Дашборд руководителя продаж (группа 4): по каждому, кто ведёт клиентов, — новые клиенты, брони и сделки за месяц,
// конверсия бронь → сделка за всё время, просроченные задачи и клиенты без активности. Руководитель рынка видит свой рынок.
export default async function Team({ searchParams }: { searchParams: { m?: string } }) {
  const c = await requireCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const cur = bakuToday().slice(0, 7)
  const m = /^\d{4}-\d{2}$/.test(searchParams.m || '') && searchParams.m! <= cur ? searchParams.m! : cur
  const market = c.user.role === 'market_head' ? c.user.market : null
  const rows = await q<R>(`select us.id, us.name, us.role, us.market,
      (select count(*)::int from portal.clients cl where cl.owner_id = us.id and to_char(cl.created_at, 'YYYY-MM') = $1) clients,
      (select count(*)::int from portal.bookings b where b.agent_id = us.id and to_char(b.created_at, 'YYYY-MM') = $1) bookings,
      (select count(*)::int from portal.bookings b where b.agent_id = us.id and b.status = 'expired' and to_char(b.ends_at, 'YYYY-MM') = $1) expired,
      (select count(*)::int from portal.deals d where (d.agent_id = us.id or d.seller_id = us.id) and d.stage <> 'cancelled' and to_char(d.created_at, 'YYYY-MM') = $1) deals,
      (select coalesce(sum(d.final_price), 0)::float from portal.deals d where (d.agent_id = us.id or d.seller_id = us.id) and d.stage <> 'cancelled' and to_char(d.created_at, 'YYYY-MM') = $1) deals_usd,
      (select count(*)::int from portal.bookings b where b.agent_id = us.id) conv_b,
      (select count(*)::int from portal.bookings b where b.agent_id = us.id and exists (select 1 from portal.deals d where d.booking_id = b.id and d.stage <> 'cancelled')) conv_d,
      (select count(*)::int from portal.bookings b where b.agent_id = us.id and b.status in ('requested','confirmed')) open_b,
      (select count(*)::int from portal.tasks tk where tk.user_id = us.id and not tk.done and tk.due < current_date) overdue,
      (select count(*)::int from portal.clients cl where cl.owner_id = us.id and cl.stage not in ('lost','handed') and cl.pause_until is null and cl.last_activity_at < now() - interval '30 days') idle
    from portal.users us where us.active and us.role in ('owner','market_head','seller','agency_head','agent') and ($2::text is null or us.market = $2)
    order by us.role = 'owner', us.role, us.name`, [m, market])
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(Number(cur.slice(0, 4)), Number(cur.slice(5)) - 1 - i, 1)); return d.toISOString().slice(0, 7) })
  const sum = (k: keyof R) => rows.reduce((a, r) => a + (r[k] as number), 0)
  // Итог по сделкам — по разным сделкам: в строках сделка считается и агенту, и продавцу, в итоге — один раз
  const tot = (await q<{ n: number; usd: number }>(`select count(*)::int n, coalesce(sum(d.final_price), 0)::float usd from portal.deals d where d.stage <> 'cancelled' and to_char(d.created_at, 'YYYY-MM') = $1
    and exists (select 1 from portal.users us where us.id in (d.agent_id, d.seller_id) and us.active and us.role in ('owner','market_head','seller','agency_head','agent') and ($2::text is null or us.market = $2))`, [m, market]))[0]
  return (
    <>
      <Top crumbs={[[T('Отчёты'), '/reports'], [T('Команда')]]} title={T('Команда: брони, сделки, дисциплина')} sub={market ? T('Ваш рынок') + ' · ' + market : T('Все рынки')}
        right={<Link className="btn" href="/reports/stock">{T('Остатки и темп')} →</Link>} />
      <div className="page">
        <div className="chips">{months.map((x) => <Link key={x} href={`?m=${x}`} className={'chip' + (x === m ? ' on' : '')}>{monthName(L, x)}</Link>)}</div>
        <div className="grid g4 mt16">
          {[[num(L, sum('clients')), T('новых клиентов')], [num(L, sum('bookings')), T('броней · истекло {n}', { n: sum('expired') })], [num(L, tot.n), T('сделок на {a}', { a: usd(L, tot.usd) })], [num(L, sum('overdue')), T('просроченных задач сейчас')]].map(([a, b]) => (
            <div key={b} className="card card--tight kpi"><div className="v" style={{ fontSize: 22 }}>{a}</div><div className="small muted">{b}</div></div>))}
        </div>
        <div className="tbl-wrap mt16"><table className="tbl">
          <thead><tr>{['Кто', 'Новые клиенты', 'Брони', 'Истекли', 'Сделки', 'Сумма сделок', 'Конверсия бронь → сделка', 'Активные брони', 'Просрочено задач', 'Без активности 30+ дн.'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{c.user.role === 'owner' ? <Link href={`/admin/users/${r.id}`}><b>{r.name}</b></Link> : <b>{r.name}</b>}<div className="tiny muted">{T(ROLE[r.role] || r.role)}{r.market ? ' · ' + r.market : ''}</div></td>
              <td className="num">{r.clients || '—'}</td><td className="num">{r.bookings || '—'}</td><td className={'num' + (r.expired ? ' warnc' : '')}>{r.expired || '—'}</td>
              <td className="num">{r.deals || '—'}</td><td className="num small">{r.deals_usd ? usd(L, r.deals_usd) : '—'}</td>
              <td className="num small">{r.conv_b ? `${Math.round((r.conv_d / r.conv_b) * 100)}% · ${r.conv_d}/${r.conv_b}` : '—'}</td><td className="num">{r.open_b || '—'}</td>
              <td className={'num' + (r.overdue ? ' badc' : '')}>{r.overdue || '—'}</td><td className={'num' + (r.idle ? ' warnc' : '')}>{r.idle || '—'}</td></tr>))}</tbody>
        </table></div>
        <div className="tiny muted mt8">{T('Брони и сделки — по тому, кто их поставил; сделка продавца считается и ему, и агенту. Конверсия — за всё время. Просроченные задачи и клиенты без активности — на сегодня.')}</div>
      </div>
    </>
  )
}
