'use client'
import { useFormState } from 'react-dom'
import { changeOwnPassword, changeOwnPin } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

export function PasswordForm({ lang }: { lang: Lang }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(changeOwnPassword, null)
  return (
    <form action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Пароль')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T('Пароль изменён. Другие сеансы завершены.')}</div>}
      <label className="field"><span>{T('Текущий пароль')}</span><input className="in" type="password" name="current" autoComplete="current-password" required /></label>
      <label className="field"><span>{T('Новый пароль (не короче 10 символов)')}</span><input className="in" type="password" name="password" autoComplete="new-password" minLength={10} required /></label>
      <label className="field"><span>{T('Новый пароль ещё раз')}</span><input className="in" type="password" name="password2" autoComplete="new-password" minLength={10} required /></label>
      <div><button className="btn btn--p">{T('Сменить пароль')}</button></div>
    </form>
  )
}

export function PinForm({ lang }: { lang: Lang }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(changeOwnPin, null)
  return (
    <form action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('PIN режима показа')}</div>
      <div className="small muted">{T('PIN нужен, чтобы выйти из режима показа клиенту. Клиент его знать не должен.')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T('PIN изменён')}</div>}
      <label className="field"><span>{T('Новый PIN (4–6 цифр)')}</span><input className="in" name="pin" inputMode="numeric" pattern="\d{4,6}" autoComplete="off" required /></label>
      <label className="field"><span>{T('Текущий пароль')}</span><input className="in" type="password" name="current" autoComplete="current-password" required /></label>
      <div><button className="btn">{T('Сменить PIN')}</button></div>
    </form>
  )
}
