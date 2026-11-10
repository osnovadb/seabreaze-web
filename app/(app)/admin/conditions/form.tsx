'use client'
import { useActionState, useState } from 'react'
import { saveConditions } from '@/lib/actions'
import { split } from '@/lib/money'
import { t, usd, type Lang } from '@/lib/i18n'
import type { Conditions } from '@/lib/catalog'

export function CondForm({ lang, projectId, cur, canEdit, example }: { lang: Lang; projectId: string; cur: Conditions; canEdit: boolean; example: { no: string; usd: number } | null }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [st, act] = useActionState(saveConditions, null)
  const [v, setV] = useState({ ...cur })
  const [disc, setDisc] = useState(6)
  const set = (k: keyof Conditions) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value.replace(',', '.')) })
  const N = (k: keyof Conditions, label: string, unit = '%') => (
    <label className="field"><span>{T(label)}</span><div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><input className="in" name={k} defaultValue={String(cur[k])} onChange={set(k)} disabled={!canEdit} /><span className="small muted" style={{ width: 48 }}>{T(unit)}</span></div></label>
  )
  const sp = example ? split(v, example.usd, disc, true) : null
  return (
    <form action={act} className="stack">
      <input type="hidden" name="project" value={projectId} />
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T(st.ok)}</div>}
      {cur.status === 'draft' && <div className="note">{T('Редактируется черновик v{v}. Действует опубликованная версия; черновик вступит в силу с даты ниже.', { v: cur.version })}</div>}
      <div className="card">
        <div className="label">{T('Вознаграждение от застройщика')}</div>
        <div className="grid g3 mt8">{N('fix_pct', 'Фикс застройщика')}
          <label className="field"><span>{T('Фикс считается от')}</span><select key={`fix_base:${String(cur.fix_base || 'final')}`} className="in" name="fix_base" defaultValue={cur.fix_base || 'final'} disabled={!canEdit}><option value="list">{T('прайса')}</option><option value="final">{T('цены, которую платит клиент')}</option></select></label>
          {N('pool_pct', 'Пул скидки от прайса (если сетки плана нет)')}
          <label className="field"><span>{T('Когда платит застройщик')}</span><select key={`pay_timing:${String(cur.pay_timing)}`} className="in" name="pay_timing" defaultValue={cur.pay_timing} disabled={!canEdit}><option value="after_first_payment">{T('сразу после первого взноса')}</option><option value="proportional">{T('пропорционально платежам')}</option><option value="deposit_35">{T('всё сразу при задатке от 35%')}</option></select></label></div>
        <div className="label mt16">{T('Распределение с саб-агентом')}</div>
        <div className="grid g3 mt8">{N('agent_fix_pct', 'Фикс агенту (из нашего фикса)')}{N('agent_pool_pct', 'Часть пула агенту')}{N('agent_our_pool_share', 'Доля нашей части пула агенту')}</div>
        <div className="label mt16">{T('Скидка и продавцы')}</div>
        <div className="grid g3 mt8">{N('seller_self_disc', 'Продавец сам')}{N('seller_max_disc', 'С согласованием до')}{N('seller_share_pct', 'Доля продавца (% от нашего дохода)')}</div>
        <div className="label mt16">{T('Распределение по ролям (§8)')}</div>
        <div className="tiny muted">{T('Бонусы сейлза и руководителя рынка — % от нашей выручки без НДС после доли партнёра и рекомендателя; начисляются по мере поступления от застройщика. Остаток — Caspian.')}</div>
        <div className="grid g3 mt8">{N('head_bonus_pct', 'Руководитель рынка (% от нашей выручки)')}{N('escort_fix_usd', 'Сопровождающий в Баку, фикс', '$')}{N('referrer_pct', 'Рекомендатель (% от цены договора)')}{N('consultant_pct', 'Консультант по застройщикам (% от цены без НДС)')}{N('vat_rate', 'НДС в цене квартиры')}</div>
        <div className="label mt16">{T('Бронь и защита')}</div>
        <div className="grid g3 mt8">{N('booking_days', 'Бронь', 'дней')}{N('booking_ext_days', 'Продление', 'дней')}{N('protect_months', 'Защита клиента агента', 'мес.')}{N('max_bookings_client', 'Броней на клиента', 'шт.')}{N('max_bookings_agent', 'Броней на агента', 'шт.')}{N('max_bookings_total', 'Одновременных броней по проекту', 'шт.')}</div>
        <div className="grid g3 mt8">{N('booking_fee', 'Платная бронь: взнос', '0 — нет')}
          <label className="field"><span>{T('Валюта взноса')}</span><select key={`booking_fee_currency:${String(cur.booking_fee_currency || 'USD')}`} className="in" name="booking_fee_currency" defaultValue={cur.booking_fee_currency || 'USD'} disabled={!canEdit}>{['USD', 'AZN', 'EUR'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <div className="tiny muted" style={{ alignSelf: 'center' }}>{T('С взносом офис подтверждает бронь только после отметки «взнос получен»; при договоре взнос засчитывается в цену, при снятии финансы решают — вернуть или удержать.')}</div></div>
        <div className="label mt16">{T('Регистрация клиента у застройщика')}</div>
        <div className="grid g3 mt8">
          <label className="field"><span>{T('Как регистрируем')}</span><select key={`reg_method:${String(cur.reg_method || 'email')}`} className="in" name="reg_method" defaultValue={cur.reg_method || 'email'} disabled={!canEdit}><option value="email">{T('письмом')}</option><option value="crm">{T('в CRM застройщика')}</option><option value="api">{T('через API')}</option><option value="file">{T('файлом')}</option></select></label>
          <label className="field"><span>{T('Срок ответа, р. дней')}</span><input className="in" name="reg_response_days" defaultValue={cur.reg_response_days ?? 3} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Плюс к сроку, р. дней')}</span><input className="in" name="silence_extra_days" defaultValue={cur.silence_extra_days ?? 0} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Молчание застройщика')}</span><select key={`silence_rule:${String(cur.silence_rule || 'remind')}`} className="in" name="silence_rule" defaultValue={cur.silence_rule || 'remind'} disabled={!canEdit}><option value="confirm">{T('= подтверждение (по договору)')}</option><option value="remind">{T('только напоминание')}</option></select></label>
          <label className="field"><span>{T('Защита регистрации, мес.')}</span><input className="in" name="reg_protect_months" defaultValue={cur.reg_protect_months ?? 6} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Для клиентов саб-агентов, мес.')}</span><input className="in" name="reg_protect_months_sub" defaultValue={cur.reg_protect_months_sub ?? ''} placeholder={T('как у всех')} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Напомнить о продлении за, дней')}</span><input className="in" name="renew_remind_days" defaultValue={cur.renew_remind_days ?? 7} disabled={!canEdit} /></label>
        </div>
        <div className="label mt16">{T('Комиссия, клаубэк, налоги')}</div>
        <div className="grid g3 mt8">
          {['DE', 'IL', 'GLOBAL'].map((m) => <label key={m} className="field"><span>{T('Ставка для рынка сделки {m}, %', { m })}</span><input className="in" name={'rate_' + m} defaultValue={cur.rates_by_market?.[m] ?? ''} placeholder={T('как фикс')} disabled={!canEdit} /></label>)}
          <label className="field"><span>{T('Комиссия и НДС')}</span><select key={`vat_mode:${String(cur.vat_mode || 'over')}`} className="in" name="vat_mode" defaultValue={cur.vat_mode || 'over'} disabled={!canEdit}><option value="over">{T('сверх НДС')}</option><option value="incl">{T('включая НДС')}</option></select></label>
          <label className="field"><span>{T('Курс пересчёта')}</span><input className="in" name="fx_rule" defaultValue={cur.fx_rule || ''} placeholder={T('ЦБА на дату платежа')} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Ждём поступление, р. дней')}</span><input className="in" name="payment_wait_days" defaultValue={cur.payment_wait_days ?? 10} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Окно клаубэка, мес.')}</span><input className="in" name="clawback_months" defaultValue={cur.clawback_months ?? 3} disabled={!canEdit} /></label>
          <label className="field"><span>{T('Зачёт клаубэка')}</span><select key={`clawback_offset:${String(cur.clawback_offset || 'any')}`} className="in" name="clawback_offset" defaultValue={cur.clawback_offset || 'any'} disabled={!canEdit}><option value="any">{T('против любых следующих выплат')}</option><option value="same_client">{T('только по тому же клиенту')}</option></select></label>
        </div>
        <div className="stack mt8" style={{ gap: 6 }}>
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="options_in_base" defaultChecked={!!cur.options_in_base} disabled={!canEdit} /> {T('Опции входят в базу комиссии')}</label>
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="booking_write_api" defaultChecked={!!cur.booking_write_api} disabled={!canEdit} /> {T('Ставить брони в Profitbase застройщика')}</label>
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="sells_to_az" defaultChecked={!!cur.sells_to_az} disabled={!canEdit} /> {T('Можно продавать клиентам из АЗ')}</label>
        </div>
        <div className="grid g2 mt16">
          <label className="field"><span>{T('Вступает в силу')}</span><input className="in" type="date" name="valid_from" defaultValue={String(cur.valid_from).slice(0, 10)} disabled={!canEdit} /></label>
          <div className="small muted">{T('Планы оплаты и рассрочки — в «Объекты → проект → Планы оплаты».')}</div>
          <label className="field"><span>{T('Комментарий к версии')}</span><input className="in" name="note" defaultValue={cur.note || ''} disabled={!canEdit} /></label>
        </div>
      </div>
      {sp && example && (
        <div className="card" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}>
          <div className="between"><div className="label okc">{T('Проверка на примере · {n}, прайс {p}', { n: example.no, p: usd(lang, example.usd) })}</div>
            <label className="row small okc">{T('скидка клиенту')} <input type="range" min={0} max={v.pool_pct} step={0.5} value={disc} onChange={(e) => setDisc(Number(e.target.value))} /> <b>{disc}%</b></label></div>
          <div className="grid g4 mt8 okc">
            <div><div className="small">{T('Клиент платит')}</div><div className="big">{usd(lang, sp.final)}</div></div>
            <div><div className="small">{T('Агенту')}</div><div className="big">{usd(lang, sp.agent)}</div><div className="tiny">{usd(lang, sp.agentFix)} + {usd(lang, sp.agentPoolLeft + sp.shareToAgent)}</div></div>
            <div><div className="small">{T('Нам')}</div><div className="big">{usd(lang, sp.ours)}</div><div className="tiny">{usd(lang, sp.ourFix)} + {usd(lang, sp.ourPool)}</div></div>
            <div><div className="small">{T('Продавцу')}</div><div className="big">{usd(lang, sp.seller)}</div></div>
          </div>
        </div>
      )}
      {canEdit ? <div className="row"><button className="btn">{T('Сохранить черновик')}</button><button className="btn btn--p" name="publish" value="1">{T('Опубликовать')}</button></div> : <div className="small muted">{T('Только чтение — менять условия может владелец.')}</div>}
    </form>
  )
}
