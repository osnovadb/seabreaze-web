'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createBooking } from '@/lib/actions'
import { split, type SplitCond } from '@/lib/money'
import { priceChain, isFull, termUnknown, hasSchedule, planLabel, type Plan, type PromoView, type PromoMode } from '@/lib/plans'
import { ScheduleTable, type FxView } from '@/components/Calculator'
import { t, usd, pct, num, type Lang } from '@/lib/i18n'
import type { Opt } from '@/lib/options'

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{label}</button>
}
export function BookForm({ lang, unitId, list: priceList, ext, cap, ceiling, cond, days, ext_days, clients, plans, fx, promo, mode, preset, showOurs, options = [], pkgs = [] }: {
  lang: Lang; unitId: string; list: number; ext: boolean; cap: number; ceiling: number; cond: SplitCond; days: number; ext_days: number
  clients: { id: string; name: string; reg_no: string }[]; plans: Plan[]; fx: FxView; promo: PromoView | null; mode: PromoMode; preset?: string; showOurs: boolean; options?: Opt[]; pkgs?: { id: string; client_id: string; unit: string }[]
}) {
  const [cid, setCid] = useState(preset || '')
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [disc, setDisc] = useState(0)
  const [planId, setPlanId] = useState(plans[0]?.id || '')
  const plan = plans.find((p) => p.id === planId)
  // Скидка застройщика за 100% снижает цену до раздела денег
  const ch = priceChain(priceList, plan, promo, mode)
  const list = ch.base
  const maxDisc = ch.poolAllowed ? ceiling : 0
  useEffect(() => { if (disc > maxDisc) setDisc(maxDisc) }, [maxDisc]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false)
  const [st, act] = useFormState(createBooking, null)
  const sp = split(cond, list, disc, ext)
  const [picked, setPicked] = useState<string[]>([])
  // Опции — сверху итоговой цены, без скидок и вне раздела денег (комиссия считается с квартиры)
  const optSum = options.filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.usd, 0)
  return (
    <form action={act} className="stack">
      <div className="card">
        {plans.length > 0 && (
          <div className="mt0" style={{ marginBottom: 16 }}>
            <div className="h3">{T('План оплаты')}</div>
            <div className="chips mt8">{plans.map((p) => <button type="button" key={p.id} className={'chip' + (p.id === planId ? ' on' : '')} onClick={() => setPlanId(p.id)}>{planLabel(T, p.name)}</button>)}</div>
            <input type="hidden" name="plan" value={planId} />
            {plan && <div className="small muted mt8">{isFull(plan) ? (Number(plan.full_payment_discount_pct) ? T('Скидка застройщика за 100%: {p} — цена {a}', { p: pct(lang, Number(plan.full_payment_discount_pct)), a: usd(lang, list) }) : T('Полная оплата'))
              : termUnknown(plan) ? T('Первый взнос {p}; срок и платежи — по графику застройщика', { p: pct(lang, Number(plan.down_payment_pct)) })
                : hasSchedule(plan) ? T('Первый взнос {p}, затем этапы по графику застройщика: {n}', { p: pct(lang, Number(plan.down_payment_pct)), n: plan.schedule!.filter((m) => Number(m.pct) > 0).length })
                : T('Первый взнос {p}, затем ежемесячные платежи: {m}', { p: pct(lang, Number(plan.down_payment_pct)), m: plan.months || 0 })}</div>}
          </div>
        )}
        {options.length > 0 && <div style={{ marginBottom: 16 }}>
          <div className="h3">{T('Опции')}</div>
          {options.map((o) => <label key={o.id} className="kv check" style={{ cursor: 'pointer' }}><span><input type="checkbox" name="options" value={o.id} checked={picked.includes(o.id)} onChange={(e) => setPicked((a) => (e.target.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))} /> {o.title}{o.note ? <div className="tiny muted">{o.note}</div> : null}</span>
            <span className="small">+{usd(lang, o.usd)}{o.currency !== 'USD' ? <div className="tiny muted">{o.currency} {num(lang, o.price)}</div> : null}</span></label>)}
          <div className="tiny muted mt8">{T('Опции оплачиваются застройщику сверх цены квартиры; скидки и ваша комиссия на них не распространяются.')}</div>
        </div>}
        <div className="h3">{ext ? T('Скидка клиенту из вашей части пула') : T('Скидка клиенту')}</div>
        <div className="small muted">{ext ? T('Вам выделено {p} от прайса: сколько отдать клиенту, а сколько оставить себе — решаете вы', { p: pct(lang, cond.agent_pool_pct) }) : T('Сами — до {p}, больше — с согласованием руководителя', { p: pct(lang, cap) })}</div>
        <input className="disc mt16" type="range" min={0} max={maxDisc} step={0.5} value={disc} onChange={(e) => setDisc(Number(e.target.value))} name="discount" />
        <div className="between small muted"><span>0%</span><b style={{ color: 'var(--ink)' }}>{pct(lang, disc)}</b><span>{pct(lang, maxDisc)}</span></div>
        {!ch.poolAllowed && <div className="note mt8">{T('По условиям акции «{n}» скидка из пула не применяется.', { n: promo?.name || '' })}</div>}
        {disc > cap && <div className="note mt8">{T('Скидка сверх {p} — бронь уйдёт на согласование владельцу или руководителю рынка; офис подтвердит её после решения.', { p: pct(lang, cap) })}</div>}
        <div className="grid g2 mt16">
          <div className="card card--sand card--tight"><div className="small muted">{T('Клиент платит застройщику')}</div><div className="big num">{usd(lang, sp.final)}</div><div className="tiny muted">{T('прайс {a} − скидка {d}', { a: usd(lang, list), d: usd(lang, sp.discount) })}</div></div>
          {ext
            ? <div className="card card--tight" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}><div className="small okc">{T('Ваш доход по сделке')}</div><div className="big num okc">{usd(lang, sp.agent)}</div><div className="tiny okc">{T('фикс {f} + остаток вашей части пула {p}', { f: usd(lang, sp.agentFix), p: usd(lang, sp.agentPoolLeft) })}</div></div>
            : showOurs ? <div className="card card--tight" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}><div className="small okc">{T('Наш доход по сделке')}</div><div className="big num okc">{usd(lang, sp.ours)}</div><div className="tiny okc">{T('фикс {f} + пул {p} · продавцу {s}', { f: usd(lang, sp.ourFix), p: usd(lang, sp.ourPool), s: usd(lang, sp.seller) })}</div></div>
              : <div className="card card--tight"><div className="small muted">{T('Скидка')}</div><div className="big num">{pct(lang, disc)}</div></div>}
        </div>
        {plan && <><div className="label mt16">{T('График платежей')}{disc > 0 ? ' · ' + T('с учётом скидки {p}', { p: pct(lang, disc) }) : ''}</div><ScheduleTable plan={plan} price={sp.final} lang={lang} fx={fx} expanded={open} onExpand={() => setOpen(true)} /></>}
        <div className="mt16">
          <div className="kv"><span>{T('Прайс застройщика')}</span><span>{usd(lang, priceList)}</span></div>
          {ch.planAmt > 0 && <div className="kv"><span>{T('Скидка за 100%')}</span><span>−{usd(lang, ch.planAmt)}</span></div>}
          {promo && <div className="kv"><span>{T('Акция «{n}»', { n: promo.name })}</span><span className={ch.promoApplied ? 'okc' : 'muted small'}>{ch.promoApplied ? '−' + usd(lang, ch.promoAmt) : T('не суммируется со скидкой за 100%')}</span></div>}
          {disc > 0 && <div className="kv"><span>{T('Скидка из пула')}</span><span>−{usd(lang, sp.discount)} ({pct(lang, disc)})</span></div>}
          <div className="kv"><span>{T('Итоговая цена')}</span><span>{usd(lang, sp.final)}</span></div>
          {optSum > 0 && <div className="kv"><span>{T('Опции')}</span><span>+{usd(lang, optSum)} · {T('всего {a}', { a: usd(lang, sp.final + optSum) })}</span></div>}
          {ext && <div className="kv"><span>{T('Ваш фикс')}</span><span>{pct(lang, cond.agent_fix_pct)} {T('от итоговой цены')} · {usd(lang, sp.agentFix)}</span></div>}
          {ext && <div className="kv"><span>{T('Ваша часть пула, не отданная клиенту')}</span><span>{pct(lang, Math.max(0, cond.agent_pool_pct - disc))} · {usd(lang, sp.agentPoolLeft)}</span></div>}
          <div className="kv"><span>{T('Срок брони')}</span><span>{T('{a} дней + одно продление на {b}', { a: days, b: ext_days })}</span></div>
          <div className="kv"><span>{T('Выплата')}</span><span>{T('после оплаты застройщиком')}</span></div>
        </div>
      </div>
      <div className="card">
        <label className="field"><span>{T('Клиент (закреплённый за вами)')}</span>
          <select className="in" name="client" value={cid} onChange={(e) => setCid(e.target.value)} required>
            <option value="" disabled>{T('Выберите клиента')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.reg_no}</option>)}
          </select>
        </label>
        {clients.length === 0 && <div className="note mt8">{T('Нет закреплённых клиентов.')} <Link className="bronze" href="/clients/new">{T('Зарегистрировать клиента →')}</Link></div>}
        {pkgs.some((p) => p.client_id === cid) && <label className="field mt8"><span>{T('Пакетом с бронью (один договор)')}</span>
          <select className="in" name="package" defaultValue=""><option value="">{T('нет — отдельная бронь')}</option>{pkgs.filter((p) => p.client_id === cid).map((p) => <option key={p.id} value={p.id}>{p.unit}</option>)}</select>
          <span className="tiny muted">{T('Например, машиноместо или кладовка к квартире: договор по всем броням пакета оформляется разом, комиссия — по каждой квартире.')}</span></label>}
        <input type="hidden" name="unit" value={unitId} />
        {st?.error && <div className="err mt8">{T(st.error)}</div>}
        <div className="mt16"><Submit label={T('Поставить бронь по {p}', { p: usd(lang, sp.final) })} /></div>
        <div className="tiny muted mt8">{T('Цена и условия фиксируются в брони. Офис в Баку подтверждает бронь у застройщика.')}</div>
      </div>
    </form>
  )
}
