import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, date, pct } from '@/lib/i18n'
import { canConfirmBooking, isExternal, canBook, canApproveDiscount } from '@/lib/perm'
import { bookingScope } from '@/lib/scope'
import { Top, Pill } from '@/components/ui'
import { bookingAction } from '@/lib/actions'

type B = { id: string; status: string; ends_at: string; starts_at: string; extended: boolean; final_price: number; price_list: number; discount_pct: number; unit: string; unit_id: string; unit_status: string; client: string; client_id: string; agent: string; agent_id: string; market: string | null; agent_amount: number | null; approval: string | null }
export default async function Bookings({ searchParams }: { searchParams: { f?: string; created?: string } }) {
  const c = await requireCtx()
  if (!(canBook(c.user.role) || c.user.role === 'finance')) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const bs = bookingScope(c.user)
  const rows = await q<B>(`select b.id, b.status, b.ends_at, b.starts_at, b.extended, b.final_price::float, b.price_list::float, b.discount_pct::float, coalesce(bl.external_id,'') || '-' || un.number unit, un.id unit_id, un.status unit_status,
      cl.name client, cl.id client_id, us.name agent, us.id agent_id, cl.market, (b.snapshot->'split'->>'agent')::float agent_amount, b.approval
    from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id
    where ${bs.sql} order by case when b.status in ('requested','confirmed') then 0 else 1 end, b.ends_at`, bs.params)
  const active = rows.filter((r) => ['requested', 'confirmed'].includes(r.status))
  const now = Date.now()
  const conflict = (r: B) => ['requested', 'confirmed'].includes(r.status) && r.unit_status !== 'available'
  const f = searchParams.f || 'active'
  const shown = f === 'active' ? active : f === 'soon' ? active.filter((r) => new Date(r.ends_at).getTime() - now < 3 * 86400000) : f === 'conflict' ? rows.filter(conflict) : rows
  const ext = isExternal(c.user.role)
  // Лимит у застройщика общий на всех наших партнёров и менеджеров (прототип 14): сколько занято по проектам
  const limits = ext ? [] : await q<{ name: string; used: number; max: number }>(`select p.name, (select count(*)::int from portal.bookings b where b.project_id = p.id and b.status in ('requested','confirmed')) used,
      (select max_bookings_total from portal.conditions x where x.project_id = p.id and x.status = 'published' order by valid_from desc, version desc limit 1) max
    from projects p where exists (select 1 from portal.conditions x where x.project_id = p.id and x.status = 'published') order by p.sort, p.name`)
  return (
    <>
      <Top title={T('Брони')} sub={ext ? T('Ваши брони. Лимит — в условиях проекта.') : T('Активные брони по всем проектам. Лимит у застройщика: Premium — до 10 одновременно.')} />
      <div className="page">
        {searchParams.created && <div className="okbox" style={{ marginBottom: 16 }}>{rows.find((r) => r.id === searchParams.created)?.approval === 'pending' ? T('Бронь поставлена. Скидка сверх вашего порога ушла на согласование; после решения офис в Баку подтвердит бронь у застройщика.') : T('Бронь поставлена. Офис в Баку подтвердит её у застройщика — вы получите уведомление.')}</div>}
        <div className="grid g4">
          {[[T('Активных'), active.length], [T('Истекают ≤ 3 дней'), active.filter((r) => new Date(r.ends_at).getTime() - now < 3 * 86400000).length], [T('Ждут подтверждения застройщика'), active.filter((r) => r.status === 'requested').length], [T('Конфликты'), rows.filter(conflict).length]].map(([a, b]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v">{b}</div></div>)}
        </div>
        {limits.length > 0 && <div className="row mt16" style={{ gap: 16 }}>{limits.map((x) => <span key={x.name} className={'small' + (x.used >= x.max ? ' badc' : '')}>{T('Лимит у застройщика')} · {x.name}: <b>{x.used} / {x.max}</b></span>)}</div>}
        <div className="chips mt16">{[['active', 'Активные'], ['soon', 'Истекают'], ['conflict', 'Конфликты'], ['all', 'Все']].map(([k, l]) => <Link key={k} href={`?f=${k}`} className={'chip' + (f === k ? ' on' : '')}>{T(l)}</Link>)}</div>
        <div className="tbl-wrap mt16">
          <table className="tbl">
            <thead><tr>{['Квартира', 'Клиент', ext ? '' : 'Агент / продавец', 'Цена', 'Срок', 'Осталось', 'Статус', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={8} className="muted">{T('Нет броней')}</td></tr>}
              {shown.map((r) => {
                const left = Math.ceil((new Date(r.ends_at).getTime() - now) / 86400000)
                const total = Math.max(1, Math.ceil((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 86400000))
                const live = ['requested', 'confirmed'].includes(r.status)
                const act = (a: string, l: string, p = false) => <form action={bookingAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="act" value={a} /><button className={'btn btn--sm' + (p ? ' btn--p' : '')}>{T(l)}</button></form>
                return (
                  <tr key={r.id}>
                    <td><Link href={`/units/${r.unit_id}`}><b>{r.unit}</b></Link></td>
                    <td><Link href={`/clients/${r.client_id}`}>{r.client}</Link></td>
                    <td className="small muted">{ext ? '' : `${r.agent}${r.market ? ' · ' + r.market : ''}`}</td>
                    <td className="num">{usd(L, r.final_price)}<div className="tiny muted">{T('скидка')} {pct(L, r.discount_pct)}{ext && r.agent_amount ? ' · ' + T('ваш доход') + ' ' + usd(L, r.agent_amount) : ''}</div></td>
                    <td className="small">{T('до {d}', { d: date(L, r.ends_at) })}{r.extended ? <div className="tiny muted">{T('продлена')}</div> : null}</td>
                    <td style={{ minWidth: 110 }}>{live && <><div style={{ height: 6, background: 'var(--stone)', borderRadius: 3 }}><div style={{ height: 6, borderRadius: 3, width: `${Math.max(4, Math.min(100, (left / total) * 100))}%`, background: left <= 3 ? 'var(--warn-line)' : 'var(--ok-line)' }} /></div><div className="tiny muted">{T('{d} дн.', { d: Math.max(0, left) })}</div></>}</td>
                    <td>{conflict(r) ? <Pill kind="bad">{T('у застройщика: не свободна')}</Pill> : r.status === 'requested' && r.approval === 'pending' ? <Pill kind="warn">{T('скидка на согласовании')}</Pill> : r.status === 'requested' ? <Pill kind="warn">{T('ждёт офис в Баку')}</Pill> : r.status === 'confirmed' ? <Pill kind="ok">{T('подтверждена')}</Pill> : r.status === 'converted' ? <Pill kind="ink">{T('договор')}</Pill> : <Pill kind="off">{T(r.status === 'cancelled' ? 'снята' : 'истекла')}</Pill>}</td>
                    <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      {r.status === 'requested' && r.approval === 'pending' && canApproveDiscount(c.user.role) && <>{act('approve', 'Согласовать', true)}{act('decline', 'Отказать')}</>}
                      {r.status === 'requested' && r.approval !== 'pending' && canConfirmBooking(c.user.role) && act('confirm', 'Подтвердить', true)}
                      {live && !r.extended && (r.agent_id === c.user.id || canConfirmBooking(c.user.role)) && act('extend', 'Продлить')}
                      {r.status === 'confirmed' && ['owner', 'market_head', 'seller', 'office'].includes(c.user.role) && act('contract', 'Договор подписан')}
                      {live && (r.agent_id === c.user.id || canConfirmBooking(c.user.role)) && act('cancel', 'Снять')}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
