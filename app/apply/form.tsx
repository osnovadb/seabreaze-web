'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { applyAgent } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, 'Отправить заявку')}</button>
}
export function ApplyForm({ lang, market }: { lang: Lang; market: string }) {
  const [st, act] = useFormState(applyAgent, null)
  const T = (s: string) => t(lang, s)
  if (st?.ok) return (
    <div className="okbox mt24"><b>{T('Заявка отправлена')}</b><div className="mt8">{T('Продавец рынка свяжется с вами в течение 2 рабочих дней. Статус: проверка.')}</div></div>
  )
  const F = (name: string, label: string, ph = '', req = false) => <label className="field"><span>{T(label)}{req ? ' *' : ''}</span><input className="in" name={name} placeholder={ph ? T(ph) : ''} required={req} /></label>
  return (
    <form action={act} className="stack mt16">
      {st?.error && <div className="err">{T(st.error)}</div>}
      <div className="chips">
        <label className="chip"><input type="radio" name="kind" value="agent" defaultChecked /> {T('Частный агент')}</label>
        <label className="chip"><input type="radio" name="kind" value="agency" /> {T('Агентство')}</label>
      </div>
      <div className="grid g2">
        {F('name', 'Имя и фамилия', '', true)}{F('company', 'Компания')}
        {F('email', 'E-mail', '', true)}{F('phone', 'Телефон')}
        {F('city', 'Страна и город')}{F('languages', 'Языки', 'DE, EN, RU')}
        {F('license', 'Разрешение на маклерскую деятельность', '§34c GewO / רישיון מתווך')}{F('volume', 'Клиентов в год (оценка)')}
      </div>
      <label className="field"><span>{T('Рынок')}</span><select className="in" name="market" defaultValue={market}><option value="DE">{T('Германия, Австрия, Швейцария')}</option><option value="IL">{T('Израиль')}</option></select></label>
      {F('channels', 'Как будете продавать', 'Своя база, соцсети, партнёры, мероприятия…')}
      <label className="field"><span>{T('Документы: разрешение §34c GewO или лицензия маклера, выписка из реестра')}</span><input className="in" type="file" name="docs" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" style={{ paddingTop: 6 }} /><span className="tiny muted">{T('PDF или фото, до 3 файлов по 10 МБ. Можно прислать позже куратору.')}</span></label>
      <label className="check"><input type="checkbox" name="consent" /> <span>{T('Согласен с условиями программы и')} <Link className="bronze" href="/legal/privacy" target="_blank">{T('политикой конфиденциальности')}</Link></span></label>
      <Submit lang={lang} />
    </form>
  )
}
