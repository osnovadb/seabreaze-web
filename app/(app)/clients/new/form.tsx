'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { registerClient, requestDispute } from '@/lib/actions'
import { t, date, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{t(lang, 'Зарегистрировать клиента')}</button>
}
export function RegisterForm({ lang, ext }: { lang: Lang; ext: boolean }) {
  const [st, act] = useFormState(registerClient, null)
  const [ds, dact] = useFormState(requestDispute, null)
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const F = (name: string, label: string, type = 'text', ph = '') => <label className="field"><span>{T(label)}</span><input className="in" name={name} type={type} placeholder={ph ? T(ph) : ''} /></label>
  return (
    <div className="split">
      <form action={act} className="card stack">
        {st?.error && <div className="err">{T(st.error)}</div>}
        <div className="grid g2">
          {F('name', 'Имя и фамилия *')}{F('country', 'Страна')}
          {F('phone', 'Телефон', 'tel')}{F('email', 'E-mail', 'email')}
          <label className="field"><span>{T('Язык общения')}</span><select className="in" name="language" defaultValue={lang}>{['de', 'en', 'ru', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
          {F('budget', 'Бюджет', 'text', '$150–200 тыс.')}
          {F('goal', 'Цель', 'text', 'для себя, отдых, сдача')}{F('timeline', 'Срок покупки')}
        </div>
        {F('interest', 'Интерес', 'text', 'Premium Residence, 2–3 комнаты')}
        {!ext && <label className="field"><span>{T('Источник')}</span><select className="in" name="source"><option value="office">{T('Офис / звонок')}</option><option value="site">{T('Сайт')}</option><option value="referral">{T('Рекомендация')}</option></select></label>}
        <label className="check"><input type="checkbox" name="consent" /> <span>{T('Клиент согласен на обработку данных и передачу контактов застройщику для регистрации сделки.')} <Link className="bronze" href="/legal/consent" target="_blank">{T('Текст согласия')}</Link></span></label>
        <Submit lang={lang} />
        <div className="tiny muted">{T('Проверка по телефону и e-mail в нашей базе. Чужих клиентов и их агентов вы не увидите — только ответ «закреплён» или «уже зарегистрирован».')}</div>
      </form>
      <div className="stack">
        {st?.ok && (
          <div className="okbox">
            <div className="h3">{T('Клиент закреплён за вами')}</div>
            <div className="mt8">{T('Номер регистрации {r} · защита до {d}', { r: st.reg!, d: date(lang, st.until!) })}</div>
            <div className="row mt16"><Link className="btn btn--p" href={`/clients/${st.id}`}>{T('Открыть карточку')}</Link><Link className="btn" href="/projects">{T('К шахматке')}</Link></div>
          </div>
        )}
        {st?.duplicate && (
          <div className="note">
            <div className="h3">{T('Клиент уже зарегистрирован')}</div>
            <div className="mt8">{T('Этот телефон или e-mail уже есть в базе. Кто его зарегистрировал, мы не показываем. Если считаете, что клиент ваш, — запросите проверку: решение по журналу за 2 рабочих дня.')}</div>
            {ds?.ok ? <div className="mt8"><b>{T('Запрос отправлен. Решение придёт уведомлением.')}</b></div> : (
              <form action={dact} className="stack mt8" style={{ gap: 8 }}>
                <input type="hidden" name="name" value={st.tried?.name || ''} /><input type="hidden" name="phone" value={st.tried?.phone || ''} /><input type="hidden" name="email" value={st.tried?.email || ''} />
                <textarea className="in" name="comment" rows={2} placeholder={T('Когда и как вы познакомились с клиентом')} />
                {ds?.error && <div className="err">{T(ds.error)}</div>}
                <button className="btn">{T('Запросить проверку')}</button>
              </form>
            )}
          </div>
        )}
        {!st && <div className="card card--sand small muted">{T('После регистрации клиент закрепляется за вами на срок защиты проекта. Лид уходит куратору в CRM.')}</div>}
      </div>
    </div>
  )
}
