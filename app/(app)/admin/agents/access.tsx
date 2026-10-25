'use client'
import { useFormState } from 'react-dom'
import { createFromApplication } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

// Доступ из заявки: агентство (если заявка от агентства), пользователь с куратором; пароль и PIN показываем один раз
export function CreateAccess({ lang, id, curators }: { lang: Lang; id: string; curators: { id: string; name: string }[] }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(createFromApplication, null)
  if (st?.ok) return <div className="okbox small">{T('Доступ создан')}: {st.email} · {T('пароль')} <b>{st.password}</b> · PIN <b>{st.pin}</b><div className="tiny">{T('Передайте лично; письмо со входом подключим вместе с почтой.')}</div></div>
  return (
    <form action={act} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input type="hidden" name="id" value={id} />
      <select className="in" name="curator" required defaultValue="" style={{ height: 30, width: 150 }}><option value="" disabled>{T('Куратор')}</option>{curators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input className="in" type="date" name="contract" title={T('Договор подписан')} style={{ height: 30, width: 140 }} />
      <button className="btn btn--sm btn--p">{T('Создать доступ')}</button>
      {st?.error && <span className="err tiny">{T(st.error)}</span>}
    </form>
  )
}
