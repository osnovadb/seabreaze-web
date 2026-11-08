'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { clientKycUpload } from '@/lib/kycActions'
import { t, type Lang } from '@/lib/i18n'

function Btn({ lang, again }: { lang: Lang; again?: boolean }) { const { pending } = useFormStatus(); return <button className={'btn btn--sm' + (again ? '' : ' btn--p')} disabled={pending}>{t(lang, pending ? 'Загружаем…' : again ? 'Добавить ещё' : 'Загрузить')}</button> }
export function ClientUpload({ lang, token, buyer, kinds, again }: { lang: Lang; token: string; buyer: string; kinds: string[][]; again?: boolean }) {
  const [st, act] = useFormState(clientKycUpload, null)
  const T = (s: string) => t(lang, s)
  return (
    <form action={act} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <input type="hidden" name="token" value={token} /><input type="hidden" name="buyer" value={buyer} />
      {kinds.length === 1 ? <input type="hidden" name="kind" value={kinds[0][0]} /> : <label className="field"><span>{T('Документ')}</span><select className="in" name="kind">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
      <label className="field" style={{ flex: 1, minWidth: 0 }}><span>{T('Файл (PDF или фото)')}</span><input className="in" type="file" name="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,image/*" style={{ paddingTop: 6 }} /></label>
      <Btn lang={lang} again={again} />
      {st?.error && <span className="badc small" role="alert">{T(st.error)}</span>}{st?.ok && <span className="okc small" role="status">{T('Загружено — спасибо!')}</span>}
    </form>
  )
}
