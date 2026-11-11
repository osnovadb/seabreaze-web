import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, tzOf } from '@/lib/i18n'
import { ROLE_NAMES, canManageUsers, type Role } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import Link from 'next/link'
import { NewUser } from './form'
import { Pager, pageOf } from '@/components/Pager'

export default async function Users(props: { searchParams: Promise<{ s?: string; qa?: string; page?: string }> }) {
  const sp = await props.searchParams
  const c = await requireCtx()
  if (!canManageUsers(c.user.role)) redirect('/admin')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  // О12 (обход 11.11): поиск, без пользователей автотестов по умолчанию, по 100 на странице
  const qs0 = (sp.s || '').trim(), withQa = sp.qa === '1'
  const rows = await q<{ id: string; name: string; email: string; role: Role; market: string | null; agency: string | null; curator: string | null; locale: string; active: boolean; last_login_at: string | null }>(
    `select u.id, u.name, u.email, u.role, u.market, a.name agency, cu.name curator, u.locale, u.active, u.last_login_at from portal.users u left join portal.agencies a on a.id = u.agency_id left join portal.users cu on cu.id = u.curator_id
     where ($1 or u.email not like 'qa-%@qa.test') and ($2 = '' or u.name ilike '%' || $2 || '%' or u.email ilike '%' || $2 || '%') order by u.active desc, u.role, u.name`, [withQa, qs0])
  const pg = pageOf(sp.page, rows.length)
  const qsx = new URLSearchParams({ ...(qs0 ? { s: qs0 } : {}), ...(withQa ? { qa: '1' } : {}) }).toString()
  const agencies = await q<{ id: string; name: string }>('select id, name from portal.agencies order by name')
  return (
    <>
      <Top title={T('Админка')} sub={T('Пользователи команды и партнёров')} />
      <div className="page">
        <AdminTabs lang={L} on="users" role={c.user.role} />
        {/* М13: форма — по кнопке, таблица во всю ширину */}
        <details className="mt8" style={{ marginBottom: 16 }}><summary className="btn btn--p" style={{ display: 'inline-flex' }}>{T('Новый пользователь')}</summary><div className="mt8" style={{ maxWidth: 520 }}><NewUser lang={L} agencies={agencies} /></div></details>
        <form className="row" style={{ gap: 8, marginBottom: 12 }}><input className="in" name="s" defaultValue={qs0} placeholder={T('Имя или e-mail')} style={{ maxWidth: 280 }} /><label className="check small"><input type="checkbox" name="qa" value="1" defaultChecked={withQa} /> <span>{T('с пользователями автотестов')}</span></label><button className="btn btn--sm">{T('Найти')}</button></form>
        <div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{['Пользователь', 'Роль', 'Рынок', 'Агентство / куратор', 'Язык', 'Вход', ''].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{rows.slice(pg.from, pg.to).map((u) => (
              <tr key={u.id} style={{ opacity: 1, color: u.active ? undefined : 'var(--off)' }}>
                <td><Link href={`/admin/users/${u.id}`}><b>{u.name}</b></Link><div className="tiny muted">{u.email}</div></td><td>{T(ROLE_NAMES[u.role])}</td><td>{u.market || '—'}</td>
                <td className="small">{u.agency || '—'}{u.curator && <div className="tiny muted">{T('куратор')}: {u.curator}</div>}</td><td>{u.locale.toUpperCase()}</td>
                <td className="small muted">{dateTime(L, u.last_login_at, TZ)}</td>
                <td><Link className="btn btn--sm" href={`/admin/users/${u.id}`}>{T('Изменить')}</Link>{!u.active && <Pill kind="off">{T('отключён')}</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <Pager page={pg.page} pages={pg.pages} total={rows.length} qs={qsx} label={T('Пользователей: {n}', { n: rows.length })} />
        </div>
      </div>
    </>
  )
}
