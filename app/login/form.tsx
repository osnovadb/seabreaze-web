'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { login } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, pending ? 'Входим…' : 'Войти')}</button>
}
export function LoginForm({ lang }: { lang: Lang }) {
  const [st, act] = useFormState(login, null)
  return (
    <form action={act} className="stack mt24" style={{ maxWidth: 420 }}>
      {st?.error && <div className="err">{t(lang, st.error)}</div>}
      <label className="field"><span>E-mail</span><input className="in" name="email" type="email" required autoComplete="username" /></label>
      <label className="field"><span>{t(lang, 'Пароль')}</span><input className="in" name="password" type="password" required autoComplete="current-password" /></label>
      <Submit lang={lang} />
    </form>
  )
}
