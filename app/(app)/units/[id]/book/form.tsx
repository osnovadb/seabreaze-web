'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createBooking } from '@/lib/actions'
import { split, type SplitCond } from '@/lib/money'
import { planBase, schedule, isFull, type Plan } from '@/lib/plans'
import { t, usd, pct, type Lang } from '@/lib/i18n'

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{label}</button>
}
export function BookForm({ lang, unitId, list: priceList, ext, cap, ceiling, cond, days, ext_days, clients, plans, preset, showOurs }: {
  lang: Lang; unitId: string; list: number; ext: boolean; cap: number; ceiling: number; cond: SplitCond; days: number; ext_days: number
  clients: { id: string; name: string; reg_no: string }[]; plans: Plan[]; preset?: string; showOurs: boolean
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [disc, setDisc] = useState(0)
  const [planId, setPlanId] = useState(plans[0]?.id || '')
  const plan = plans.find((p) => p.id === planId)
  // Скидка застройщика за 100% снижает цену до раздела денег
  const list = planBase(plan, priceList)
  const sc = plan ? schedule(plan, list * (1 - disc / 100)) : null
  const [st, act] = useFormState(createBooking, null)
  const sp = split(cond, list, disc, ext)
  return (
    <form action={act} className="stack">
      <div className="card">
        {plans.length > 0 && (
          <div className="mt0" style={{ marginBottom: 16 }}>
            <div className="h3">{T('План оплаты')}</div>
            <div className="chips mt8">{plans.map((p) => <button type="button" key={p.id} className={'chip' + (p.id === planId ? ' on' : '')} onClick={() => setPlanId(p.id)}>{p.name}</button>)}</div>
            <input type="hidden" name="plan" value={planId} />
            {plan && sc && <div className="small muted mt8">{sc.full ? (Number(plan.full_payment_discount_pct) ? T('Скидка застройщика за 100%: {p} — цена {a}', { p: pct(lang, Number(plan.full_payment_discount_pct)), a: usd(lang, list) }) : T('Полная оплата')) : T('Первый взнос {d} ({p}), затем {m} платежей по {x}', { d: usd(lang, sc.down), p: pct(lang, Number(plan.down_payment_pct)), m: sc.months, x: usd(lang, sc.monthly) })}</div>}
          </div>
        )}
        <div className="h3">{ext ? T('Скидка клиенту из вашей части пула') : T('Скидка клиенту')}</div>
        <div className="small muted">{ext ? T('Вам выделено {p} от прайса: сколько отдать клиенту, а сколько оставить себе — решаете вы', { p: pct(lang, cond.agent_pool_pct) }) : T('Сами — до {p}, больше — с согласованием руководителя', { p: pct(lang, cap) })}</div>
        <input className="disc mt16" type="range" min={0} max={ceiling} step={0.5} value={disc} onChange={(e) => setDisc(Number(e.target.value))} name="discount" />
        <div className="between small muted"><span>0%</span><b style={{ color: 'var(--ink)' }}>{pct(lang, disc)}</b><span>{pct(lang, ceiling)}</span></div>
        {disc > cap && <div className="note mt8">{T('Скидка сверх {p} — бронь уйдёт на согласование владельцу или руководителю рынка; офис подтвердит её после решения.', { p: pct(lang, cap) })}</div>}
        <div className="grid g2 mt16">
          <div className="card card--sand card--tight"><div className="small muted">{T('Клиент платит застройщику')}</div><div className="big num">{usd(lang, sp.final)}</div><div className="tiny muted">{T('прайс {a} − скидка {d}', { a: usd(lang, list), d: usd(lang, sp.discount) })}</div></div>
          {ext
            ? <div className="card card--tight" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}><div className="small okc">{T('Ваш доход по сделке')}</div><div className="big num okc">{usd(lang, sp.agent)}</div><div className="tiny okc">{T('фикс {f} + остаток вашей части пула {p}', { f: usd(lang, sp.agentFix), p: usd(lang, sp.agentPoolLeft) })}</div></div>
            : showOurs ? <div className="card card--tight" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}><div className="small okc">{T('Наш доход по сделке')}</div><div className="big num okc">{usd(lang, sp.ours)}</div><div className="tiny okc">{T('фикс {f} + пул {p} · продавцу {s}', { f: usd(lang, sp.ourFix), p: usd(lang, sp.ourPool), s: usd(lang, sp.seller) })}</div></div>
              : <div className="card card--tight"><div className="small muted">{T('Скидка')}</div><div className="big num">{pct(lang, disc)}</div></div>}
        </div>
        <div className="mt16">
          <div className="kv"><span>{T('Прайс застройщика')}</span><span>{usd(lang, list)}</span></div>
          <div className="kv"><span>{T('Итоговая цена')}</span><span>{usd(lang, sp.final)}</span></div>
          {ext && <div className="kv"><span>{T('Ваш фикс')}</span><span>{pct(lang, cond.agent_fix_pct)} {T('от итоговой цены')} · {usd(lang, sp.agentFix)}</span></div>}
          {ext && <div className="kv"><span>{T('Ваша часть пула, не отданная клиенту')}</span><span>{pct(lang, Math.max(0, cond.agent_pool_pct - disc))} · {usd(lang, sp.agentPoolLeft)}</span></div>}
          <div className="kv"><span>{T('Срок брони')}</span><span>{T('{a} дней + одно продление на {b}', { a: days, b: ext_days })}</span></div>
          <div className="kv"><span>{T('Выплата')}</span><span>{T('после оплаты застройщиком')}</span></div>
        </div>
      </div>
      <div className="card">
        <label className="field"><span>{T('Клиент (закреплённый за вами)')}</span>
          <select className="in" name="client" defaultValue={preset || ''} required>
            <option value="" disabled>{T('Выберите клиента')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.reg_no}</option>)}
          </select>
        </label>
        {clients.length === 0 && <div className="note mt8">{T('Нет закреплённых клиентов.')} <Link className="bronze" href="/clients/new">{T('Зарегистрировать клиента →')}</Link></div>}
        <input type="hidden" name="unit" value={unitId} />
        {st?.error && <div className="err mt8">{T(st.error)}</div>}
        <div className="mt16"><Submit label={T('Поставить бронь по {p}', { p: usd(lang, sp.final) })} /></div>
        <div className="tiny muted mt8">{T('Цена и условия фиксируются в брони. Офис в Баку подтверждает бронь у застройщика.')}</div>
      </div>
    </form>
  )
}
