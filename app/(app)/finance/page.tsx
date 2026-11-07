import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, pct, date } from '@/lib/i18n'
import { canSeeFinance } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { dealPaid } from '@/lib/actions'
import { actDocument, payActNow } from '@/lib/docActions'
import { ACT_STATUS } from '@/lib/acts'
import { ROLE_LABEL } from '@/lib/money22'
import { trancheReceived, recomputeShares, registerCollect, registerConfirm, registerApprove, registerPaid, saveWithholding } from '@/lib/moneyActions'
import { ActionForm } from '@/components/ActionForm'

// 2.2 · §8 Деньги. Админ — весь путь денег; руководитель рынка — свой рынок без доли Caspian; финансы — суммы к получению и выплате.
// Платим только из полученного: начисление появляется, когда финансы отмечают транш Received.
const TABS: [string, string][] = [['sales', 'Продажи и доли'], ['tranches', 'Транши от застройщиков'], ['register', 'Реестр выплат'], ['debts', 'Долги и клаубэк'], ['acts', 'Акты'], ['tax', 'Удержание налога']]
const TR: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { scheduled: ['ждём оплату клиента', 'off'], expected: ['ожидаем от застройщика', 'warn'], received: ['получено', 'ok'], cancelled: ['отменён', 'off'] }

