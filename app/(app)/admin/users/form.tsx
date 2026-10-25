'use client'
import { useFormState } from 'react-dom'
import { createUser } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'
import { ROLE_NAMES } from '@/lib/perm'

export function NewUser({ lang, agencies }: { lang: Lang; agencies: { id: string; name: string }[] }) {
  const [st, act] = useFormState(createUser, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Новый пользователь')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T('Создан. Временный пароль — передайте лично и попросите сменить:')} <b>{st.password}</b></div>}
      <label className="field"><span>{T('Имя')}</span><input className="in" name="name" required /></label>
      <label className="field"><span>E-mail</span><input className="in" name="email" type="email" required /></label>
      <label className="field"><span>{T('Роль')}</span><select className="in" name="role">{Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{T(v)}</option>)}</select></label>
      <div className="row"><label className="field" style={{ flex: 1 }}><span>{T('Рынок')}</span><select className="in" name="market"><option value="DE">DE</option><option value="IL">IL</option><option value="GLOBAL">GLOBAL</option></select></label>
        <label className="field" style={{ flex: 1 }}><span>{T('Язык')}</span><select className="in" name="locale">{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label></div>
      <label className="field"><span>{T('Агентство (для агентов)')}</span><select className="in" name="agency"><option value="">—</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <button className="btn btn--p">{T('Создать')}</button>
      <div className="tiny muted">{T('Вход по коду из письма подключим вместе с почтой; пока — временный пароль.')}</div>
    </form>
  )
}
