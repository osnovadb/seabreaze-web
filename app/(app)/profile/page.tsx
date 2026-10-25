import { requireCtx } from '@/lib/auth'
import { t, dateTime } from '@/lib/i18n'
import { ROLE_NAMES } from '@/lib/perm'
import { one } from '@/lib/db'
import { Top } from '@/components/ui'
import { setOwnLocale } from '@/lib/actions'
import { PasswordForm, PinForm } from './form'

// Профиль: свой пароль (временный из письма или от админа меняют здесь), PIN режима показа, язык по умолчанию
export default async function Profile() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string) => t(L, s)
  const u = c.real
  const me = await one<{ last_login_at: string | null; agency: string | null; curator: string | null }>(`select u.last_login_at, a.name agency, cu.name curator from portal.users u
    left join portal.agencies a on a.id = u.agency_id left join portal.users cu on cu.id = u.curator_id where u.id = $1`, [u.id])
  return (
    <>
      <Top title={T('Профиль')} sub={`${u.name} · ${T(ROLE_NAMES[u.role])}${u.market ? ' · ' + u.market : ''}`} />
      <div className="page">
        {c.impersonating && <div className="note" style={{ marginBottom: 16 }}>{T('Это ваш профиль, а не профиль пользователя, от имени которого вы смотрите портал.')}</div>}
        <div className="grid g3" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Аккаунт')}</div>
            <div className="kv"><span>E-mail</span><span className="small">{u.email}</span></div>
            {me?.agency && <div className="kv"><span>{T('Агентство')}</span><span>{me.agency}</span></div>}
            {me?.curator && <div className="kv"><span>{T('Куратор')}</span><span>{me.curator}</span></div>}
            <div className="kv"><span>{T('Последний вход')}</span><span className="small">{dateTime(L, me?.last_login_at || null)}</span></div>
            <form action={setOwnLocale} className="row mt8">
              <select className="in" name="locale" defaultValue={u.locale} style={{ flex: 1 }}>{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
              <button className="btn">{T('Язык по умолчанию')}</button>
            </form>
            <div className="tiny muted">{T('Сменить e-mail, роль или агентство может администратор.')}</div>
          </div>
          <PasswordForm lang={L} />
          <PinForm lang={L} />
        </div>
      </div>
    </>
  )
}
