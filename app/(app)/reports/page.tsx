import { redirect } from 'next/navigation'
import { SOURCE_LABEL } from '@/lib/stages'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, pct } from '@/lib/i18n'
import { canSeeFinance, isExternal } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { Top, PARTNER_STAGES } from '@/components/ui'
import { STAFF_STAGES } from '@/lib/stages'
import { STAGE_COLS_SQL, colOf, type StageColsRow } from '@/lib/stageCols'
import { split, type SplitCond } from '@/lib/money'

const SRC = SOURCE_LABEL
type Row = { key: string; clients: number; active: number; booked: number; deals: number; lost: number }

// Отчёты команды (ТЗ, «CRM»): воронка и конверсия по владельцам, источникам и рынкам, причины отказов, прогноз вознаграждения.
// Время на стадии появится, когда переходы будут писаться отдельной таблицей.
export default async function Reports() {
  const c = await requireCtx()
  if (!['owner', 'market_head', 'seller'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const cs = clientScope(c.user)
  const by = (expr: string) => q<Row>(`select ${expr} as key, count(*)::int clients,
      count(*) filter (where cl.stage not in ('lost','handed') and cl.pause_until is null)::int active,
      count(*) filter (where exists (select 1 from portal.bookings b where b.client_id = cl.id))::int booked,
      count(*) filter (where exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled'))::int deals,
      count(*) filter (where cl.stage = 'lost')::int lost
    from portal.clients cl join portal.users us on us.id = cl.owner_id left join portal.agencies ag on ag.id = cl.agency_id
    where ${cs.sql} group by 1 order by clients desc`, cs.params)
  const [byOwner, bySource, byMarket] = await Promise.all([by(`us.name || coalesce(' · ' || ag.name, '')`), by(`case when cl.source in ('site','website') or cl.source like 'site%' then 'site' else coalesce(cl.source, '—') end`), by(`coalesce(cl.market, '—')`)])
  // 382: шкала — как на главной (сотрудникам стадии Bitrix24, партнёру — короткая); без клиентов на паузе
  const ext = isExternal(c.user.role)
  const cols = ext ? PARTNER_STAGES.map(([k, l]) => [k, T(l)] as [string, string]) : STAFF_STAGES
  const crow = await q<{ stage: string } & StageColsRow>(`select cl.stage, ${STAGE_COLS_SQL} from portal.clients cl where ${cs.sql} and cl.pause_until is null`, cs.params)
  const stages = [...cols.map(([k]) => k), 'lost'].map((k) => ({ stage: k, n: crow.filter((x) => (x.stage === 'lost' ? 'lost' : colOf(x, ext)) === k).length }))
  const lost = await q<{ reason: string; n: number }>(`select coalesce(nullif(lost_reason, ''), '—') reason, count(*)::int n from portal.clients cl where ${cs.sql} and stage = 'lost' group by 1 order by 2 desc`, cs.params)
  const fin = canSeeFinance(c.user.role)
  const deals = fin ? await q<{ our: number; agent: number; seller: number }>(`select d.our_amount::float our, d.agent_amount::float agent, d.seller_amount::float seller from portal.deals d join portal.clients cl on cl.id = d.client_id where ${cs.sql} and d.stage not in ('cancelled','paid_out')`, cs.params) : []
  const books = fin ? await q<{ snapshot: SplitCond; price_list: number; discount_pct: number; ext: boolean }>(`select b.snapshot, b.price_list::float, b.discount_pct::float, us.role in ('agent','agency_head') ext
    from portal.bookings b join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id where ${cs.sql} and b.status in ('requested','confirmed')`, cs.params) : []
  const fb = books.map((b) => split(b.snapshot, b.price_list, b.discount_pct, b.ext))
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
  const total = stages.reduce((a, s) => a + s.n, 0) || 1
  const Table = ({ title, rows }: { title: string; rows: Row[] }) => (
    <div className="card">
      <div className="h3">{title}</div>
      <div className="tbl-wrap mt8"><table className="tbl">
        <thead><tr>{['', 'Клиентов', 'В работе', 'С бронью', 'Сделки', 'Отказы', 'Конверсия'].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{T(SRC[r.key] || r.key)}</td><td className="num">{r.clients}</td><td className="num">{r.active}</td><td className="num">{r.booked}</td><td className="num">{r.deals}</td><td className="num">{r.lost}</td><td className="num">{pct(L, Math.round((r.deals / Math.max(1, r.clients)) * 1000) / 10)}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
  return (
    <>
      <Top title={T('Отчёты')} right={<>{<a className="btn" href="/reports/stock">{T('Остатки и темп')} →</a>}{['owner', 'market_head'].includes(c.user.role) && <><a className="btn" href="/reports/team">{T('Команда')} →</a><a className="btn" href="/reports/plan">{T('План и факт')} →</a></>}</>} sub={c.user.role === 'seller' ? T('Ваши клиенты и клиенты ваших агентов') : c.user.role === 'market_head' ? T('Ваш рынок') : T('Все рынки')} />
      <div className="page stack">
        {fin && (
          <div className="grid g4">
            {[[T('Прогноз нашего дохода: сделки в работе'), usd(L, sum(deals.map((d) => d.our)))], [T('Прогноз нашего дохода: активные брони'), usd(L, sum(fb.map((s) => s.ours)))],
              [T('К выплате агентам (сделки и брони)'), usd(L, sum(deals.map((d) => d.agent)) + sum(fb.map((s) => s.agent)))], [T('Продавцам (сделки)'), usd(L, sum(deals.map((d) => d.seller)))]].map(([a, b]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v">{b}</div></div>)}
          </div>
        )}
        <div className="card">
          <div className="h3">{T('Воронка')}</div>
          {stages.map(({ stage: k, n }) => { return (
            <div key={k} className="row mt8" style={{ gap: 10 }}><span className="small" style={{ width: 200 }}>{k === 'lost' ? T('Отказ') : cols.find(([x]) => x === k)?.[1] || k}</span><div style={{ flex: 1, height: 10, background: 'var(--stone)', borderRadius: 5 }}><div style={{ width: `${(n / total) * 100}%`, height: 10, borderRadius: 5, background: k === 'lost' ? 'var(--bad-line)' : 'var(--deep-3)' }} /></div><span className="num small" style={{ width: 30, textAlign: 'end' }}>{n}</span></div>
          ) })}
        </div>
        <Table title={T('По владельцу клиента')} rows={byOwner} />
        <div className="stack">{/* О56 (обход 11.11): семь колонок не помещались в половину ширины — таблицы одна под другой */}
          <Table title={T('По источнику')} rows={bySource} />
          <Table title={T('По рынку')} rows={byMarket} />
        </div>
        <div className="card">
          <div className="h3">{T('Причины отказов')}</div>
          {lost.length === 0 ? <div className="small muted">{T('Отказов пока нет')}</div> : lost.map((r) => <div key={r.reason} className="kv"><span>{T(r.reason)}</span><span className="num">{r.n}</span></div>)}
        </div>
      </div>
    </>
  )
}
