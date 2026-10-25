'use client'
import { useFormState } from 'react-dom'
import { createBooking } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

export function ShowBook({ lang, unitId, clientId }: { lang: Lang; unitId: string; clientId: string }) {
  const [st, act] = useFormState(createBooking, null)
  return (
    <form action={act} className="mt8">
      <input type="hidden" name="unit" value={unitId} /><input type="hidden" name="client" value={clientId} /><input type="hidden" name="discount" value="0" />
      {st?.error && <div className="err mb8">{t(lang, st.error)}</div>}
      <button className="btn btn--p btn--lg btn--block">{t(lang, 'Забронировать')}</button>
    </form>
  )
}
