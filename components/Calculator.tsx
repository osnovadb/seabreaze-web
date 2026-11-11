'use client'
import { useState } from 'react'
import { paymentRows, priceChain, isFull, termUnknown, hasSchedule, planLabel, type Plan, type Row, type PromoView, type PromoMode } from '@/lib/plans'
import { t, usd, pct, num, date, type Lang } from '@/lib/i18n'
import type { Opt } from '@/lib/options'

// Курс для справочной колонки в валюте рынка (lib/fx.ts на сервере)
export type FxView = { cur: 'EUR' | 'ILS'; perUsd: number; date: string } | null
const SIGN = { EUR: '€', ILS: '₪' } as const
const money = (lang: Lang, fx: NonNullable<FxView>, n: number) => SIGN[fx.cur] + num(lang, Math.round(n * fx.perUsd))
const SHOW = 3 // на экране — первые платежи и последний, остальное по кнопке; в печати — все

function rowLabel(T: (s: string, v?: Record<string, string | number>) => string, r: Row, hasDown: boolean) {
  if (r.kind === 'full') return T('Полная оплата')
  if (r.kind === 'down') return T('Первый взнос')
  if (r.kind === 'rest') return T('Остаток — по графику застройщика')
  return r.label ? planLabel(T, r.label) : T('Платёж {n}', { n: r.n - (hasDown ? 1 : 0) })
}

// Таблица графика: без состояния, поэтому годится и для подборки на сервере
export function ScheduleTable({ plan, price, lang, fx, start, expanded, onExpand, rows: given }: {
  plan?: Plan; price: number; lang: Lang; fx: FxView; start?: string; expanded?: boolean; onExpand?: () => void; rows?: Row[]
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  // rows — уже посчитанный график (калькулятор вариантов); иначе — по плану
  const rows = given || paymentRows(plan!, price, start ? new Date(start + 'T00:00:00Z') : undefined)
  const hidden = rows.length > SHOW + 2 && !expanded ? rows.length - SHOW - 1 : 0
  return (
    <div className="tbl-wrap mt8">
      <table className="tbl tbl--keep sched">
        <thead><tr><th>{T('Платёж')}</th><th>{T('Дата')}</th><th style={{ textAlign: 'end' }}>USD</th>{fx && <th style={{ textAlign: 'end' }}>≈ {fx.cur}</th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const more = hidden > 0 && i >= SHOW && i < rows.length - 1
            return (
              <tr key={r.n} className={more ? 'sched-more' : undefined}>
                <td>{rowLabel(T, r, rows[0]?.kind === 'down')}</td>
                <td className="small">{r.due ? date(lang, r.due) : '—'}</td>
                <td className="num" style={{ textAlign: 'end' }}>{usd(lang, r.amount)}</td>
                {fx && <td className="num small muted" style={{ textAlign: 'end' }}>{money(lang, fx, r.amount)}</td>}
              </tr>
            )
          })}
          {hidden > 0 && (
            <tr className="noprint sched-toggle"><td colSpan={fx ? 4 : 3}>{onExpand
              ? <button type="button" className="btn btn--sm" onClick={onExpand}>{T('Показать весь график (платежей: {n})', { n: rows.length })}</button>
              : <span className="small muted">{T('… и ещё платежей: {n}, по {x}', { n: hidden, x: usd(lang, rows[SHOW].amount) })}</span>}</td></tr>
          )}
          <tr><td><b>{T('Итого')}</b></td><td /><td className="num" style={{ textAlign: 'end' }}><b>{usd(lang, rows.reduce((a, r) => a + r.amount, 0))}</b></td>{fx && <td className="num small muted" style={{ textAlign: 'end' }}>{money(lang, fx, price)}</td>}</tr>
        </tbody>
      </table>
    </div>
  )
}

