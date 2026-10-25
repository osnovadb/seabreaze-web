import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, date, pct } from '@/lib/i18n'
import { bookingScope } from '@/lib/scope'
import { conditionsFor } from '@/lib/catalog'
import { Top, Pill } from '@/components/ui'

export default async function Commission() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const bs = bookingScope(c.user)
  const deals = await q<{ id: string; unit: string; client: string; stage: string; final_price: number; agent_amount: number; paid_pct: number; paid_out_at: string | null; created_at: string }>(
    `select d.id, coalesce(bl.external_id,'') || '-' || un.number unit, cl.name client, d.stage, d.final_price::float, d.agent_amount::float, d.paid_pct::float, d.paid_out_at, d.created_at
     from portal.deals d join portal.bookings b on b.id = d.booking_id join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = d.client_id where ${bs.sql} order by d.created_at desc`, bs.params)
  const pipe = await q<{ unit: string; client: string; final_price: number; agent: number; ends_at: string }>(
    `select coalesce(bl.external_id,'') || '-' || un.number unit, cl.name client, b.final_price::float, (b.snapshot->'split'->>'agent')::float agent, b.ends_at
     from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id where b.status in ('requested','confirmed') and ${bs.sql}`, bs.params)
  const projects = await q<{ id: string; name: string }>('select id, name from projects order by sort, name')
  const rates = await Promise.all(projects.map(async (p) => [p.name, await conditionsFor(p.id, c.user)] as const))
  const paid = deals.filter((d) => d.stage === 'paid_out').reduce((a, d) => a + d.agent_amount, 0)
  const pending = deals.filter((d) => d.stage !== 'paid_out' && d.stage !== 'cancelled').reduce((a, d) => a + d.agent_amount, 0)
  const inBookings = pipe.reduce((a, b) => a + (b.agent || 0), 0)
  const stageL: Record<string, [string, 'ok' | 'warn' | 'ink' | 'off']> = { contract: ['договор подписан, ждём платёж', 'warn'], payments: ['клиент платит, ждём оплату застройщика', 'warn'], fee_received: ['застройщик оплатил — к выплате', 'ok'], paid_out: ['выплачено', 'ink'], cancelled: ['отменена', 'off'] }
  return (
    <>
      <Top title={T('Комиссия')} sub={T('Выплата — после того, как застройщик оплатил вознаграждение GetsEstate, в той же пропорции')} />
      <div className="page">
        <div className="grid g3">
          {[[T('Выплачено'), usd(L, paid)], [T('По сделкам в работе'), usd(L, pending)], [T('В активных бронях (ожидаемо)'), usd(L, inBookings)]].map(([a, b]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v">{b}</div></div>)}
        </div>
        <div className="h2 mt24">{T('Сделки')}</div>
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Квартира', 'Клиент', 'Цена сделки', 'Ваша комиссия', 'Оплачено клиентом', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {deals.length === 0 && <tr><td colSpan={6} className="muted">{T('Сделок пока нет')}</td></tr>}
            {deals.map((d) => <tr key={d.id}><td><b>{d.unit}</b></td><td>{d.client}</td><td>{usd(L, d.final_price)}</td><td><b>{usd(L, d.agent_amount)}</b></td><td>{pct(L, d.paid_pct)}</td><td><Pill kind={stageL[d.stage][1]}>{T(stageL[d.stage][0])}</Pill>{d.paid_out_at && <div className="tiny muted">{date(L, d.paid_out_at)}</div>}</td></tr>)}
          </tbody>
        </table></div>
        <div className="h2 mt24">{T('Активные брони')}</div>
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Квартира', 'Клиент', 'Цена', 'Ожидаемая комиссия', 'Бронь до'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{pipe.map((b, i) => <tr key={i}><td><b>{b.unit}</b></td><td>{b.client}</td><td>{usd(L, b.final_price)}</td><td>{b.agent ? usd(L, b.agent) : '—'}</td><td>{date(L, b.ends_at)}</td></tr>)}</tbody>
        </table></div>
        <div className="h2 mt24">{T('Ваши ставки')}</div>
        <div className="grid g2 mt8">
          {rates.map(([n, r]) => r && <div key={n} className="card card--tight"><b>{n}</b><div className="small mt8">{T('Фикс {f} от итоговой цены + часть пула {p} от прайса', { f: pct(L, r.agent_fix_pct), p: pct(L, r.agent_pool_pct) })}</div><div className="tiny muted">{T('Акты и счета — по сделке после оплаты застройщиком. Договор — на бумаге.')}</div></div>)}
        </div>
      </div>
    </>
  )
}
