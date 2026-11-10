import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, date, pct } from '@/lib/i18n'
import { canConfirmBooking, isExternal, canBook, canApproveDiscount } from '@/lib/perm'
import { bookingScope } from '@/lib/scope'
import { Top, Pill } from '@/components/ui'
import { bookingAction } from '@/lib/actions'

type B = { id: string; status: string; ends_at: string; starts_at: string; extended: boolean; final_price: number; price_list: number; discount_pct: number; unit: string; unit_id: string; unit_status: string; client: string; client_id: string; agent: string; agent_id: string; market: string | null; agent_amount: number | null; approval: string | null; plan_pool: number | null; kyc_status: string; options_usd: number; group_id: string | null; fee_status: string; fee_usd: number; fee_amount: number; fee_currency: string }
const FEE_ST: Record<string, string> = { due: 'ждём оплату', paid: 'оплачен', credited: 'засчитан в цену', refunded: 'возвращён', kept: 'удержан' }
const PAGE = 200 // QA 10.11: «Все» у руководителя рынка — тысяча строк одним списком
export default async function Bookings(
  props: { searchParams: Promise<{ f?: string; created?: string; s?: string; contract?: string }> }
) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!(canBook(c.user.role) || c.user.role === 'finance')) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const bs = bookingScope(c.user)
  const rows = await q<B>(`select b.id, b.status, b.ends_at, b.starts_at, b.extended, b.final_price::float, b.options_usd::float, b.group_id, b.fee_status, b.fee_usd::float, b.fee_amount::float, b.fee_currency, b.price_list::float, b.discount_pct::float, portal.unit_no(bl.external_id, un.number) unit, un.id unit_id, un.status unit_status,
      cl.name client, cl.id client_id, us.name agent, us.id agent_id, cl.market, (b.snapshot->'split'->>'agent')::float agent_amount, b.approval, (b.snapshot->>'plan_pool')::float plan_pool, cl.kyc_status
    from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id
    where ${bs.sql} order by case when b.status in ('hold','queued','requested','confirmed','release_pending') then 0 else 1 end, b.ends_at`, bs.params)
  const active = rows.filter((r) => ['hold', 'queued', 'requested', 'confirmed', 'release_pending'].includes(r.status))
  const now = Date.now()
  const conflict = (r: B) => ['requested', 'confirmed'].includes(r.status) && r.unit_status !== 'available'
  const f = searchParams.f || 'active'
  // «Взносы»: ждут оплаты по активным броням и оплаченные по снятым — решение финансов
  const feeQ = (r: B) => (r.fee_status === 'due' && ['requested', 'confirmed'].includes(r.status)) || (r.fee_status === 'paid' && ['cancelled', 'expired'].includes(r.status))
  const qs = (searchParams.s || '').trim().toLowerCase()
  const shown0 = f === 'wait' ? active.filter((r) => r.status === 'requested') : f === 'active' ? active : f === 'soon' ? active.filter((r) => new Date(r.ends_at).getTime() - now < 3 * 86400000) : f === 'conflict' ? rows.filter(conflict) : f === 'fee' ? rows.filter(feeQ) : rows
  // QA 09.11: поиск по квартире, клиенту, агенту — у офиса десятки броней
  const shown = qs ? shown0.filter((r) => [r.unit, r.client, r.agent].some((x) => (x || '').toLowerCase().includes(qs))) : shown0
  const signed = searchParams.contract ? rows.find((r) => r.id === searchParams.contract) : null
  const ext = isExternal(c.user.role)
  // Лимит у застройщика общий на всех наших партнёров и менеджеров (прототип 14): сколько занято по проектам
  const limits = ext ? [] : await q<{ name: string; used: number; max: number }>(`select p.name, (select count(*)::int from portal.bookings b where b.project_id = p.id and b.status in ('requested','confirmed')) used,
      (select max_bookings_total from portal.conditions x where x.project_id = p.id and x.status = 'published' order by valid_from desc, version desc limit 1) max
    from projects p where exists (select 1 from portal.conditions x where x.project_id = p.id and x.status = 'published') order by p.sort, p.name`)
  return (
    <>
      <Top title={T('Брони')} sub={ext ? T('Ваши брони. Лимит — в условиях проекта.') : T('Активные брони по всем проектам. Лимит одновременных броней — в условиях проекта.')} />
      <div className="page">
        {searchParams.created && <div className="okbox" style={{ marginBottom: 16 }}>{rows.find((r) => r.id === searchParams.created)?.approval === 'pending' ? T('Бронь поставлена. Скидка сверх вашего порога ушла на согласование; после решения офис в Баку подтвердит бронь у застройщика.') : T('Бронь поставлена. Офис в Баку подтвердит её у застройщика — вы получите уведомление.')}</div>}
        <div className="grid g4">
          {[[T('Активных'), active.length], [T('Истекают ≤ 3 дней'), active.filter((r) => new Date(r.ends_at).getTime() - now < 3 * 86400000).length], [T('Ждут подтверждения застройщика'), active.filter((r) => r.status === 'requested').length], [T('Конфликты'), rows.filter(conflict).length]].map(([a, b]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v">{b}</div></div>)}
        </div>
        {limits.length > 0 && <div className="row mt16" style={{ gap: 16 }}>{limits.map((x) => <span key={x.name} className={'small' + (x.used >= x.max ? ' badc' : '')}>{T('Лимит у застройщика')} · {x.name}: <b>{x.used} / {x.max}</b></span>)}</div>}
        {signed && <div className="okbox" style={{ marginBottom: 16 }}>{T('Договор по {u} подписан — бронь закрыта, сделка в «Финансы → Продажи и доли».', { u: signed.unit })}</div>}
        <div className="row mt16" style={{ gap: 12, justifyContent: 'space-between' }}><div className="chips">{[...(ext ? [] : [['wait', `${T('Ждут подтверждения')} · ${active.filter((r) => r.status === 'requested').length}`]]), ['active', 'Активные'], ['soon', 'Истекают'], ['conflict', 'Конфликты'], ...(!ext || rows.some(feeQ) ? [['fee', `${T('Взносы')} · ${rows.filter(feeQ).length}`]] : []), ['all', 'Все']].map(([k, l]) => <Link key={k} href={`?f=${k}`} className={'chip' + (f === k ? ' on' : '')}>{k === 'fee' || k === 'wait' ? l : T(l)}</Link>)}</div>
          <form className="row" style={{ gap: 6 }}><input type="hidden" name="f" value={f} /><input className="in in--sm" name="s" defaultValue={searchParams.s || ''} placeholder={T('Квартира, клиент, агент')} style={{ width: 220 }} /><button className="btn btn--sm">{T('Найти')}</button></form></div>
        <div className="tbl-wrap mt16">
          <table className="tbl">
            <thead><tr>{['Квартира', 'Клиент', ext ? '' : 'Агент / продавец', 'Цена', 'Срок', 'Осталось', 'Статус', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={8} className="muted">{T('Нет броней')}</td></tr>}
              {shown.slice(0, PAGE).map((r) => {
                const left = Math.ceil((new Date(r.ends_at).getTime() - now) / 86400000)
                const total = Math.max(1, Math.ceil((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 86400000))
                const live = ['requested', 'confirmed'].includes(r.status)
                const decline = <form action={bookingAction} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="act" value="reject" />
                  <select className="in in--sm" name="reason" defaultValue="sold">{[['sold', 'Продана'], ['developer_refused', 'Застройщик отказал'], ['registration_failed', 'Нет регистрации'], ['other', 'Другое']].map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select><button className="btn btn--sm">{T('Отклонить')}</button></form>
                const confirm = <form action={bookingAction} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="act" value="confirm" />
                  <input className="in in--sm" name="dev_no" placeholder={T('№ брони застройщика')} style={{ width: 150 }} /><input className="in in--sm" type="date" name="until" title={T('до какого числа у застройщика')} /><button className="btn btn--sm btn--p">{T('Подтвердить')}</button></form>
                const act = (a: string, l: string, p = false) => <form action={bookingAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="act" value={a} /><input type="hidden" name="back" value="bookings" /><button className={'btn btn--sm' + (p ? ' btn--p' : '')}>{T(l)}</button></form>
                return (
                  <tr key={r.id}>
                    <td><Link href={`/units/${r.unit_id}`}><b>{r.unit}</b></Link>{r.group_id && <div className="tiny bronze">{T('пакет')}: {rows.filter((x) => x.group_id === r.group_id && x.id !== r.id).map((x) => x.unit).join(', ') || '—'}</div>}</td>
                    <td><Link href={`/clients/${r.client_id}`}>{r.client}</Link></td>
                    <td className="small muted">{ext ? '' : `${r.agent}${r.market ? ' · ' + r.market : ''}`}</td>
                    <td className="num">{usd(L, r.final_price)}{r.options_usd > 0 && <div className="tiny">+ {T('опции')} {usd(L, r.options_usd)}</div>}{r.fee_status !== 'none' && <div className={'tiny ' + (r.fee_status === 'due' ? 'warnc' : r.fee_status === 'paid' ? 'okc' : 'muted')}>{T('взнос')} {usd(L, r.fee_usd)}{r.fee_currency !== 'USD' ? ` (${r.fee_currency} ${r.fee_amount})` : ''} · {T(FEE_ST[r.fee_status])}</div>}<div className="tiny muted">{T('скидка')} {pct(L, r.discount_pct)}{ext && r.agent_amount ? ' · ' + T('ваш доход') + ' ' + usd(L, r.agent_amount) : ''}</div></td>
                    <td className="small">{r.status === 'requested' ? <span className="muted">{T('срок — после подтверждения')}</span> : <>{T('до {d}', { d: date(L, r.ends_at) })}{r.extended ? <div className="tiny muted">{T('продлена')}</div> : null}</>}</td>
                    <td style={{ minWidth: 110 }}>{r.status === 'confirmed' && <><div style={{ height: 6, background: 'var(--stone)', borderRadius: 3 }}><div style={{ height: 6, borderRadius: 3, width: `${Math.max(4, Math.min(100, (left / total) * 100))}%`, background: left <= 3 ? 'var(--warn-line)' : 'var(--ok-line)' }} /></div><div className="tiny muted">{T('{d} дн.', { d: Math.max(0, left) })}</div></>}</td>
                    <td>{conflict(r) ? <Pill kind="bad">{T('у застройщика: не свободна')}</Pill> : r.status === 'requested' && r.approval === 'pending' ? <Pill kind="warn">{T('скидка на согласовании')}</Pill> : r.status === 'requested' && r.fee_status === 'due' ? <Pill kind="warn">{T('ждёт взнос')}</Pill> : r.status === 'requested' ? <Pill kind="warn">{T('ждёт офис в Баку')}</Pill> : r.status === 'confirmed' ? <Pill kind="ok">{T('подтверждена')}</Pill> : r.status === 'hold' ? <Pill kind="ink">{T('холд 24 ч')}</Pill> : r.status === 'queued' ? <Pill kind="warn">{T('в очереди у застройщика')}</Pill> : r.status === 'release_pending' ? <Pill kind="warn">{T('снять у застройщика')}</Pill> : r.status === 'declined' ? <Pill kind="bad">{T('отклонена')}</Pill> : r.status === 'converted' ? <Pill kind="ink">{T('договор')}</Pill> : <Pill kind="off">{T(r.status === 'cancelled' ? 'снята' : 'истекла')}</Pill>}</td>
                    <td style={{ minWidth: 260 }}><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {r.status === 'requested' && r.approval === 'pending' && canApproveDiscount(c.user.role) && <>{r.plan_pool != null && r.discount_pct > r.plan_pool + 1e-9 ? <span className="tiny bad">{T('больше максимума по плану ({p}) — только отказ', { p: pct(L, r.plan_pool) })}</span> : act('approve', 'Согласовать', true)}{act('decline', 'Отказать')}</>}
                      {r.fee_status === 'due' && live && ['owner', 'office', 'finance'].includes(c.user.role) && act('fee_paid', 'Взнос получен', true)}
                      {r.fee_status === 'paid' && ['cancelled', 'expired'].includes(r.status) && ['owner', 'finance'].includes(c.user.role) && <>{act('fee_refund', 'Вернуть взнос')}{act('fee_keep', 'Удержать')}</>}
                      {r.status === 'requested' && r.approval !== 'pending' && r.fee_status !== 'due' && canConfirmBooking(c.user.role) && confirm}
                      {['requested', 'queued'].includes(r.status) && canConfirmBooking(c.user.role) && decline}
                      {r.status === 'release_pending' && canConfirmBooking(c.user.role) && act('release_confirm', 'Снята у застройщика', true)}
                      {r.status === 'hold' && (r.agent_id === c.user.id || c.user.role === 'market_head') && act('release_hold', 'Снять холд')}
                      {r.status === 'hold' && r.agent_id === c.user.id && <Link className="btn btn--sm btn--p" href={`/units/${r.unit_id}/book`}>{T('Запросить бронь')}</Link>}
                      {r.status === 'confirmed' && !r.extended && (r.agent_id === c.user.id || canConfirmBooking(c.user.role)) && act('extend', 'Продлить')}
                      {r.status === 'confirmed' && ['owner', 'market_head', 'seller', 'office'].includes(c.user.role) && (r.kyc_status === 'passed' ? act('contract', 'Договор подписан') : <Link className="tiny warnc" href={`/clients/${r.client_id}`}>{T('договор — после KYC')}</Link>)}
                      {(live || r.status === 'queued') && (r.agent_id === c.user.id || canConfirmBooking(c.user.role)) && act('cancel', 'Снять')}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {shown.length > PAGE && <div className="small muted mt8">{T('Показаны первые {n} из {t} — уточните поиск или вкладку', { n: PAGE, t: shown.length })}</div>}
      </div>
    </>
  )
}
