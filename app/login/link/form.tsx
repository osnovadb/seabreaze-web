'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { requestLoginLink } from '@/lib/refActions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, 'Прислать ссылку')}</button>
}
export function LinkForm({ lang }: { lang: Lang }) {
  const [st, act] = useFormState(requestLoginLink, null)
  const T = (s: string) => t(lang, s)
  if (st?.ok) return <div className="okbox mt24">{T('Если этот e-mail зарегистрирован у рекомендателя, ссылка для входа уже в почте. Она действует 7 дней и открывается один раз.')}</div>
  return (
    <form action={act} className="stack mt16">
      {st?.error && <div className="err">{T(st.error)}</div>}
      <label className="field"><span>E-mail</span><input className="in" name="email" type="email" required autoComplete="email" /></label>
      <Submit lang={lang} />
    </form>
  )
}
