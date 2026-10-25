import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { ROLE_NAMES, type Role } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { endSessions, setUserActive } from '@/lib/actions'
import { EditUser, Secrets } from './form'

// Карточка пользователя в админке: владелец правит всех, руководитель рынка — агентов своего рынка
export default async function UserCard({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const u = await one<{ id: string; name: string; email: string; role: Role; market: string | null; agency_id: string | null; curator_id: string | null; locale: string; license_note: string | null; contract_signed_at: string | null; active: boolean; last_login_at: string | null; created_at: string }>(
    'select id, name, email, role, market, agency_id, curator_id, locale, license_note, contract_signed_at::text, active, last_login_at, created_at from portal.users where id = $1', [params.id])
  if (!u) notFound()
  const owner = c.user.role === 'owner'
  if (!owner && !(['agent', 'agency_head'].includes(u.role) && u.market === c.user.market)) redirect('/admin/agents')
  const agencies = await q<{ id: string; name: string }>(`select id, name from portal.agencies ${owner ? '' : 'where market = $1'} order by name`, owner ? [] : [c.user.market])
  const curators = await q<{ id: string; name: string }>(`select id, name from portal.users where active and role in ('seller','market_head','owner') ${owner ? '' : 'and market = $1'} order by name`, owner ? [] : [c.user.market])
  const work = await one<{ clients: number; bookings: number }>(`select (select count(*)::int from portal.clients where owner_id = $1 and stage not in ('lost','handed')) clients,
    (select count(*)::int from portal.bookings where agent_id = $1 and status in ('requested','confirmed')) bookings`, [u.id])
  const log = await q<{ action: string; created_at: string; who: string | null }>(`select a.action, a.created_at, w.name who from portal.audit a left join portal.users w on w.id = a.user_id
    where (a.entity = 'user' and a.entity_id in ($1, $2)) or a.user_id = $3 order by a.id desc limit 15`, [u.id, u.email, u.id])
  return (
    <>
      <Top crumbs={[[T('Админка'), owner ? '/admin/users' : '/admin/agents'], [u.name]]} title={u.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}><Pill kind="ink">{T(ROLE_NAMES[u.role])}</Pill>{u.market && <Pill kind="off">{u.market}</Pill>}{!u.active && <Pill kind="bad">{T('отключён')}</Pill>}<span className="small muted">{T('Последний вход')}: {dateTime(L, u.last_login_at)}</span></span>} />
      <div className="page split">
        <EditUser lang={L} owner={owner} agencies={agencies} curators={curators} u={u} />
        <div className="stack">
          {u.id !== c.real.id && <Secrets lang={L} id={u.id} />}
          {u.id !== c.real.id && (
            <div className="card stack" style={{ gap: 10 }}>
              <div className="h3" style={{ margin: 0 }}>{T('Доступ')}</div>
              <form action={endSessions}><input type="hidden" name="id" value={u.id} /><button className="btn">{T('Завершить все сеансы')}</button></form>
              {u.active ? (
                <form action={setUserActive} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={u.id} /><input type="hidden" name="active" value="0" />
                  {(work!.clients > 0 || work!.bookings > 0) && <label className="field"><span>{T('Клиенты в работе: {c}, активные брони: {b}. Передать:', { c: work!.clients, b: work!.bookings })}</span>
                    <select className="in" name="transfer_to" defaultValue={u.curator_id || ''}><option value="">{T('не передавать')}</option>{curators.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
                  <button className="btn">{T('Отключить')}</button>
                  <div className="tiny muted">{T('Доступ закрывается сразу. Комиссия по уже подписанным сделкам выплачивается по договору.')}</div>
                </form>
              ) : (
                <form action={setUserActive}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="active" value="1" /><button className="btn btn--p">{T('Включить')}</button></form>
              )}
            </div>
          )}
          {u.id === c.real.id && <div className="card small muted">{T('Свой пароль и PIN меняйте в профиле.')} <Link className="bronze" href="/profile">{T('Профиль')} →</Link></div>}
          <div className="card">
            <div className="h3">{T('Журнал')}</div>
            {log.length === 0 && <div className="small muted">—</div>}
            {log.map((x, i) => <div key={i} className="kv"><span className="small"><code>{x.action}</code> · {x.who}</span><span className="tiny muted">{dateTime(L, x.created_at)}</span></div>)}
          </div>
        </div>
      </div>
    </>
  )
}
