'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { saveConditions } from '@/lib/actions'
import { split } from '@/lib/money'
import { t, usd, type Lang } from '@/lib/i18n'
import type { Conditions } from '@/lib/catalog'

export function CondForm({ lang, projectId, cur, canEdit, example }: { lang: Lang; projectId: string; cur: Conditions; canEdit: boolean; example: { no: string; usd: number } | null }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [st, act] = useFormState(saveConditions, null)
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
        <div className="grid g3 mt8">{N('fix_pct', 'Фикс от итоговой цены')}{N('pool_pct', 'Пул скидки от прайса')}
          <label className="field"><span>{T('Когда платит застройщик')}</span><select className="in" name="pay_timing" defaultValue={cur.pay_timing} disabled={!canEdit}><option value="after_first_payment">{T('сразу после первого взноса')}</option><option value="proportional">{T('пропорционально платежам')}</option><option value="deposit_35">{T('всё сразу при задатке от 35%')}</option></select></label></div>
        <div className="label mt16">{T('Распределение с саб-агентом')}</div>
        <div className="grid g3 mt8">{N('agent_fix_pct', 'Фикс агенту (из нашего фикса)')}{N('agent_pool_pct', 'Часть пула агенту')}{N('agent_our_pool_share', 'Доля нашей части пула агенту')}</div>
        <div className="label mt16">{T('Скидка и продавцы')}</div>
        <div className="grid g3 mt8">{N('seller_self_disc', 'Продавец сам')}{N('seller_max_disc', 'С согласованием до')}{N('seller_share_pct', 'Доля продавца (% от нашего дохода)')}</div>
        <div className="label mt16">{T('Бронь и защита')}</div>
        <div className="grid g3 mt8">{N('booking_days', 'Бронь', 'дней')}{N('booking_ext_days', 'Продление', 'дней')}{N('protect_months', 'Защита клиента агента', 'мес.')}{N('max_bookings_client', 'Броней на клиента', 'шт.')}{N('max_bookings_agent', 'Броней на агента', 'шт.')}{N('max_bookings_total', 'Всего у застройщика', 'шт.')}</div>
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
