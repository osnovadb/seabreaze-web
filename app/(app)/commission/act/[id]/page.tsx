import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, date } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { agreeAct } from '@/lib/moneyActions'
import { PrintButton } from '@/components/PrintButton'
import { InvoiceForm } from './invoice'

// 2.2 · §8 Акт вознаграждения за месяц: суммы без НДС в USD и в валюте получателя по курсу на дату акта; корректировки и клаубэк — строками со ссылкой на продажу
const ENTITY: Record<string, string> = { DE: 'GetsEstate GmbH (DE)', IL: 'GetsEstate IL Ltd (IL)' }
export default async function Act({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const l = await one<{ id: string; register_id: string; user_id: string; role: string; market: string | null; gross: number; withheld: number; net: number; act_no: string | null; act_date: string | null; currency: string | null; fx_rate: number | null; fx_source: string | null; amount_cur: number | null; agreed_at: string | null; invoice_file_id: string | null; month: string; name: string; email: string; partner_form: string | null; tax_no: string | null; vat_payer: boolean; vat_no: string | null; tax_country: string | null }>(
    `select l.id, l.register_id, l.user_id, l.role, l.market, l.gross::float, l.withheld::float, l.net::float, l.act_no, l.act_date::text, l.currency, l.fx_rate::float, l.fx_source, l.amount_cur::float, l.agreed_at, l.invoice_file_id,
       r.month::text, u.name, u.email, u.partner_form, u.tax_no, u.vat_payer, u.vat_no, u.tax_country
     from portal.payout_lines l join portal.payout_registers r on r.id = l.register_id join portal.users u on u.id = l.user_id where l.id = $1`, [params.id])
  if (!l || !l.act_no || (l.user_id !== c.user.id && !['owner', 'finance'].includes(c.user.role))) notFound()
  const rows = await q<{ unit: string | null; project: string | null; kind: string; tranche: number | null; amount: number; note: string | null }>(
    `select portal.unit_no(bl.external_id, un.number) unit, p.name project, a.kind, t.no tranche, a.amount::float, a.note
     from portal.accruals a left join portal.deals d on d.id = a.deal_id left join units un on un.id = d.unit_id left join buildings bl on bl.id = un.building_id left join projects p on p.id = d.project_id
       left join portal.tranches t on t.id = a.tranche_id
     where a.register_id = $1 and a.user_id = $2 and a.role = $3 order by a.kind, p.name, unit`, [l.register_id, l.user_id, l.role])
  const own = l.user_id === c.user.id
  const KIND: Record<string, string> = { share: 'вознаграждение по траншу', adjustment: 'корректировка', clawback: 'клаубэк (удержание)' }
  return (
    <>
      <Top crumbs={[[T('Комиссия'), '/commission'], [l.act_no]]} title={T('Акт {n} от {d}', { n: l.act_no, d: date(L, l.act_date) })} sub={T('Период: поступления от застройщиков за {m}', { m: l.month.slice(0, 7) })}
        right={<PrintButton label={T('Скачать PDF')} />} />
      <div className="page stack">
        <div className="card stack" style={{ gap: 6 }}>
          <div className="kv"><span>{T('Заказчик')}</span><b>{ENTITY[l.market || ''] || 'Caspian (AZ)'}</b></div>
          <div className="kv"><span>{T('Исполнитель')}</span><b>{l.name}</b></div>
          <div className="kv"><span>{T('Форма, налоговый номер')}</span><span>{[l.partner_form && T({ company: 'Компания', sole: 'ИП', individual: 'Физлицо' }[l.partner_form] || ''), l.tax_no, l.tax_country].filter(Boolean).join(' · ') || '—'}</span></div>
          {l.vat_payer && <div className="kv"><span>{T('НДС')}</span><span>{T('исполнитель — плательщик НДС ({v}): НДС добавляется к сумме акта по его статусу', { v: l.vat_no || '—' })}</span></div>}
        </div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Продажа', 'Основание', 'Сумма, USD без НДС'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{r.unit ? <b>{r.unit}</b> : '—'}<div className="tiny muted">{r.project}</div></td><td className="small">{T(KIND[r.kind] || r.kind)}{r.tranche ? ` · №${r.tranche}` : ''}{r.note ? <div className="tiny muted">{r.note}</div> : null}</td><td className={r.amount < 0 ? 'badc' : ''}>{usd(L, r.amount)}</td></tr>)}</tbody>
        </table></div>
        <div className="card stack" style={{ gap: 6 }}>
          <div className="kv"><span>{T('Итого, USD')}</span><b>{usd(L, l.gross)}</b></div>
          {l.withheld > 0 && <div className="kv"><span>{T('Удержание налога')}</span><span>−{usd(L, l.withheld)}</span></div>}
          <div className="kv"><span>{T('К выплате, USD')}</span><b>{usd(L, l.net)}</b></div>
          {l.currency && l.currency !== 'USD' && <div className="kv"><span>{T('К выплате в валюте получателя')}</span><b>{l.amount_cur?.toLocaleString('en', { maximumFractionDigits: 2 })} {l.currency}</b></div>}
          {l.currency && l.currency !== 'USD' && <div className="tiny muted">{T('Курс {r} {c} за 1 USD на {d} ({s}). Платим сумму в валюте получателя из акта; курсовая разница — наша. Комиссии банков — SHA.', { r: l.fx_rate || 1, c: l.currency, d: date(L, l.act_date), s: l.fx_source || '' })}</div>}
        </div>
        <div className="row noprint" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {l.agreed_at ? <Pill kind="ok">{T('Согласовано {d}', { d: date(L, l.agreed_at) })}</Pill> : own ? <form action={agreeAct}><input type="hidden" name="id" value={l.id} /><button className="btn btn--p">{T('Согласен с актом')}</button></form> : <Pill kind="warn">{T('ждём согласия партнёра')}</Pill>}
          {['company', 'sole'].includes(l.partner_form || '') && (l.invoice_file_id ? <a className="small" href={`/files/${l.invoice_file_id}`} target="_blank">{T('Счёт загружен')}</a> : own ? <InvoiceForm lang={L} id={l.id} /> : <Pill kind="warn">{T('ждём счёт')}</Pill>)}
        </div>
        <div className="tiny muted">{T('Без согласия с актом (и счёта у компании или ИП) к 10-му выплата переносится на следующий месяц.')}</div>
      </div>
    </>
  )
}
