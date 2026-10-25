'use client'
import { useFormState } from 'react-dom'
import { createAgencyAgent } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

export function NewAgent({ lang }: { lang: Lang }) {
  const [st, act] = useFormState(createAgencyAgent, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Добавить сотрудника')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T('Создан. Временный пароль — передайте лично и попросите сменить:')} <b>{st.password}</b></div>}
      <div className="row">
        <label className="field" style={{ flex: 2 }}><span>{T('Имя и фамилия')}</span><input className="in" name="name" required /></label>
        <label className="field" style={{ flex: 2 }}><span>E-mail</span><input className="in" name="email" type="email" required /></label>
        <label className="field" style={{ flex: 1 }}><span>{T('Язык')}</span><select className="in" name="locale" defaultValue={lang}>{['de', 'en', 'ru', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
      </div>
      <button className="btn btn--p">{T('Создать')}</button>
      <div className="tiny muted">{T('Сотрудник видит только своих клиентов; вы видите клиентов и брони всех сотрудников. Комиссия платится агентству.')}</div>
    </form>
  )
}
