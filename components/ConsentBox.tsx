import { t, date, type Lang } from '@/lib/i18n'
import { consentUrl, waText } from '@/lib/consent'
import { sendConsentLink } from '@/lib/consentActions'
import { Pill } from './ui'
import { CopyLink } from './CopyLink'

// 2.2 · §15 Статус согласия клиента и отправка ссылки: письмом (из портала) или в WhatsApp со своего номера
export function ConsentBox({ lang, cl }: { lang: Lang; cl: { id: string; consent_status: string; consent_token: string | null; consent_at: string | null; marketing_consent_at: string | null; phone_norm: string | null; email: string | null; language: string | null; do_not_contact: boolean } }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const st = cl.consent_status
  const url = cl.consent_token ? consentUrl(cl.consent_token) : null
  const cLang = (['ru', 'en', 'de', 'he'].includes(cl.language || '') ? cl.language : 'en') as Lang
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Pill kind={st === 'given' ? 'ok' : st === 'declined' || st === 'withdrawn' ? 'bad' : 'warn'}>{T(st === 'given' ? 'согласие получено' : st === 'declined' ? 'отказ от согласия' : st === 'withdrawn' ? 'согласие отозвано' : st === 'pending' ? 'ждём согласие клиента' : 'согласия нет')}</Pill>
        {st === 'given' && <Pill kind={cl.marketing_consent_at ? 'ok' : 'off'}>{T(cl.marketing_consent_at ? 'реклама: да' : 'реклама: нет')}</Pill>}
        {cl.do_not_contact && <Pill kind="bad">Do not contact</Pill>}
      </div>
      {st === 'given' && cl.consent_at && <div className="tiny muted">{T('с {d}', { d: date(lang, cl.consent_at) })}</div>}
      {st !== 'given' && st !== 'declined' && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <form action={sendConsentLink}><input type="hidden" name="client" value={cl.id} /><button className="btn btn--sm" disabled={!cl.email} title={cl.email ? '' : T('нет e-mail')}>{T('Отправить ссылку письмом')}</button></form>
        {url && cl.phone_norm && <a className="btn btn--sm" href={`https://wa.me/${cl.phone_norm}?text=${encodeURIComponent(waText(cLang, url))}`} target="_blank" rel="noreferrer">WhatsApp</a>}
        {!url && <form action={sendConsentLink}><input type="hidden" name="client" value={cl.id} /><button className="btn btn--sm btn--ghost">{T('Создать ссылку')}</button></form>}
      </div>}
      {url && st !== 'given' && <div><CopyLink url={url} label={T('Скопировать ссылку')} done={T('Скопировано')} /></div>}
    </div>
  )
}