export default async function Finance({ searchParams }: { searchParams: { tab?: string; m?: string } }) {
  const c = await requireCtx()
  if (!canSeeFinance(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const tab = TABS.some(([k]) => k === searchParams.tab) ? searchParams.tab! : 'sales'
  const fin = ['owner', 'finance'].includes(c.user.role), owner = c.user.role === 'owner', head = c.user.role === 'market_head'
  const mk = head ? `and cl.market = '${(c.user.market || '').replace(/'/g, '')}'` : ''
  const month = /^\d{4}-\d{2}$/.test(searchParams.m || '') ? searchParams.m! : new Date().toISOString().slice(0, 7)
  const Tabs = () => <div className="tabs">{TABS.filter(([k]) => fin || ['sales', 'tranches', 'register', 'debts'].includes(k)).map(([k, l]) => <a key={k} href={`?tab=${k}`} className={tab === k ? 'on' : ''}>{T(l)}</a>)}</div>

  const deals = tab === 'sales' ? await q<{ id: string; unit: string; project: string; client: string; stage: string; final_price: number; total: number; paid_pct: number; created_at: string; market: string | null; shares: { role: string; who: string | null; amount: number; got: number }[] | null }>(
    `select d.id, portal.unit_no(bl.external_id, un.number) unit, p.name project, cl.name client, d.stage, d.final_price::float, d.commission_total::float total, d.paid_pct::float, d.created_at, cl.market,
       (select json_agg(json_build_object('role', s.role, 'who', coalesce(u.name, s.recipient), 'amount', s.amount::float,
          'got', coalesce((select sum(a.amount) from portal.accruals a where a.deal_id = d.id and a.role = s.role and a.status <> 'void'), 0)::float) order by array_position(array['partner','referrer','consultant','escort','seller','market_head','caspian'], s.role))
        from portal.deal_shares s left join portal.users u on u.id = s.user_id where s.deal_id = d.id) shares
     from portal.deals d join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join projects p on p.id = d.project_id join portal.clients cl on cl.id = d.client_id
     where true ${mk} order by d.created_at desc limit 200`) : []
  const tranches = tab === 'tranches' ? await q<{ id: string; unit: string; project: string; dev: string; no: number; pct: number; amount: number; status: string; expected_at: string | null; received_at: string | null; trigger: string; paid_pct: number }>(
    `select t.id, portal.unit_no(bl.external_id, un.number) unit, p.name project, dv.name dev, t.no, t.pct::float, t.amount::float, t.status, t.expected_at::text, t.received_at, t.trigger, d.paid_pct::float
     from portal.tranches t join portal.deals d on d.id = t.deal_id join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join projects p on p.id = d.project_id
       join public.developers dv on dv.id = p.developer_id join portal.clients cl on cl.id = d.client_id
     where true ${mk} order by array_position(array['expected','scheduled','received','cancelled'], t.status), t.expected_at nulls last limit 300`) : []
  const reg = tab === 'register' ? (await q<{ id: string; month: string; status: string; confirmations: Record<string, { at: string }>; collected_at: string; approved_at: string | null; paid_at: string | null }>(`select id, month::text, status, confirmations, collected_at, approved_at, paid_at from portal.payout_registers where month = $1::date`, [month + '-01']))[0] : null
  const lines = reg ? await q<{ role: string; who: string | null; market: string | null; gross: number; withheld: number; net: number; doc_ok: boolean; carried: boolean; note: string | null }>(
    `select l.role, coalesce(u.name, l.recipient) who, l.market, l.gross::float, l.withheld::float, l.net::float, l.doc_ok, l.carried, l.note from portal.payout_lines l left join portal.users u on u.id = l.user_id
     where l.register_id = $1 ${head ? `and l.market = '${(c.user.market || '').replace(/'/g, '')}'` : ''} order by l.carried, l.role, who`, [reg.id]) : []
  const markets = Array.from(new Set(lines.filter((l) => !l.carried && l.market).map((l) => l.market!)))
  const pending = tab === 'register' && !reg ? (await q<{ n: number; s: number }>(`select count(*)::int n, coalesce(sum(amount), 0)::float s from portal.accruals where status = 'open' and month <= $1::date`, [month + '-01']))[0] : null
  const debts = tab === 'debts' ? await q<{ role: string; who: string; bal: number; since: string }>(
    `select a.role, coalesce(u.name, a.recipient) who, sum(a.amount)::float bal, min(a.created_at) filter (where a.kind = 'clawback')::text since
     from portal.accruals a left join portal.users u on u.id = a.user_id where a.status = 'open' group by a.role, u.name, a.recipient having sum(a.amount) < 0 order by bal`) : []
  const acts = tab === 'acts' ? await q<{ id: string; unit: string; client: string; agent: string; amount: number; deducted: number; clawback_left: number; status: string; number: string | null; pdf: string | null; docx: string | null }>(
    `select ca.id, portal.unit_no(bl.external_id, un.number) unit, cl.name client, ag.name agent, ca.amount::float, ca.deducted::float, ca.clawback_left::float, ca.status, doc.number, doc.pdf_file_id pdf, doc.docx_file_id docx
     from portal.commission_acts ca join portal.deals d on d.id = ca.deal_id join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = d.client_id join portal.users ag on ag.id = ca.agent_id left join portal.documents doc on doc.id = ca.document_id
     order by ca.created_at desc`) : []
  const wh = tab === 'tax' ? await q<{ entity: string; country: string; rate: number }>('select entity, country, rate::float from portal.withholding order by entity, country') : []
  return (
    <>
      <Top title={T('Финансы')} sub={T('Платим только из полученного: доли начисляются, когда застройщик оплатил транш. Суммы — USD без НДС на комиссию.')} />
      <div className="page stack">
        <Tabs />
        {tab === 'sales' && <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Продажа', 'Клиент', 'Цена договора', 'Комиссия застройщика', 'Доли', 'Оплачено клиентом', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
          <tbody>{deals.length === 0 ? <tr><td colSpan={7} className="muted">{T('Сделок пока нет')}</td></tr> : deals.map((d) => (
            <tr key={d.id}>
              <td><b>{d.unit}</b><div className="tiny muted">{d.project} · {date(L, d.created_at)}{d.stage === 'cancelled' ? ' · ' + T('расторгнута') : ''}</div></td>
              <td className="small">{d.client}</td><td>{usd(L, d.final_price)}</td><td><b>{usd(L, d.total)}</b></td>
              <td className="tiny">{(d.shares || []).filter((s) => !(head && s.role === 'caspian')).map((s) => <div key={s.role}>{T(ROLE_LABEL[s.role])}{s.who && s.role !== 'caspian' ? ` · ${s.who}` : ''}: <b>{usd(L, s.amount)}</b>{s.role !== 'caspian' && s.got ? <span className="muted"> ({T('начислено')} {usd(L, s.got)})</span> : ''}</div>)}
                {!d.shares && <span className="muted">{T('доли не рассчитаны')}</span>}</td>
              <td>{fin ? <form action={dealPaid} className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><input type="hidden" name="id" value={d.id} /><input className="in" name="paid" type="number" min={0} max={100} step="0.01" defaultValue={d.paid_pct} style={{ height: 30, width: 70 }} /><button className="btn btn--sm">%</button></form> : pct(L, d.paid_pct)}</td>
              <td>{fin && d.stage !== 'cancelled' && <form action={recomputeShares}><input type="hidden" name="deal" value={d.id} /><button className="btn btn--sm btn--ghost" title={T('Пересчитать доли по условиям (до первого поступления)')}>↻</button></form>}</td>
            </tr>))}</tbody></table></div>}
        {tab === 'tranches' && <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Продажа', 'Застройщик', 'Транш', 'Сумма', 'Статус', 'Ожидаем', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
          <tbody>{tranches.length === 0 ? <tr><td colSpan={7} className="muted">{T('Траншей пока нет — они появляются с «Договор подписан»')}</td></tr> : tranches.map((x) => (
            <tr key={x.id}><td><b>{x.unit}</b><div className="tiny muted">{x.project}</div></td><td className="small">{x.dev}</td><td className="small">№{x.no} · {Math.round(x.pct * 100) / 100}%</td><td><b>{usd(L, x.amount)}</b></td>
              <td><Pill kind={TR[x.status][1]}>{T(TR[x.status][0])}</Pill>{x.status === 'scheduled' && <div className="tiny muted">{T('оплачено клиентом {p}%', { p: x.paid_pct })}</div>}</td>
              <td className="small">{x.status === 'received' ? date(L, x.received_at) : x.expected_at ? date(L, x.expected_at) : '—'}</td>
              <td>{fin && x.status === 'expected' && <form action={trancheReceived}><input type="hidden" name="id" value={x.id} /><button className="btn btn--sm btn--p">{T('Получено (Received by AZ)')}</button></form>}</td></tr>))}</tbody></table></div>}
        {tab === 'register' && <>
          <form className="row" style={{ gap: 8 }}><input type="hidden" name="tab" value="register" /><label className="field"><span>{T('Месяц среза')}</span><input className="in" type="month" name="m" defaultValue={month} /></label><button className="btn btn--sm">{T('Показать')}</button></form>
          {!reg && <div className="card stack" style={{ gap: 8 }}><div>{T('Реестр за {m} ещё не собран. Открытых начислений по поступлениям до конца месяца: {n} на {s}.', { m: month, n: pending?.n || 0, s: usd(L, pending?.s || 0) })}</div>
            {fin && <form action={registerCollect}><input type="hidden" name="month" value={month} /><button className="btn btn--p btn--sm">{T('Собрать реестр')}</button></form>}
            <div className="tiny muted">{T('Финансы собирают к 5-му, руководитель рынка подтверждает свой рынок, админ утверждает, после оплаты в банке финансы отмечают «Оплачено». Меньше 100 $ и без документа — перенос на следующий месяц.')}</div></div>}
          {reg && <div className="card stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span><b>{T('Реестр за {m}', { m: reg.month.slice(0, 7) })}</b> <Pill kind={reg.status === 'paid' ? 'ok' : reg.status === 'approved' ? 'ink' : 'warn'}>{T(reg.status === 'paid' ? 'оплачен' : reg.status === 'approved' ? 'утверждён' : 'собран')}</Pill>
                <span className="small muted"> · {T('подтверждено рынками')}: {Object.keys(reg.confirmations || {}).join(', ') || '—'}</span></span>
              <span className="row" style={{ gap: 6 }}>
                {fin && reg.status === 'collected' && <form action={registerCollect}><input type="hidden" name="month" value={month} /><button className="btn btn--sm btn--ghost">{T('Собрать заново')}</button></form>}
                {(head || owner) && reg.status === 'collected' && (head ? [c.user.market || ''] : markets).filter((m) => !reg.confirmations?.[m]).map((m) => <form key={m} action={registerConfirm}><input type="hidden" name="id" value={reg.id} /><input type="hidden" name="market" value={m} /><button className="btn btn--sm">{T('Подтвердить рынок {m}', { m })}</button></form>)}
                {owner && reg.status === 'collected' && <form action={registerApprove}><input type="hidden" name="id" value={reg.id} /><button className="btn btn--sm btn--p">{T('Утвердить реестр')}</button></form>}
                {fin && reg.status === 'approved' && <form action={registerPaid}><input type="hidden" name="id" value={reg.id} /><button className="btn btn--sm btn--p">{T('Оплачено в банке')}</button></form>}
              </span>
            </div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr>{['Получатель', 'Роль', 'Рынок', 'Начислено', 'Удержание налога', 'К выплате', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
              <tbody>{lines.length === 0 ? <tr><td colSpan={7} className="muted">{T('Пусто')}</td></tr> : lines.map((l, i) => (
                <tr key={i} style={{ opacity: l.carried ? 0.6 : 1 }}><td>{l.who || '—'}</td><td className="small">{T(ROLE_LABEL[l.role] || l.role)}</td><td className="small">{l.market || '—'}</td><td>{usd(L, l.gross)}</td><td>{l.withheld ? '−' + usd(L, l.withheld) : '—'}</td><td><b>{usd(L, l.net)}</b></td>
                  <td className="tiny">{l.carried ? <span className="warnc">{T('перенос')}: {(l.note || '').split('; ').map((x) => T(x)).join('; ')}</span> : ''}</td></tr>))}</tbody></table></div>
            <div className="small muted">{T('Итого к выплате')}: <b>{usd(L, lines.filter((l) => !l.carried).reduce((a, l) => a + l.net, 0))}</b></div>
          </div>}
        </>}
        {tab === 'debts' && <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Кто', 'Роль', 'Долг', 'С какого числа'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{debts.length === 0 ? <tr><td colSpan={4} className="muted">{T('Долгов нет')}</td></tr> : debts.map((d, i) => (
            <tr key={i}><td>{d.who}</td><td className="small">{T(ROLE_LABEL[d.role] || d.role)}</td><td className="badc"><b>{usd(L, -d.bal)}</b></td><td className="small">{date(L, d.since)}{d.role === 'partner' && d.since && Date.now() - new Date(d.since).getTime() > 90 * 86400000 ? <div className="tiny badc">{T('3 месяца без зачёта — выставить счёт на возврат')}</div> : ''}</td></tr>))}</tbody></table>
          <div className="small muted mt8">{T('Клаубэк партнёра зачитывается против следующих выплат; через 3 месяца без зачёта — счёт на возврат по соглашению; списать долг может только админ. Клаубэк сотрудника — только против будущих бонусов, из оклада не удерживаем.')}</div></div>}
        {tab === 'acts' && fin && <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Сделка', 'Партнёр', 'Комиссия', 'Удержано', 'Статус', 'Документ'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{acts.length === 0 ? <tr><td colSpan={6} className="muted">{T('Актов пока нет')}</td></tr> : acts.map((a) => (
            <tr key={a.id}><td><b>{a.unit}</b><div className="tiny muted">{a.client}</div></td><td className="small">{a.agent}</td><td>{usd(L, a.amount)}</td>
              <td>{a.status === 'clawback' ? <span className="badc">{T('вернуть {a}', { a: usd(L, a.clawback_left) })}</span> : a.deducted ? '−' + usd(L, a.deducted) : '—'}</td>
              <td><Pill kind={ACT_STATUS[a.status][1]}>{T(ACT_STATUS[a.status][0])}</Pill>{a.status === 'due' && <form action={payActNow} className="mt8"><input type="hidden" name="id" value={a.id} /><button className="btn btn--sm">{T('Выплатить')}</button></form>}</td>
              <td className="small">{a.number ? <>{a.number}<div className="tiny">{a.pdf && <a href={`/files/${a.pdf}`} target="_blank">PDF</a>}{a.docx && <> · <a href={`/files/${a.docx}`}>docx</a></>}</div></> : a.status !== 'void' ? <ActionForm action={actDocument} lang={L}><input type="hidden" name="id" value={a.id} /><button className="btn btn--sm">{T('Создать акт')}</button></ActionForm> : '—'}</td></tr>))}</tbody></table>
          <div className="row mt16" style={{ gap: 8 }}><form action="/api/money/report" className="row" style={{ gap: 8 }}><label className="field"><span>{T('Отчёт агента застройщикам за месяц')}</span><input className="in" type="month" name="month" defaultValue={month} /></label><button className="btn btn--sm">{T('Скачать xlsx')}</button></form></div></div>}
        {tab === 'tax' && fin && <div className="card stack" style={{ gap: 10 }}>
          <div className="small muted">{T('Ставка удерживается при выплате партнёру за границу, если у него нет действующего сертификата налогового резидентства. Юрлицо — по рынку партнёра: DE → GmbH, IL → IL Ltd, остальные → Caspian.')}</div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr>{['Юрлицо', 'Страна', 'Ставка'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{wh.length === 0 ? <tr><td colSpan={3} className="muted">{T('Ставки не заданы — налог не удерживается')}</td></tr> : wh.map((w) => <tr key={w.entity + w.country}><td>{w.entity}</td><td>{w.country}</td><td>{w.rate}%</td></tr>)}</tbody></table></div>
          <form action={saveWithholding} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label className="field"><span>{T('Юрлицо')}</span><select className="in" name="entity">{['Caspian', 'GmbH', 'IL Ltd'].map((e) => <option key={e}>{e}</option>)}</select></label>
            <label className="field"><span>{T('Страна резидентства (код)')}</span><input className="in" name="country" maxLength={2} style={{ width: 80 }} placeholder="DE" /></label>
            <label className="field"><span>{T('Ставка, % (0 — убрать)')}</span><input className="in" name="rate" type="number" step="0.01" style={{ width: 100 }} /></label>
            <button className="btn btn--sm">{T('Сохранить')}</button></form>
        </div>}
      </div>
    </>
  )
}
