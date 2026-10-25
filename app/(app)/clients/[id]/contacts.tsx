'use client'
import { useFormState } from 'react-dom'
import { updateClientContacts } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

// Правка контактов клиента — с проверкой, что телефон или e-mail не принадлежит другому клиенту
export function EditContacts({ lang, cl }: { lang: Lang; cl: { id: string; name: string; phone: string | null; email: string | null; country: string | null; language: string | null } }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(updateClientContacts, null)
  return (
    <details className="mt8">
      <summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Изменить контакты')}</summary>
      <form action={act} className="stack mt8" style={{ gap: 8 }}>
        <input type="hidden" name="client" value={cl.id} />
        {st?.error && <div className="err">{T(st.error)}</div>}
        {st?.ok && <div className="okbox">{T('Сохранено')}</div>}
        <label className="field"><span>{T('Имя и фамилия')}</span><input className="in" name="name" defaultValue={cl.name} required /></label>
        <label className="field"><span>{T('Телефон')}</span><input className="in" name="phone" type="tel" defaultValue={cl.phone || ''} /></label>
        <label className="field"><span>E-mail</span><input className="in" name="email" type="email" defaultValue={cl.email || ''} /></label>
        <div className="row" style={{ gap: 6 }}>
          <label className="field" style={{ flex: 1 }}><span>{T('Страна')}</span><input className="in" name="country" defaultValue={cl.country || ''} /></label>
          <label className="field" style={{ flex: 1 }}><span>{T('Язык общения')}</span><select className="in" name="language" defaultValue={cl.language || 'de'}>{['de', 'en', 'ru', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
        </div>
        <div><button className="btn btn--sm">{T('Сохранить')}</button></div>
      </form>
    </details>
  )
}
