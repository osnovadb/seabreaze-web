'use client'
import { useFormState } from 'react-dom'
import { exitShow } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

export function ExitForm({ lang }: { lang: Lang }) {
  const [st, act] = useFormState(exitShow, null)
  return (
    <form action={act} className="stack">
      {st?.error && <div className="err">{t(lang, st.error)}</div>}
      <input className="in" name="pin" type="password" inputMode="numeric" maxLength={6} autoFocus style={{ fontSize: 22, letterSpacing: 8, textAlign: 'center', height: 52 }} />
      <button className="btn btn--p btn--lg">{t(lang, 'Выйти')}</button>
    </form>
  )
}
