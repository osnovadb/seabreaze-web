'use client'
import { useActionState } from 'react'
import { saveDeveloper } from '@/lib/devActions'
import { t, type Lang } from '@/lib/i18n'
import type { Developer } from '@/lib/developers'

export function DevForm({ lang, cur, canEdit }: { lang: Lang; cur: Developer; canEdit: boolean }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [st, act] = useActionState(saveDeveloper, null)
  const N = (k: keyof Developer, label: string, unit: string) => (
    <label className="field"><span>{T(label)}</span><div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><input className="in" name={k} defaultValue={cur[k] === null ? '' : String(cur[k])} inputMode="numeric" disabled={!canEdit} /><span className="small muted" style={{ width: 70 }}>{T(unit)}</span></div></label>
  )
  const C = (k: keyof Developer, label: string) => <label className="row small" style={{ gap: 8 }}><input type="checkbox" name={k} defaultChecked={Boolean(cur[k])} disabled={!canEdit} /> {T(label)}</label>
  return (
    <form action={act} className="stack">
      <input type="hidden" name="id" value={cur.id} />
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T(st.ok)}</div>}
      <div className="card">
        <div className="grid g2"><label className="field"><span>{T('Застройщик')}</span><input className="in" name="name" defaultValue={cur.name} required disabled={!canEdit} /></label>
          <label className="field"><span>{T('Контакты для регистраций и броней')}</span><input className="in" name="contacts" defaultValue={cur.contacts || ''} disabled={!canEdit} /></label></div>
        <div className="label mt16">{T('Регистрация клиента')}</div>
        <div className="grid g3 mt8">
          <label className="field"><span>{T('Как регистрируем')}</span><select key={`reg_method:${String(cur.reg_method)}`} className="in" name="reg_method" defaultValue={cur.reg_method} disabled={!canEdit}><option value="email">{T('письмом')}</option><option value="crm">{T('в CRM застройщика')}</option><option value="api">{T('через API')}</option><option value="file">{T('файлом')}</option></select></label>
          <label className="field"><span>{T('Почта для регистраций')}</span><input className="in" name="reg_email" defaultValue={cur.reg_email || ''} disabled={!canEdit} /></label>
          {N('reg_response_days', 'Срок ответа', 'р. дней')}
          <label className="field"><span>{T('Молчание застройщика')}</span><select key={`silence_rule:${String(cur.silence_rule)}`} className="in" name="silence_rule" defaultValue={cur.silence_rule} disabled={!canEdit}><option value="confirm">{T('= подтверждение (по договору)')}</option><option value="remind">{T('только напоминание бэк-офису')}</option></select></label>
          {N('silence_extra_days', 'Плюс к сроку ответа', 'р. дней')}
          {N('protect_months', 'Защита регистрации', 'мес.')}
          {N('protect_months_sub', 'Для клиентов саб-агентов', 'мес., если иначе')}
          {N('renew_remind_days', 'Напомнить о продлении за', 'дней')}
        </div>
        <div className="label mt16">{T('Бронь')}</div>
        <div className="grid g3 mt8">{N('booking_days', 'Срок брони', 'дней')}{N('booking_ext_days', 'Продление', 'дней')}{N('max_bookings_total', 'Одновременных броней на GetsEstate', 'шт.')}</div>
        <div className="mt8">{C('booking_write_api', 'Ставить брони в Profitbase застройщика (ключ даёт право записи)')}</div>
        <div className="label mt16">{T('Комиссия')}</div>
        <div className="grid g3 mt8">{N('commission_pct', 'Фикс от цены договора', '%')}
          {['DE', 'IL', 'GLOBAL'].map((m) => <label key={m} className="field"><span>{T('Ставка для рынка сделки {m}', { m })}</span><input className="in" name={'rate_' + m} defaultValue={cur.rates_by_market?.[m] ?? ''} placeholder={T('как фикс')} disabled={!canEdit} /></label>)}
          <label className="field"><span>{T('Комиссия и НДС')}</span><select key={`vat_mode:${String(cur.vat_mode)}`} className="in" name="vat_mode" defaultValue={cur.vat_mode} disabled={!canEdit}><option value="over">{T('сверх НДС')}</option><option value="incl">{T('включая НДС')}</option></select></label>
          <label className="field"><span>{T('Когда платит')}</span><select key={`pay_timing:${String(cur.pay_timing)}`} className="in" name="pay_timing" defaultValue={cur.pay_timing} disabled={!canEdit}><option value="after_first_payment">{T('после первого взноса')}</option><option value="proportional">{T('пропорционально платежам')}</option><option value="deposit_35">{T('сразу при задатке от 35%')}</option></select></label>
          <label className="field"><span>{T('Курс пересчёта')}</span><input className="in" name="fx_rule" defaultValue={cur.fx_rule || ''} placeholder={T('ЦБА на дату платежа')} disabled={!canEdit} /></label>
          {N('payment_wait_days', 'Ждём поступление', 'р. дней')}
        </div>
        <div className="mt8">{C('options_in_base', 'Опции входят в базу комиссии (257)')}</div>
        <div className="label mt16">{T('Клаубэк и продажи')}</div>
        <div className="grid g3 mt8">{N('clawback_months', 'Окно клаубэка', 'мес.')}
          <label className="field"><span>{T('Зачёт')}</span><select key={`clawback_offset:${String(cur.clawback_offset)}`} className="in" name="clawback_offset" defaultValue={cur.clawback_offset} disabled={!canEdit}><option value="any">{T('против любых следующих выплат')}</option><option value="same_client">{T('только по тому же клиенту')}</option></select></label>
          <div className="stack" style={{ gap: 6, alignSelf: 'center' }}>{C('sells_to_az', 'Можно продавать клиентам из АЗ')}{C('active', 'Работаем с застройщиком')}</div>
        </div>
        <label className="field mt16"><span>{T('Заметка по договору')}</span><input className="in" name="note" defaultValue={cur.note || ''} disabled={!canEdit} /></label>
      </div>
      {canEdit ? <div className="row"><button className="btn btn--p">{T('Сохранить')}</button></div> : <div className="small muted">{T('Только чтение — условия застройщика меняет админ.')}</div>}
    </form>
  )
}
