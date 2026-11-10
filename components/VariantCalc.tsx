'use client'
// 2.2 · Калькулятор вариантов (запрос Дениса 10.11), этап 1: расчёт по квартире с регулировками.
// Первый взнос (процент и сумма), срок, скидка из пула, дата первого взноса, опции → цена для клиента, взнос, платёж в месяц,
// последний платёж, график и справочно € / ₪. Рамки — из плана застройщика; без планов — свободно, с пометкой «ориентировочно».
// «Для себя» (доход партнёра / наш) — свёрнуто, чтобы не показывать клиенту с экрана.
import { useMemo, useState } from 'react'
import { calcVariant, fromPlan, startPlan, MAX_FREE_MONTHS, type DownStep } from '@/lib/calc'
import { planLabel, type Plan, type PromoView, type PromoMode } from '@/lib/plans'
import type { SplitCond } from '@/lib/money'
import type { Opt } from '@/lib/options'
import { t, usd, pct, num, date, type Lang } from '@/lib/i18n'
import { ScheduleTable, type FxView } from './Calculator'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(new Date())
const SIGN = { EUR: '€', ILS: '₪' } as const

export function VariantCalc({ list, plans, grid = [], promo, mode = 'chain', options = [], fx, lang, cond = null, ext = true, cap = 0, ceiling = 0, self = null, title, client = false }: {
  list: number; plans: Plan[]; grid?: DownStep[]; promo?: PromoView | null; mode?: PromoMode; options?: Opt[]; fx: FxView; lang: Lang
  cond?: SplitCond | null; ext?: boolean; cap?: number; ceiling?: number; self?: 'agent' | 'ours' | 'seller' | null; title?: string; client?: boolean
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  // старт — с плана рассрочки (QA: открывался на «100% сразу»); дальше план выбирается сам по взносу и сроку, чип — только подсказка-пресет
  const first = startPlan(plans)
  const init = fromPlan(first)
  const [planId, setPlanId] = useState<string | null>(first?.id || null)
  const [amt, setAmt] = useState<string | null>(null) // сумма взноса, пока её вводят руками
  const [pctS, setPctS] = useState<string | null>(null) // процент взноса, пока его вводят (рамки применяются после ввода)
  const [downPct, setDownPct] = useState(init.downPct)
  const [months, setMonths] = useState(init.months)
  const [disc, setDisc] = useState(0)
  const [start, setStart] = useState(today)
  const [picked, setPicked] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const optionsUsd = options.filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.usd, 0)
  const r = useMemo(() => calcVariant({ list, plans, grid, promo, mode, planId, downPct, months, disc, start, optionsUsd, cap, ceiling, cond, ext }),
    [list, plans, grid, promo, mode, planId, downPct, months, disc, start, optionsUsd, cap, ceiling, cond, ext])
  const pickPlan = (p: Plan | null) => { setPlanId(p?.id || null); const v = fromPlan(p); setDownPct(v.downPct); setMonths(v.months); setOpen(false) }
  const maxM = r.maxMonths ?? MAX_FREE_MONTHS
  const fxs = (n: number) => (fx ? SIGN[fx.cur] + num(lang, Math.round(n * fx.perUsd)) : '')
  // ступени сетки — подсказка «ещё N % взноса — скидка M %»
  const next = grid.filter((g) => g.from_pct > r.downPct).sort((a, b) => a.from_pct - b.from_pct)[0]
  return (
    <div className="card stack vcalc" style={{ gap: 12 }}>
      <div className="h3" style={{ margin: 0 }}>{title ?? T(client ? 'Рассрочка и платежи' : 'Калькулятор вариантов')}</div>
      {plans.length > 0 && <div className="chips noprint">{plans.map((p) => <button type="button" key={p.id} className={'chip' + (p.id === r.plan?.id ? ' on' : '')} onClick={() => pickPlan(p)}>{planLabel(T, p.name)}</button>)}</div>}
      {r.approx && <div className="note small">{T(r.plan ? 'Срок рассрочки у застройщика не задан — расчёт ориентировочный.' : 'Условия рассрочки у застройщика не заданы — расчёт ориентировочный.')}</div>}
      <div className="vcalc__ctrls noprint">
        <label className="field"><span>{T('Первый взнос')} · <b>{pct(lang, r.downPct)}</b>{r.minDown > 0 && r.minDown < 100 ? <span className="tiny muted"> · {T('мин. {p}', { p: pct(lang, r.minDown) })}</span> : null}</span>
          <input type="range" className="disc" min={0} max={100} step={1} value={r.downPct} onChange={(e) => { setAmt(null); setDownPct(Number(e.target.value)) }} />
          <span className="row" style={{ gap: 6 }}>
            <input className="in in--sm" inputMode="decimal" value={pctS ?? String(Math.round(r.downPct * 10) / 10)} onFocus={() => setPctS(String(Math.round(r.downPct * 10) / 10))} onBlur={() => setPctS(null)} onChange={(e) => { setAmt(null); setPctS(e.target.value); setDownPct(Number(e.target.value.replace(',', '.')) || 0) }} style={{ width: 70 }} aria-label="%" /><span className="small">%</span>
            <input className="in in--sm" inputMode="decimal" value={amt ?? String(r.down)} onFocus={() => setAmt(String(r.down))} onBlur={() => setAmt(null)} onChange={(e) => { const t0 = e.target.value.replace(/[^\d]/g, ''); setAmt(t0); const v = Number(t0) || 0; setDownPct(r.total ? Math.min(100, (v / r.total) * 100) : 0) }} style={{ width: 120 }} aria-label="USD" /><span className="small">USD</span>
          </span></label>
        <label className="field"><span>{T('Срок рассрочки')} · <b>{r.months ? T('{m} мес.', { m: r.months }) : T('без рассрочки')}</b>{r.maxMonths ? <span className="tiny muted"> · {T('макс. {m} мес.', { m: r.maxMonths })}</span> : null}</span>
          <input type="range" className="disc" min={0} max={maxM} step={1} value={Math.min(r.months, maxM)} disabled={r.downPct >= 100} onChange={(e) => setMonths(Number(e.target.value))} />
          <span className="row" style={{ gap: 6 }}><input className="in in--sm" type="number" min={0} max={maxM} value={r.months} disabled={r.downPct >= 100} onChange={(e) => setMonths(Math.min(maxM, Number(e.target.value) || 0))} style={{ width: 70 }} /><span className="small">{T('мес.')}</span></span></label>
        {ceiling > 0 && r.poolAllowed && <label className="field"><span>{ext ? T('Скидка клиенту из вашей части пула') : T('Скидка клиенту')} · <b>{pct(lang, r.disc)}</b></span>
          <input type="range" className="disc" min={0} max={ceiling} step={0.5} value={Math.min(disc, ceiling)} onChange={(e) => setDisc(Number(e.target.value))} />
          <span className="between tiny muted"><span>0%</span>{cap < ceiling && <span>{T('без согласования до {p}', { p: pct(lang, cap) })}</span>}<span>{pct(lang, ceiling)}</span></span></label>}
        <label className="field"><span>{T('Дата первого взноса')}</span><input className="in" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} style={{ maxWidth: 200 }} /></label>
      </div>
      {options.length > 0 && <div className="noprint">{options.map((o) => (
        <label key={o.id} className="kv check" style={{ cursor: 'pointer' }}><span><input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked((a) => (e.target.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))} /> {o.title}</span><span className="small">+{usd(lang, o.usd)}</span></label>))}</div>}
      {r.clamped.map((k) => <div key={k} className="tiny warnc">{T(k, { p: pct(lang, r.minDown), m: r.maxMonths ?? 0, c: pct(lang, ceiling) })}</div>)}
      {r.needsApproval && <div className="note small">{T('Скидка сверх {p} — вариант требует согласования владельца или руководителя рынка', { p: pct(lang, cap) })}</div>}
      <div className="vcalc__kpis">
        {[[T(client ? 'Цена' : 'Цена для клиента'), usd(lang, r.total), fx ? '≈ ' + fxs(r.total) : ''],
          [T('Первый взнос'), usd(lang, r.down), pct(lang, r.downPct)],
          [T('Платёж в месяц'), r.monthly ? usd(lang, r.monthly) : '—', r.months ? T('{m} мес.', { m: r.months }) : r.fixed ? T('по этапам застройщика') : ''],
          [T('Последний платёж'), r.last ? date(lang, r.last) : '—', '']].map(([a, b, c]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v" style={{ fontSize: 20 }}>{b}</div><div className="tiny muted">{c}</div></div>)}
      </div>
      <div className="small">
        <div className="kv"><span>{T('Прайс застройщика')}</span><span>{usd(lang, list)}</span></div>
        {r.devAmt > 0 && <div className="kv"><span>{T('Скидка застройщика за взнос {p}', { p: pct(lang, r.downPct) })}</span><span>−{usd(lang, r.devAmt)} ({pct(lang, r.devPct)})</span></div>}
        {promo && <div className="kv"><span>{T('Акция «{n}»', { n: promo.name })}</span><span className={r.promoApplied ? 'okc' : 'muted small'}>{r.promoApplied ? '−' + usd(lang, r.promoAmt) : T('не суммируется')}</span></div>}
        {r.disc > 0 && <div className="kv"><span>{T('Скидка из пула')}</span><span>−{usd(lang, r.base - r.final)} ({pct(lang, r.disc)})</span></div>}
        {optionsUsd > 0 && <div className="kv"><span>{T('Опции')}</span><span>+{usd(lang, optionsUsd)}</span></div>}
        {next && <div className="tiny bronze mt8">{T('Взнос от {f} — скидка застройщика {d}', { f: pct(lang, next.from_pct), d: pct(lang, next.discount_pct) })}</div>}
      </div>
      <ScheduleTable rows={r.rows} price={r.total} lang={lang} fx={fx} expanded={open} onExpand={() => setOpen(true)} />
      {self && r.split && <details className="noprint"><summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Для себя')}</summary>
        <div className="kv mt8"><span>{self === 'agent' ? T('Ваш доход по сделке') : self === 'seller' ? T('Ваш бонус по сделке') : T('Наш доход по сделке')}</span><b className="okc">{usd(lang, self === 'agent' ? r.split.agent : self === 'seller' ? r.split.seller : r.split.ours)}</b></div>
        {self === 'seller' && <div className="tiny muted">{T('{p} от нашей части — до вычета прочих долей по сделке', { p: pct(lang, cond?.seller_share_pct || 0) })}</div>}
        {self === 'agent' && <div className="tiny muted">{T('Фикс {f} от итоговой цены + остаток вашей части пула после скидки', { f: pct(lang, cond?.agent_fix_pct || 0) })}</div>}</details>}
      <div className="tiny muted">{T('Даты — ориентир от первого взноса; точный график — в договоре с застройщиком.')}{fx ? ' ' + T('{c} — справочно, по курсу ЦБ Азербайджана на {d}.', { c: fx.cur, d: date(lang, fx.date) }) : ''}</div>
    </div>
  )
}
