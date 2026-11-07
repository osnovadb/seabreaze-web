'use client'
import { useFormState } from 'react-dom'
import { uploadInvoice } from '@/lib/moneyActions'
import { t, type Lang } from '@/lib/i18n'

export function InvoiceForm({ lang, id }: { lang: Lang; id: string }) {
  const [st, act] = useFormState(uploadInvoice, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act} className="row noprint" style={{ gap: 8, alignItems: 'flex-end' }}>
      <input type="hidden" name="id" value={id} />
      <label className="field"><span>{T('Счёт против акта (PDF или фото)')}</span><input className="in" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" style={{ paddingTop: 6 }} /></label>
      <button className="btn btn--sm">{T('Загрузить счёт')}</button>
      {st?.error && <span className="badc small">{T(st.error)}</span>}{st?.ok && <span className="okc small">{T('Счёт загружен')}</span>}
    </form>
  )
}
