'use client'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { applyAgent } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, 'Отправить заявку')}</button>
}
export function ApplyForm({ lang, market }: { lang: Lang; market: string }) {
  const [st, act] = useActionState(applyAgent, null)
  // QA 09.11: рекомендателю лицензия, компания и документы не нужны — прячем; подсказка — только для выбранного вида
  const [kind, setKind] = useState('agent')
  const [mk, setMk] = useState(market)
  const ref = kind === 'referrer'
  const T = (s: string) => t(lang, s)
  if (st?.ok) return (
    st.referrer ? <div className="okbox mt24"><b>{T('Доступ открыт')}</b><div className="mt8">{T('Ссылка для входа в кабинет рекомендателя отправлена на ваш e-mail.')}</div></div> :
    <div className="okbox mt24"><b>{T('Заявка отправлена')}</b><div className="mt8">{T('Менеджер по партнёрам свяжется с вами в течение 2 рабочих дней. Ссылку на статус заявки мы отправили на ваш e-mail.')}</div>{st.token && <div className="mt8"><Link className="bronze" href={`/apply/status/${st.token}?lang=${lang}`}>{T('Статус заявки — сохраните эту ссылку')} →</Link></div>}</div>
  )
  const F = (name: string, label: string, ph = '', req = false) => <label className="field"><span>{T(label)}{req ? ' *' : ''}</span><input className="in" name={name} placeholder={ph ? T(ph) : ''} required={req} /></label>
  return (
    <form action={act} className="stack mt16">
      {st?.error && <div className="err">{T(st.error)}</div>}
      <div className="chips">
        {[['agent', 'Частный агент'], ['agency', 'Агентство'], ['referrer', 'Рекомендатель (Tippgeber)']].map(([v, l]) => <label key={v} className={'chip' + (kind === v ? ' on' : '')}><input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} /> {T(l)}</label>)}
      </div>
      {ref && <div className="tiny muted">{T('Рекомендатель передаёт нам контакты знакомых и получает 2% от цены договора. Лицензия не нужна, доступ — сразу; ссылка для входа придёт на почту.')}</div>}
      <input type="hidden" name="lang" value={lang} />
      <div className="grid g2">
        {F('name', 'Имя и фамилия', '', true)}{!ref && F('company', kind === 'agency' ? 'Название агентства' : 'Компания')}
        {F('email', 'E-mail', '', true)}{F('phone', 'Телефон')}
        {F('city', 'Страна и город')}{F('languages', 'Языки', 'DE, EN, RU')}
        {!ref && F('license', 'Разрешение на маклерскую деятельность', mk === 'IL' ? 'רישיון מתווך' : mk === 'DE' ? '§34c GewO' : '')}{!ref && F('volume', 'Клиентов в год (оценка)')}
      </div>
      <label className="field"><span>{T('Рынок')}</span><select className="in" name="market" value={mk} onChange={(e) => setMk(e.target.value)}><option value="DE">{T('Германия, Австрия, Швейцария')}</option><option value="IL">{T('Израиль')}</option><option value="GLOBAL">{T('Другие страны')}</option></select></label>
      {!ref && F('channels', 'Как будете продавать', 'Своя база, соцсети, партнёры, мероприятия…')}
      {!ref && <label className="field"><span>{T('Документы: разрешение §34c GewO или лицензия маклера, выписка из реестра')}</span><input className="in" type="file" name="docs" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" style={{ paddingTop: 6 }} /><span className="tiny muted">{T('PDF или фото, до 3 файлов по 10 МБ. Можно прислать позже куратору.')}</span></label>}
      <label className="check"><input type="checkbox" name="consent" /> <span>{T('Согласен с условиями программы и')} <Link className="bronze" href="/legal/privacy" target="_blank">{T('политикой конфиденциальности')}</Link></span></label>
      <Submit lang={lang} />
    </form>
  )
}
