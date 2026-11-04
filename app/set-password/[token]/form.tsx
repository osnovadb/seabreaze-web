'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { setPassword } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, 'Сохранить и войти')}</button>
}
export function SetForm({ lang, token, needPin }: { lang: Lang; token: string; needPin: boolean }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(setPassword, null)
  return (
    <form action={act} className="stack mt24" style={{ maxWidth: 420 }}>
      {st?.error && <div className="err">{T(st.error)}</div>}
      <input type="hidden" name="token" value={token} />
      <label className="field"><span>{T('Пароль (не короче 10 символов)')}</span><input className="in" name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
      <label className="field"><span>{T('Пароль ещё раз')}</span><input className="in" name="password2" type="password" minLength={10} required autoComplete="new-password" /></label>
      <label className="field"><span>{needPin ? T('PIN — 4 цифры, для выхода из режима показа клиенту') : T('Новый PIN (необязательно)')}</span>
        <input className="in" name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} required={needPin} autoComplete="off" /></label>
      <Submit lang={lang} />
    </form>
  )
}
