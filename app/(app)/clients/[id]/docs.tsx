'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { makeDocument, docStatus } from '@/lib/docActions'
import { t, type Lang } from '@/lib/i18n'

const NAMES: Record<string, string> = { booking_offer: 'Оферта брони', fixation_act: 'Акт фиксации клиента', commission_act: 'Акт вознаграждения' }
// Создание документа из шаблона: по брони клиента или по фиксации у застройщика (М8)
export function MakeDoc({ lang, clientId, clientLang, bookings, fixations, commission }: {
  lang: Lang; clientId: string; clientLang: string; bookings: { id: string; unit: string }[]; fixations: { project_id: string; name: string }[]; commission: boolean
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [kind, setKind] = useState(bookings.length ? 'booking_offer' : 'fixation_act')
  const [st, act] = useFormState(makeDocument, null)
  const kinds = ['booking_offer', 'fixation_act', ...(commission ? ['commission_act'] : [])]
  const byBooking = kind !== 'fixation_act'
  return (
    <form action={act} className="stack mt8" style={{ gap: 6 }}>
      <input type="hidden" name="client" value={clientId} />
      <div className="row" style={{ gap: 6 }}>
        <select className="in" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} style={{ flex: 2 }}>{kinds.map((k) => <option key={k} value={k}>{T(NAMES[k])}</option>)}</select>
        <select className="in" name="lang" defaultValue={['ru', 'en', 'de', 'he'].includes(clientLang) ? clientLang : 'en'} style={{ flex: 1 }}>{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
      </div>
      {byBooking
        ? <select className="in" name="booking" required>{bookings.length === 0 && <option value="">{T('У клиента нет броней')}</option>}{bookings.map((b) => <option key={b.id} value={b.id}>{T('Бронь {u}', { u: b.unit })}</option>)}</select>
        : <select className="in" name="project" required>{fixations.length === 0 && <option value="">{T('Нет фиксаций')}</option>}{fixations.map((f) => <option key={f.project_id} value={f.project_id}>{f.name}</option>)}</select>}
      {st?.error && <div className="err tiny">{st.error}</div>}
      {st?.ok && <div className="tiny okc">{T('Создан документ {n}', { n: st.number })}{st.pdf ? '' : ' · ' + T('PDF не собран — только docx')}</div>}
      <div><button className="btn btn--sm btn--p" disabled={byBooking ? !bookings.length : !fixations.length}>{T('Создать документ')}</button></div>
    </form>
  )
}
export function DocStatus({ lang, id, status }: { lang: Lang; id: string; status: string }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(docStatus, null)
  if (status === 'signed' || status === 'void') return null
  return (
    <form action={act} className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }} encType="multipart/form-data">
      <input type="hidden" name="id" value={id} />
      {status === 'draft' && <button className="btn btn--sm" name="to" value="sent">{T('Отправлен')}</button>}
      {status === 'sent' && <><input className="in" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.heic" style={{ maxWidth: 170, paddingTop: 4, height: 30 }} /><button className="btn btn--sm" name="to" value="signed">{T('Подписан')}</button></>}
      <button className="btn btn--sm" name="to" value="void" title={T('Аннулировать')}>×</button>
      {st?.error && <div className="err tiny">{T(st.error)}</div>}
    </form>
  )
}
