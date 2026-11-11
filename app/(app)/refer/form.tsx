'use client'
import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { referClient } from '@/lib/refActions'
import { t, type Lang } from '@/lib/i18n'
import { CountrySelect } from '@/components/CountrySelect'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p" disabled={pending}>{t(lang, 'Передать контакт')}</button>
}
export function ReferForm({ lang }: { lang: Lang }) {
  const [st, act] = useActionState(referClient, null)
  const ref = useRef<HTMLFormElement>(null)
  const T = (s: string) => t(lang, s)
  useEffect(() => { if (st?.ok) ref.current?.reset() }, [st])
  return (
    <form ref={ref} action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Порекомендовать человека')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T('Спасибо! Контакт передан команде — менеджер свяжется с человеком. Статус — в списке ниже.')}</div>}
      <div className="grid g2">
        <label className="field"><span>{T('Имя и фамилия')} *</span><input className="in" name="name" required /></label>
        <label className="field"><span>{T('Страна проживания')}</span><CountrySelect lang={lang} /></label>
        <label className="field"><span>{T('Телефон')}</span><input className="in" name="phone" type="tel" /></label>
        <label className="field"><span>E-mail</span><input className="in" name="email" type="email" /></label>
      </div>
      <label className="field"><span>{T('Что ищет (по желанию)')}</span><textarea className="in" name="comment" rows={2} /></label>
      <label className="check"><input type="checkbox" name="consent" /> <span>{T('Человек знает о рекомендации и согласен, чтобы GetsEstate с ним связались')}</span></label>
      <Submit lang={lang} />
    </form>
  )
}