// Калькулятор (М7): выбор плана, дата первого взноса, график по датам и пересчёт в валюту рынка.
// price — прайс в USD; скидка за 100% применяется здесь, персональная скидка — только в брони (discountPct).
export function Calculator({ plans, price, lang, fx, discountPct = 0, initialPlan, title, note = true, promo, mode = 'chain', options = [] }: { // discountPct — персональная скидка, если цена передана без неё
  plans: Plan[]; price: number; lang: Lang; fx: FxView; discountPct?: number; initialPlan?: string; title?: string; note?: boolean; promo?: PromoView | null; mode?: PromoMode; options?: Opt[]
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [planId, setPlanId] = useState(initialPlan && plans.some((p) => p.id === initialPlan) ? initialPlan : plans[0]?.id)
  const [start, setStart] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(new Date()))
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const plan = plans.find((p) => p.id === planId)
  if (!plans.length || !plan) return null
  // Опции — сверху цены квартиры, без скидок застройщика и пула
  const optSum = options.filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.usd, 0)
  const ch = priceChain(price, plan, promo, mode), base = ch.base, total = base * (1 - discountPct / 100) + optSum
  return (
    <div className="card">
      <div className="h3">{title ?? T('Калькулятор и график платежей')}</div>
      <div className="chips mt8 noprint">{plans.map((p) => <button type="button" key={p.id} className={'chip' + (p.id === planId ? ' on' : '')} onClick={() => { setPlanId(p.id); setOpen(false) }}>{planLabel(T, p.name, p)}</button>)}</div>
      <div className="small muted mt8">
        {isFull(plan)
          ? (ch.planAmt > 0 ? T('Скидка застройщика за 100%: {p} — цена {a}', { p: pct(lang, Number(plan.full_payment_discount_pct)), a: usd(lang, base) }) : T('Полная оплата'))
          : termUnknown(plan) ? T('Первый взнос {p}; срок и платежи — по графику застройщика', { p: pct(lang, Number(plan.down_payment_pct)) })
            : hasSchedule(plan) ? T('Первый взнос {p}, затем этапы по графику застройщика: {n}', { p: pct(lang, Number(plan.down_payment_pct)), n: plan.schedule!.filter((m) => Number(m.pct) > 0).length })
            : T('Первый взнос {p}, затем ежемесячные платежи: {m}', { p: pct(lang, Number(plan.down_payment_pct)), m: plan.months || 0 })}
        {discountPct ? ' · ' + T('с учётом скидки {p}', { p: pct(lang, discountPct) }) : ''}
      </div>
      {plan.source_note && <div className="tiny muted mt8">{T(plan.source_note)}</div>}
      {promo && <div className="kv mt8"><span>{T('Акция «{n}»', { n: promo.name })}{promo.ends_on ? <div className="tiny muted">{T('до {d}', { d: date(lang, promo.ends_on) })}</div> : null}</span><span className={ch.promoApplied ? 'okc' : 'muted small'}>{ch.promoApplied ? '−' + usd(lang, ch.promoAmt) : T('не суммируется со скидкой за 100%')}</span></div>}
      {options.length > 0 && <div className="mt8 noprint">{options.map((o) => (
        <label key={o.id} className="kv check" style={{ cursor: 'pointer' }}><span><input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked((a) => (e.target.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))} /> {o.title}{o.note ? <div className="tiny muted">{o.note}</div> : null}</span>
          <span className="small">+{usd(lang, o.usd)}{o.currency !== 'USD' ? <div className="tiny muted">{o.currency} {num(lang, o.price)}</div> : null}</span></label>))}</div>}
      {optSum > 0 && <div className="small muted">{T('С опциями: +{a}', { a: usd(lang, optSum) })}</div>}
      <label className="field mt16 noprint" style={{ maxWidth: 220 }}><span>{T('Дата первого взноса')}</span>
        <input className="in" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></label>
      <ScheduleTable plan={plan} price={total} lang={lang} fx={fx} start={start} expanded={open} onExpand={() => setOpen(true)} />
      {note && <div className="tiny muted mt8">{T('Даты — ориентир от первого взноса; точный график — в договоре с застройщиком.')}{fx ? ' ' + T('{c} — справочно, по курсу ЦБ Азербайджана на {d}.', { c: fx.cur, d: date(lang, fx.date) }) : ''}</div>}
    </div>
  )
}
