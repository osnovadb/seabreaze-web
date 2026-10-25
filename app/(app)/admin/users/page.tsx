import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { ROLE_NAMES, canManageUsers, type Role } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import Link from 'next/link'
import { NewUser } from './form'

export default async function Users() {
  const c = await requireCtx()
  if (!canManageUsers(c.user.role)) redirect('/admin')
  const L = c.lang, T = (s: string) => t(L, s)
  const rows = await q<{ id: string; name: string; email: string; role: Role; market: string | null; agency: string | null; curator: string | null; locale: string; active: boolean; last_login_at: string | null }>(
    `select u.id, u.name, u.email, u.role, u.market, a.name agency, cu.name curator, u.locale, u.active, u.last_login_at from portal.users u left join portal.agencies a on a.id = u.agency_id left join portal.users cu on cu.id = u.curator_id order by u.active desc, u.role, u.name`)
  const agencies = await q<{ id: string; name: string }>('select id, name from portal.agencies order by name')
  return (
    <>
      <Top title={T('Админка')} sub={T('Пользователи команды и партнёров')} />
      <div className="page">
        <AdminTabs lang={L} on="users" role={c.user.role} />
        <div className="split">
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{['Пользователь', 'Роль', 'Рынок', 'Агентство / куратор', 'Язык', 'Вход', ''].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id} style={{ opacity: 1, color: u.active ? undefined : 'var(--off)' }}>
                <td><Link href={`/admin/users/${u.id}`}><b>{u.name}</b></Link><div className="tiny muted">{u.email}</div></td><td>{T(ROLE_NAMES[u.role])}</td><td>{u.market || '—'}</td>
                <td className="small">{u.agency || '—'}{u.curator && <div className="tiny muted">{T('куратор')}: {u.curator}</div>}</td><td>{u.locale.toUpperCase()}</td>
                <td className="small muted">{dateTime(L, u.last_login_at)}</td>
                <td><Link className="btn btn--sm" href={`/admin/users/${u.id}`}>{T('Изменить')}</Link>{!u.active && <Pill kind="off">{T('отключён')}</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <NewUser lang={L} agencies={agencies} />
        </div>
      </div>
    </>
  )
}
