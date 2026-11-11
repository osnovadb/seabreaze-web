'use client'
import { useFormStatus } from 'react-dom'
import { useActionState } from 'react'
import { answerConsent } from '@/lib/consentActions'
import { t, type Lang } from '@/lib/i18n'

function Btn({ lang, label, act, kind = 'btn btn--p' }: { lang: Lang; label: string; act: string; kind?: string }) {
  const { pending } = useFormStatus()
  // «Не согласен» и отзыв — без проверки обязательной галочки
  return <button className={kind} name="act" value={act} disabled={pending} formNoValidate={act !== 'give'}>{t(lang, label)}</button>
}
export function ConsentForm({ lang, token, status, marketing, ads = true }: { lang: Lang; token: string; status: string; marketing: boolean; ads?: boolean }) {
  const [st, act] = useActionState(answerConsent, null)
  const T = (s: string) => t(lang, s)
  if (st?.ok === 'declined') return <div className="okbox mt16" role="status">{T('Мы записали ваш отказ и не будем с вами связываться.')}</div>
  if (st?.ok === 'withdrawn') return <div className="okbox mt16" role="status">{T('Согласие отозвано. Мы больше не передаём ваши данные застройщикам. Если у вас есть подтверждённая бронь, она сохраняется — консультант свяжется с вами.')}</div>
  if (st?.ok === 'saved') return <div className="okbox mt16" role="status">{T('Спасибо! Ваш выбор сохранён.')}</div>
  return (
    <form action={act} className="card stack mt16" style={{ gap: 12 }}>
      {st?.error && <div className="err" role="alert">{T(st.error)}</div>}
      {status === 'given' && <div className="small okc">{T('Согласие на обработку данных уже получено. Здесь можно изменить согласие на рекламу.')}</div>}
      <input type="hidden" name="token" value={token} /><input type="hidden" name="lang" value={lang} />
      <label className="check"><input type="checkbox" name="data" defaultChecked={status === 'given'} required={status !== 'given'} aria-required="true" /> <span>{T('Согласен на обработку моих данных и их передачу застройщикам для подбора и регистрации, включая застройщиков, с которыми работа начнётся позже')} *</span></label>
      {/* 363: клиенту партнёра рекламу не предлагаем — в аудитории и сегменты он не попадает */}
      {ads && <label className="check"><input type="checkbox" name="marketing" defaultChecked={marketing} /> <span>{T('Согласен получать рекламу и рассылки (необязательно)')}</span></label>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Btn lang={lang} label="Подтвердить" act="give" />
        {status === 'given' && marketing && <Btn lang={lang} label="Отозвать согласие на рекламу" act="marketing_off" kind="btn" />}
        {status === 'given' && <Btn lang={lang} label="Отозвать согласие на обработку данных" act="withdraw" kind="btn btn--ghost" />}{/* 386 */}
        {status !== 'given' && <Btn lang={lang} label="Не согласен" act="decline" kind="btn btn--ghost" />}
      </div>
    </form>
  )
}
