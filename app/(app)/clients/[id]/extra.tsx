'use client'
import { useFormState } from 'react-dom'
import { requestTour, uploadClientDoc } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

// Заявка офису на тур в Баку (прототип 11: «Показы» → «Запросить тур в Баку»)
export function TourForm({ lang, clientId, clientLang }: { lang: Lang; clientId: string; clientLang: string }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(requestTour, null)
  if (st?.ok) return <div className="okbox small">{T('Заявка отправлена офису в Баку — он подтвердит даты и трансфер.')}</div>
  return (
    <details>
      <summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Запросить тур в Баку')}</summary>
      <form action={act} className="stack mt8" style={{ gap: 8 }}>
        <input type="hidden" name="client" value={clientId} />
        {st?.error && <div className="err">{T(st.error)}</div>}
        <div className="row" style={{ gap: 6 }}>
          <label className="field" style={{ flex: 1 }}><span>{T('С')}</span><input className="in" type="date" name="from" required /></label>
          <label className="field" style={{ flex: 1 }}><span>{T('по')}</span><input className="in" type="date" name="to" /></label>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <label className="field" style={{ flex: 1 }}><span>{T('Человек')}</span><input className="in" type="number" name="people" min={1} defaultValue={2} /></label>
          <label className="field" style={{ flex: 1 }}><span>{T('Язык')}</span><select className="in" name="lang" defaultValue={clientLang}>{['de', 'en', 'ru', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
        </div>
        <input className="in" name="note" placeholder={T('Трансфер, отель, пожелания…')} />
        <div><button className="btn btn--sm">{T('Отправить заявку')}</button></div>
      </form>
    </details>
  )
}

const KINDS: [string, string][] = [['passport', 'паспорт'], ['kyc', 'KYC'], ['booking', 'бронь'], ['contract', 'договор'], ['payment', 'платёж'], ['other', 'другое']]
export function DocUpload({ lang, clientId, team }: { lang: Lang; clientId: string; team: boolean }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useFormState(uploadClientDoc, null)
  return (
    <form action={act} className="stack mt8" style={{ gap: 6 }}>
      <input type="hidden" name="client" value={clientId} />
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="tiny okc">{T('Сохранено')}</div>}
      <div className="row" style={{ gap: 6 }}>
        <select className="in" name="kind" style={{ flex: 1 }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select>
        <input className="in" type="file" name="file" required style={{ flex: 2, paddingTop: 6 }} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="in" name="note" placeholder={T('комментарий')} style={{ flex: 1 }} />
        {team && <label className="check tiny"><input type="checkbox" name="internal" /> <span>{T('только команда')}</span></label>}
        <button className="btn btn--sm">{T('Загрузить')}</button>
      </div>
    </form>
  )
}
