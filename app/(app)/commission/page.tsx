import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, date, pct } from '@/lib/i18n'
import { bookingScope } from '@/lib/scope'
import { conditionsFor, listProjects } from '@/lib/catalog'
import { expectedAgent, type SplitCond } from '@/lib/money'
import { Top, Pill } from '@/components/ui'
import { ACT_STATUS } from '@/lib/acts'
import { one } from '@/lib/db'
import { savePayoutProfile } from '@/lib/moneyActions'

export default async function Commission() {
  const c = await requireCtx()
  // «Комиссия» — кабинет партнёра; команде — «Финансы» (QA 09.11)
  if (!['agent', 'agency_head'].includes(c.user.role)) redirect(['owner', 'market_head', 'finance'].includes(c.user.role) ? '/finance' : '/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const bs = bookingScope(c.user)
  const deals = await q<{ id: string; unit: string; client: string; stage: string; final_price: number; agent_amount: number; paid_pct: number; paid_out_at: string | null; created_at: string }>(
    `select d.id, portal.unit_no(bl.external_id, un.number) unit, cl.name client, d.stage, d.final_price::float, d.agent_amount::float, d.paid_pct::float, d.paid_out_at, d.created_at
     from portal.deals d join portal.bookings b on b.id = d.booking_id join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = d.client_id where ${bs.sql} order by d.created_at desc`, bs.params)
  const pipe = (await q<{ unit: string; client: string; final_price: number; ends_at: string; snapshot: SplitCond; price_list: number; discount_pct: number }>(
    `select portal.unit_no(bl.external_id, un.number) unit, cl.name client, b.final_price::float, b.snapshot, b.price_list::float, b.discount_pct::float, b.ends_at
     from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id where b.status in ('requested','confirmed') and ${bs.sql}`, bs.params)).map((b) => ({ ...b, agent: expectedAgent(b) }))
  const acts = await q<{ id: string; unit: string; amount: number; deducted: number; clawback_left: number; status: string; number: string | null; pdf: string | null; paid_at: string | null }>(
    `select ca.id, portal.unit_no(bl.external_id, un.number) unit, ca.amount::float, ca.deducted::float, ca.clawback_left::float, ca.status, doc.number, doc.pdf_file_id pdf, ca.paid_at
     from portal.commission_acts ca join portal.deals d on d.id = ca.deal_id join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id left join portal.documents doc on doc.id = ca.document_id
     where ${c.user.role === 'agency_head' ? 'ca.agent_id in (select id from portal.users where agency_id = $1)' : 'ca.agent_id = $1'} order by ca.created_at desc`, [c.user.role === 'agency_head' ? c.user.agency_id : c.user.id])
  const owed = acts.filter((a) => a.status === 'clawback').reduce((x, a) => x + a.clawback_left, 0)
  // Ставки — только по проектам, открытым партнёру (черновики и закрытые не показываем)
  const projects = await listProjects(c.user)
  const rates = await Promise.all(projects.map(async (p) => [p.name, await conditionsFor(p.id, c.user)] as const))
  const paid = deals.filter((d) => d.stage === 'paid_out').reduce((a, d) => a + d.agent_amount, 0)
  const pending = deals.filter((d) => d.stage !== 'paid_out' && d.stage !== 'cancelled').reduce((a, d) => a + d.agent_amount, 0)
  const inBookings = pipe.reduce((a, b) => a + (b.agent || 0), 0)
  // 2.2 · §8: доля по траншам — «ждём оплату клиента / ожидаем от застройщика / в реестре за месяц / выплачено»; сотрудник агентства видит долю агентства как ориентир
  const payee = c.user.role === 'agency_head' || !c.user.agency_id
  const trs = await q<{ unit: string; no: number; pct: number; share: number; status: string; expected_at: string | null; acc: string | null; reg_month: string | null }>(
    `select portal.unit_no(bl.external_id, un.number) unit, t.no, t.pct::float, round(s.amount * t.pct / 100, 2)::float share, t.status, t.expected_at::text,
       (select a.status from portal.accruals a where a.tranche_id = t.id and a.role = 'partner' limit 1) acc,
       (select r.month::text from portal.accruals a join portal.payout_registers r on r.id = a.register_id where a.tranche_id = t.id and a.role = 'partner' limit 1) reg_month
     from portal.tranches t join portal.deals d on d.id = t.deal_id join portal.deal_shares s on s.deal_id = d.id and s.role = 'partner'
       join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = d.client_id
     where t.status <> 'cancelled' and (s.user_id = $1 or cl.owner_id = $1) order by d.created_at desc, t.no`, [c.user.id])
  const debt = payee ? (await one<{ s: number }>(`select coalesce(sum(amount), 0)::float s from portal.accruals where user_id = $1 and status = 'open' and role = 'partner'`, [c.user.id]))?.s || 0 : 0
  const prof = await one<{ partner_form: string | null; vat_payer: boolean; vat_no: string | null; tax_country: string | null; tax_no: string | null; tax_cert_until: string | null }>(
    'select partner_form, vat_payer, vat_no, tax_country, tax_no, tax_cert_until::text from portal.users where id = $1', [c.user.id])
  const myActs = await q<{ id: string; act_no: string; act_date: string; net: number; currency: string | null; amount_cur: number | null; agreed_at: string | null; carried: boolean; paid: boolean }>(
    `select l.id, l.act_no, l.act_date::text, l.net::float, l.currency, l.amount_cur::float, l.agreed_at, l.carried, r.status = 'paid' and not l.carried paid
     from portal.payout_lines l join portal.payout_registers r on r.id = l.register_id where l.user_id = $1 and l.act_no is not null order by l.act_date desc`, [c.user.id])
  const trL = (x: { status: string; acc: string | null; reg_month: string | null; expected_at: string | null }): [string, 'ok' | 'warn' | 'ink' | 'off'] =>
    x.acc === 'paid' ? [T('выплачено'), 'ink'] : x.acc === 'in_register' ? [T('в реестре выплат за {m}', { m: (x.reg_month || '').slice(0, 7) }), 'ok'] : x.status === 'received' ? [T('получено — войдёт в ближайший реестр'), 'ok']
      : x.status === 'expected' ? [T('ожидаем от застройщика') + (x.expected_at ? ' · ' + date(L, x.expected_at) : ''), 'warn'] : [T('ждём оплату клиента'), 'off']
  const stageL: Record<string, [string, 'ok' | 'warn' | 'ink' | 'off']> = { contract: ['договор подписан, ждём платёж', 'warn'], payments: ['клиент платит, ждём оплату застройщика', 'warn'], fee_received: ['застройщик оплатил — к выплате', 'ok'], paid_out: ['выплачено', 'ink'], cancelled: ['отменена', 'off'] }
  return (
    <>
      <Top title={T('Комиссия')} sub={T('Выплата — после того, как застройщик оплатил вознаграждение GetsEstate, в той же пропорции')} />
      <div className="page">
        <div className="grid g3">
          {[[T('Выплачено'), usd(L, paid)], [T('По сделкам в работе'), usd(L, pending)], [T('В активных бронях (ожидаемо)'), usd(L, inBookings)]].map(([a, b]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v">{b}</div></div>)}
        </div>
        {trs.length > 0 && <>
          <div className="h2 mt24">{T('Доля по траншам застройщика')}</div>
          {!payee && <div className="small muted">{T('Ориентир: доля агентства по вашим сделкам. Акты и выплаты — у руководителя агентства.')}</div>}
          <div className="tbl-wrap mt8"><table className="tbl"><thead><tr>{['Квартира', 'Транш', 'Доля', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{trs.map((x, i) => { const [l, k] = trL(x); return <tr key={i}><td><b>{x.unit}</b></td><td className="small">№{x.no} · {Math.round(x.pct * 100) / 100}%</td><td>{usd(L, x.share)}</td><td><Pill kind={k}>{l}</Pill></td></tr> })}</tbody></table></div>
          <div className="tiny muted mt8">{T('Выплата раз в месяц: поступление от застройщика до конца месяца — выплата до 10-го следующего месяца. Меньше 100 $ переносится.')}</div>
        </>}
        {myActs.length > 0 && <>
          <div className="h2 mt24" id="acts">{T('Акты за месяц')}</div>
          <div className="tbl-wrap mt8"><table className="tbl"><thead><tr>{['Акт', 'К выплате', 'Статус', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>{myActs.map((a) => <tr key={a.id}><td><b>{a.act_no}</b><div className="tiny muted">{date(L, a.act_date)}</div></td>
              <td>{usd(L, a.net)}{a.currency && a.currency !== 'USD' ? <div className="tiny muted">{a.amount_cur?.toLocaleString('en')} {a.currency}</div> : null}</td>
              <td><Pill kind={a.paid ? 'ink' : a.carried ? 'warn' : a.agreed_at ? 'ok' : 'warn'}>{T(a.paid ? 'выплачено' : a.carried ? 'перенесено' : a.agreed_at ? 'согласован — ждёт оплаты' : 'нужно согласие')}</Pill></td>
              <td><Link className="btn btn--sm" href={`/commission/act/${a.id}`}>{T('Открыть')}</Link></td></tr>)}</tbody></table></div>
        </>}
        {debt < 0 && <div className="err mt16">{T('Удержание по расторгнутой сделке: {a} — зачтём из следующих выплат', { a: usd(L, -debt) })}</div>}
        {payee && <form action={savePayoutProfile} className="card stack mt24" style={{ gap: 10 }}>
          <div className="h3" style={{ margin: 0 }}>{T('Данные для выплат')}</div>
          <div className="small muted">{T('Компания или ИП — счёт против нашего акта; физлицо — акт и налоговый номер. Без документа выплата переносится на следующий месяц.')}</div>
          <div className="grid g3">
            <label className="field"><span>{T('Форма')}</span><select className="in" name="partner_form" defaultValue={prof?.partner_form || ''}><option value="">—</option><option value="company">{T('Компания')}</option><option value="sole">{T('ИП')}</option><option value="individual">{T('Физлицо')}</option></select></label>
            <label className="field"><span>{T('Налоговый номер')}</span><input className="in" name="tax_no" defaultValue={prof?.tax_no || ''} /></label>
            <label className="field"><span>{T('Страна налогового резидентства (код)')}</span><input className="in" name="tax_country" maxLength={2} defaultValue={prof?.tax_country || ''} placeholder="DE" /></label>
            <label className="field"><span>{T('Сертификат резидентства действует до')}</span><input className="in" type="date" name="tax_cert_until" defaultValue={prof?.tax_cert_until || ''} /></label>
            <label className="field"><span>{T('Номер плательщика НДС')}</span><input className="in" name="vat_no" defaultValue={prof?.vat_no || ''} /></label>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="vat_payer" defaultChecked={!!prof?.vat_payer} /> {T('Плательщик НДС — добавлю НДС к сумме акта')}</label>
          </div>
          <div><button className="btn btn--sm">{T('Сохранить')}</button></div>
        </form>}
        <div className="h2 mt24">{T('Сделки')}</div>
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Квартира', 'Клиент', 'Цена сделки', 'Ваша комиссия', 'Оплачено клиентом', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {deals.length === 0 && <tr><td colSpan={6} className="muted">{T('Сделок пока нет')}</td></tr>}
            {deals.map((d) => <tr key={d.id}><td><b>{d.unit}</b></td><td>{d.client}</td><td>{usd(L, d.final_price)}</td><td><b>{usd(L, d.agent_amount)}</b></td><td>{pct(L, d.paid_pct)}</td><td><Pill kind={stageL[d.stage][1]}>{T(stageL[d.stage][0])}</Pill>{d.paid_out_at && <div className="tiny muted">{date(L, d.paid_out_at)}</div>}</td></tr>)}
          </tbody>
        </table></div>
        <div className="h2 mt24">{T('Акты')}</div>
        {owed > 0 && <div className="note mt8">{T('К удержанию из следующих выплат: {a} — по расторгнутым сделкам.', { a: usd(L, owed) })}</div>}
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Квартира', 'Комиссия', 'Удержано', 'К выплате', 'Статус', 'Акт'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {acts.length === 0 && <tr><td colSpan={6} className="muted">{T('Актов пока нет')}</td></tr>}
            {acts.map((a) => <tr key={a.id}><td><b>{a.unit}</b></td><td>{usd(L, a.amount)}</td><td>{a.deducted ? '−' + usd(L, a.deducted) : '—'}</td><td><b>{a.status === 'clawback' || a.status === 'void' ? '—' : usd(L, a.amount - a.deducted)}</b></td>
              <td><Pill kind={ACT_STATUS[a.status][1]}>{T(ACT_STATUS[a.status][0])}</Pill>{a.paid_at && <div className="tiny muted">{date(L, a.paid_at)}</div>}</td><td className="small">{a.number ? <>{a.number}{a.pdf && <> · <a href={`/files/${a.pdf}`} target="_blank">PDF</a></>}</> : '—'}</td></tr>)}
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
