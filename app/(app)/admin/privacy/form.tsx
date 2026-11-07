'use client'
import { useFormState } from 'react-dom'
import { createPrivacyRequest } from '@/lib/privacy'
import { t, type Lang } from '@/lib/i18n'

export function PrivacyForm({ lang }: { lang: Lang }) {
  const [st, act] = useFormState(createPrivacyRequest, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="field"><span>{T('Клиент: номер R-…, телефон или e-mail')}</span><input className="in" name="client" required style={{ width: 260 }} /></label>
      <label className="field"><span>{T('Как пришёл запрос')}</span><select className="in" name="channel"><option value="email">E-mail</option><option value="phone">{T('Телефон')}</option><option value="form">{T('Форма')}</option><option value="other">{T('Другое')}</option></select></label>
      <label className="field"><span>{T('Заметка')}</span><input className="in" name="note" style={{ width: 220 }} /></label>
      <button className="btn btn--sm btn--p">{T('Зарегистрировать запрос')}</button>
      {st?.error && <span className="badc small">{T(st.error)}</span>}{st?.ok && <span className="okc small">{T('Запрос зарегистрирован — срок исполнения 30 дней')}</span>}
    </form>
  )
}
