import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, pct, date } from '@/lib/i18n'
import { canSeeFinance } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { dealStage, dealPaid } from '@/lib/actions'

export default async function Finance() {
  const c = await requireCtx()
  if (!canSeeFinance(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const deals = await q<{ id: string; unit: string; project: string; client: string; agent: string | null; seller: string | null; stage: string; final_price: number; agent_amount: number; our_amount: number; seller_amount: number; paid_pct: number; created_at: string }>(
    `select d.id, coalesce(bl.external_id,'') || '-' || un.number unit, p.name project, cl.name client, ag.name agent, se.name seller, d.stage, d.final_price::float, d.agent_amount::float, d.our_amount::float, d.seller_amount::float, d.paid_pct::float, d.created_at
     from portal.deals d join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join projects p on p.id = d.project_id join portal.clients cl on cl.id = d.client_id
     left join portal.users ag on ag.id = d.agent_id left join portal.users se on se.id = d.seller_id ${c.user.role === 'market_head' ? 'where cl.market = $1' : ''} order by d.created_at desc`, c.user.role === 'market_head' ? [c.user.market] : [])
  const sum = (k: 'final_price' | 'agent_amount' | 'our_amount' | 'seller_amount') => deals.filter((d) => d.stage !== 'cancelled').reduce((a, d) => a + d[k], 0)
  const stages: [string, string][] = [['contract', 'Договор'], ['payments', 'Платежи клиента'], ['fee_received', 'Вознаграждение получено'], ['paid_out', 'Выплачено агенту'], ['cancelled', 'Отменена']]
  return (
    <>
      <Top title={T('Финансы')} sub={T('Сделки, вознаграждение застройщика, выплаты агентам и продавцам')} />
      <div className="page">
        <div className="grid g4">{[[T('Оборот сделок'), sum('final_price')], [T('Наш доход'), sum('our_amount')], [T('Агентам'), sum('agent_amount')], [T('Продавцам'), sum('seller_amount')]].map(([a, b]) => <div key={a as string} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v">{usd(L, b as number)}</div></div>)}</div>
        <div className="tbl-wrap mt16"><table className="tbl">
          <thead><tr>{['Сделка', 'Клиент', 'Агент / продавец', 'Цена', 'Наш доход', 'Агенту', 'Продавцу', 'Оплачено', 'Стадия'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {deals.length === 0 && <tr><td colSpan={9} className="muted">{T('Сделок пока нет')}</td></tr>}
            {deals.map((d) => (
              <tr key={d.id}>
                <td><b>{d.unit}</b><div className="tiny muted">{d.project} · {date(L, d.created_at)}</div></td><td>{d.client}</td><td className="small">{d.agent || '—'}<div className="tiny muted">{d.seller}</div></td>
                <td>{usd(L, d.final_price)}</td><td><b>{usd(L, d.our_amount)}</b></td><td>{usd(L, d.agent_amount)}</td><td>{usd(L, d.seller_amount)}</td><td>{['owner', 'finance'].includes(c.user.role) ? <form action={dealPaid} className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><input type="hidden" name="id" value={d.id} /><input className="in" name="paid" type="number" min={0} max={100} defaultValue={d.paid_pct} style={{ height: 30, width: 64 }} /><button className="btn btn--sm" title={T('Сохранить')}>%</button></form> : pct(L, d.paid_pct)}</td>
                <td>{['owner', 'finance'].includes(c.user.role) ? (
                  <form action={dealStage} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><input type="hidden" name="id" value={d.id} /><select className="in" name="stage" defaultValue={d.stage} style={{ height: 30, width: 190 }}>{stages.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select><button className="btn btn--sm">OK</button></form>
                ) : <Pill kind="warn">{T((stages.find((x) => x[0] === d.stage) || ['', d.stage])[1])}</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="small muted mt8">{T('Суммы считаются по условиям проекта на дату брони (снимок условий хранится в брони).')}</div>
      </div>
    </>
  )
}
