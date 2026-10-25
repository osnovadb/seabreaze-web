import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { isExternal, canRegisterClient, canSeeClients } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { Top, AGENT_STAGES, STAGES, stageName } from '@/components/ui'
import { Kanban, type KCard, type KCol } from '@/components/Kanban'
import { agentGroup } from '@/lib/stages'

type Row = { has_deal: boolean; qualified: boolean; id: string; name: string; reg_no: string; stage: string; country: string | null; budget: string | null; interest: string | null; protected_until: string; pause_until: string | null; lost_reason: string | null; last_activity_at: string; owner: string; opened: number | null; booking: string | null; booking_ends: string | null; fix: string | null }

export default async function Clients({ searchParams }: { searchParams: { v?: string; q?: string } }) {
  const c = await requireCtx()
  if (!canSeeClients(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ext = isExternal(c.user.role)
  const cs = clientScope(c.user)
  const rows = await q<Row>(`select cl.id, cl.name, cl.reg_no, cl.stage, cl.country, cl.budget, cl.interest, cl.protected_until, cl.pause_until, cl.lost_reason, cl.last_activity_at, us.name as owner,
      (select max(opened) from portal.selections s where s.client_id = cl.id) as opened,
      exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled') as has_deal,
      (coalesce(cl.goal, '') <> '' and coalesce(cl.budget, '') <> '' and coalesce(cl.timeline, '') <> '') as qualified,
      (select coalesce(bl.external_id,'') || '-' || un.number from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id where b.client_id = cl.id and b.status in ('requested','confirmed') limit 1) as booking,
      (select ends_at from portal.bookings b where b.client_id = cl.id and b.status in ('requested','confirmed') limit 1) as booking_ends,
      (select status from portal.fixations f where f.client_id = cl.id limit 1) as fix
    from portal.clients cl join portal.users us on us.id = cl.owner_id where ${cs.sql} ${searchParams.q ? `and (cl.name ilike $${cs.params.length + 1} or cl.email ilike $${cs.params.length + 1} or cl.phone ilike $${cs.params.length + 1})` : ''} order by cl.last_activity_at desc`,
    searchParams.q ? [...cs.params, `%${searchParams.q}%`] : cs.params)
  const view = searchParams.v || (ext ? 'kanban' : 'list')
  const live = rows.filter((r) => !r.pause_until && r.stage !== 'lost')
  const paused = rows.filter((r) => r.pause_until), lost = rows.filter((r) => r.stage === 'lost')
  const now = Date.now()
  const signal = (r: Row): [string, string] | null => {
    if (r.booking_ends && new Date(r.booking_ends).getTime() - now < 3 * 86400000) return ['badc', T('бронь {u}: осталось {d} дн.', { u: r.booking!, d: Math.max(0, Math.ceil((new Date(r.booking_ends).getTime() - now) / 86400000)) })]
    if (r.opened && r.opened >= 2 && r.stage === 'selection') return ['okc', T('открыл подборку {n} раза — позвонить', { n: r.opened })]
    const idle = Math.floor((now - new Date(r.last_activity_at).getTime()) / 86400000)
    if (idle >= 30) return ['warnc', T('нет активности {d} дн.', { d: idle })]
    if (r.fix === 'sent') return ['warnc', T('ждём ответ застройщика')]
    return null
  }
  return (
    <>
      <Top title={ext ? T('Клиенты') : T('CRM · клиенты')} sub={T('{a} в работе · {p} на паузе · {l} отказов', { a: live.length, p: paused.length, l: lost.length })}
        right={<>
          <form className="row"><input className="in" name="q" defaultValue={searchParams.q} placeholder={T('Поиск: имя, телефон, e-mail')} style={{ width: 240 }} /><input type="hidden" name="v" value={view} /></form>
          <div className="chips"><Link className={'chip' + (view === 'kanban' ? ' on' : '')} href="?v=kanban">{T('Воронка')}</Link><Link className={'chip' + (view === 'list' ? ' on' : '')} href="?v=list">{T('Список')}</Link></div>
          {canRegisterClient(c.user.role) && <Link className="btn btn--p" href="/clients/new">+ {T('Клиент')}</Link>}
        </>} />
      <div className="page">
        {view === 'kanban' ? (
          <Kanban role={c.user.role} lang={L}
            cols={ext
              ? AGENT_STAGES.map(([k, l, sts, who]): KCol => ({ key: k, label: T(l), who: T(who), target: sts[0], empty: k === 'fee' ? T('Появится после оплаты застройщика') : undefined }))
              : STAGES.map(([k, l]): KCol => ({ key: k, label: T(l), target: k }))}
            cards={rows.map((r): KCard => ({
              id: r.id, name: r.name,
              sub: r.pause_until ? T('вернуться') + ' ' + date(L, r.pause_until) : r.stage === 'lost' ? (r.lost_reason ? T(r.lost_reason) : '') : [r.country, r.budget, r.booking].filter(Boolean).join(' · '),
              owner: ext ? undefined : r.owner, signal: r.pause_until || r.stage === 'lost' ? null : signal(r),
              col: r.pause_until ? 'pause' : r.stage === 'lost' ? 'lost' : ext ? agentGroup(r.stage) : r.stage,
              ctx: { stage: r.stage, paused: !!r.pause_until, hasBooking: !!r.booking, hasDeal: r.has_deal, qualified: r.qualified },
            }))} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Клиент', 'Стадия', ext ? 'Страна' : 'Владелец', 'Бюджет', 'Бронь', 'Защита до', 'Активность', ''].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
              <tbody>{rows.map((r) => {
                const sg = signal(r)
                return (
                  <tr key={r.id}>
                    <td><Link href={`/clients/${r.id}`}><b>{r.name}</b></Link><div className="tiny muted">{r.reg_no}</div></td>
                    <td>{r.pause_until ? T('Пауза') : r.stage === 'lost' ? T('Отказ') : ext ? T((AGENT_STAGES.find(([, , s]) => s.includes(r.stage)) || ['', r.stage])[1]) : stageName(L, r.stage)}</td>
                    <td>{ext ? r.country : r.owner}</td><td className="small">{r.budget || '—'}</td><td>{r.booking || '—'}</td>
                    <td className="small">{date(L, r.protected_until)}</td><td className="small muted">{date(L, r.last_activity_at)}</td>
                    <td className="small">{sg && <span className={sg[0]}>{sg[1]}</span>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
