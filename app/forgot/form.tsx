'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { requestReset } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, 'Получить ссылку')}</button>
}
export function ForgotForm({ lang }: { lang: Lang }) {
  const [st, act] = useFormState(requestReset, null)
  if (st?.ok) return <div className="okbox mt24">{t(lang, 'Если такой e-mail есть в портале, ссылка для нового пароля придёт в течение нескольких минут. Если письма нет — напишите своему куратору.')}</div>
  return (
    <form action={act} className="stack mt24" style={{ maxWidth: 420 }}>
      <label className="field"><span>E-mail</span><input className="in" name="email" type="email" required autoComplete="username" /></label>
      <Submit lang={lang} />
    </form>
  )
}
