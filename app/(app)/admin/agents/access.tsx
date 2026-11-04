'use client'
import { useFormState } from 'react-dom'
import { createFromApplication } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'
import { InviteLink } from '@/components/InviteLink'

// Доступ из заявки: агентство (если заявка от агентства), пользователь с куратором; ссылку-приглашение показываем один раз
export function CreateAccess({ lang, id, curators }: { lang: Lang; id: string; curators: { id: string; name: string }[] }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(createFromApplication, null)
  if (st && 'link' in st) return <InviteLink lang={lang} link={st.link} mailed={st.mailed} title={T('Доступ создан') + ': ' + st.email + ' — ' + T('пароль и PIN пользователь задаст сам по ссылке (7 дней)')} />
  return (
    <form action={act} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input type="hidden" name="id" value={id} />
      <select className="in" name="curator" required defaultValue="" style={{ height: 30, width: 150 }}><option value="" disabled>{T('Куратор')}</option>{curators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input className="in" type="date" name="contract" title={T('Договор подписан')} style={{ height: 30, width: 140 }} />
      <button className="btn btn--sm btn--p">{T('Создать доступ')}</button>
      {st && 'error' in st && st.error && <span className="err tiny">{T(st.error)}</span>}
    </form>
  )
}
