'use client'
import { InviteLink } from '@/components/InviteLink'
import { useActionState } from 'react'
import { createAgencyAgent, resetPassword } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

export function NewAgent({ lang }: { lang: Lang }) {
  const [st, act] = useActionState(createAgencyAgent, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Добавить сотрудника')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st && 'link' in st && <InviteLink lang={lang} link={st.link} mailed={st.mailed} title={T('Создан. Пароль пользователь задаст сам по ссылке-приглашению (7 дней):')} />}
      <div className="row">
        <label className="field" style={{ flex: 2 }}><span>{T('Имя и фамилия')}</span><input className="in" name="name" required /></label>
        <label className="field" style={{ flex: 2 }}><span>E-mail</span><input className="in" name="email" type="email" required /></label>
        <label className="field" style={{ flex: 1 }}><span>{T('Язык')}</span><select key={`locale:${String(lang)}`} className="in" name="locale" defaultValue={lang}>{['de', 'en', 'ru', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
      </div>
      <button className="btn btn--p">{T('Создать')}</button>
      <div className="tiny muted">{T('Сотрудник видит только своих клиентов; вы видите клиентов и брони всех сотрудников. Комиссия платится агентству.')}</div>
    </form>
  )
}

// Ссылка для входа сотруднику: приглашение (если пароль не задан) или сброс пароля
export function AgentLink({ lang, id }: { lang: Lang; id: string }) {
  const [st, act] = useActionState(resetPassword, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act}>
      <input type="hidden" name="id" value={id} />
      {st && 'link' in st && st.link ? <InviteLink lang={lang} link={st.link} mailed={st.mailed} title={T('Ссылка для входа:')} /> : <button className="btn btn--sm">{T('Ссылка для входа')}</button>}
      {st?.error && <div className="err">{T(st.error)}</div>}
    </form>
  )
}
