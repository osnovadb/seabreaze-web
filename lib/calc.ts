// 2.2 · Калькулятор вариантов (запрос Дениса 10.11): расчёт по квартире с регулировками — первый взнос, срок, скидка из пула,
// дата первого взноса, опции. Рамки — из планов застройщика, если они есть; без планов — свободный расчёт с пометкой «ориентировочно».
// Скидка застройщика за больший взнос — сетка «взнос от X % → скидка N %» (настройка объекта); прежняя «скидка за 100 %» плана — её частный случай.
// Чистые функции: сервер, браузер, юнит-тесты.
import { paymentRows, isFull, type Plan, type Row, type PromoView, type PromoMode } from './plans.ts'
import { split, type SplitCond } from './money.ts'

export type DownStep = { from_pct: number; discount_pct: number; building_id?: string | null; valid_from?: string | null; valid_to?: string | null }
export type CalcIn = {
  list: number                       // прайс квартиры, USD
  plans: Plan[]                      // действующие планы застройщика (могут отсутствовать)
  grid?: DownStep[]                  // сетка скидок за первый взнос
  promo?: PromoView | null; mode?: PromoMode
  planId?: string | null             // от какого плана считаем (по умолчанию — первый)
  downPct: number                    // первый взнос, % от цены для клиента
  months: number                     // срок рассрочки, мес. (0 — без рассрочки)
  disc: number                       // скидка из пула, % от прайса
  start?: string                     // дата первого взноса YYYY-MM-DD
  optionsUsd?: number                // опции сверху цены
  cap?: number                       // порог скидки без согласования
  ceiling?: number                   // предел скидки роли
  cond?: SplitCond | null; ext?: boolean
  today?: string
}
export type CalcOut = {
  plan: Plan | null; approx: boolean          // approx — планов нет, расчёт ориентировочный
  downPct: number; months: number; disc: number
  minDown: number; maxMonths: number | null; fixed: boolean   // рамки плана; fixed — свой график застройщика (этапы)
  devPct: number; devAmt: number; promoAmt: number; promoApplied: boolean; poolAllowed: boolean
  base: number                                // цена после скидки застройщика и акции (от неё делится пул)
  final: number                               // цена квартиры для клиента после скидки из пула
  total: number                               // с опциями
  down: number; monthly: number; last: string | null; rows: Row[]
  needsApproval: boolean; clamped: string[]   // что пришлось подправить под рамки (ключи словаря)
  split: ReturnType<typeof split> | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

// Действующие ступени сетки на дату (и для блока: своя ступень блока главнее общей)
export function activeGrid(grid: DownStep[] = [], today: string, buildingId?: string | null) {
  const live = grid.filter((g) => (!g.valid_from || g.valid_from <= today) && (!g.valid_to || g.valid_to >= today))
  const own = live.filter((g) => buildingId && g.building_id === buildingId)
  return own.length ? own : live.filter((g) => !g.building_id)
}
// Скидка застройщика по взносу: лучшая ступень, до которой взнос дотягивает
export const gridDiscount = (grid: DownStep[], downPct: number) => grid.filter((g) => downPct + 1e-9 >= Number(g.from_pct)).reduce((m, g) => Math.max(m, Number(g.discount_pct) || 0), 0)

export function calcVariant(i: CalcIn): CalcOut {
  const today = i.today || new Date().toISOString().slice(0, 10)
  const plan = i.plans.find((p) => p.id === i.planId) || i.plans[0] || null
  const approx = !plan
  const clamped: string[] = []
  // рамки плана: взнос не меньше минимума, срок не длиннее максимума; «100 %» — только полная оплата
  const full = !!plan && isFull(plan)
  const minDown = full ? 100 : plan ? Number(plan.down_payment_pct || 0) : 0
  const maxMonths = full ? 0 : plan?.months ? Number(plan.months) : null
  let downPct = clamp(Number(i.downPct) || 0, 0, 100)
  if (downPct < minDown) { downPct = minDown; clamped.push('Первый взнос не меньше {p} — по плану застройщика') }
  let months = Math.max(0, Math.round(Number(i.months) || 0))
  if (downPct >= 100) months = 0
  if (maxMonths !== null && months > maxMonths) { months = maxMonths; clamped.push('Срок не длиннее {m} мес. — по плану застройщика') }
  // свой график застройщика (этапы) — только если параметры как в плане
  const fixed = !!plan?.schedule?.some((m) => Number(m.pct) > 0) && downPct === minDown && !i.months
  // скидка застройщика: сетка + «скидка за 100 %» плана полной оплаты
  const g = [...(i.grid || [])]
  for (const p of i.plans) if (isFull(p) && Number(p.full_payment_discount_pct)) g.push({ from_pct: 100, discount_pct: Number(p.full_payment_discount_pct) })
  const devPct = gridDiscount(g, downPct)
  const devAmt = i.list * devPct / 100
  // акция и правило сложения — как в priceChain
  const mode = i.mode || 'chain', promo = i.promo || null
  const promoOf = (from: number) => (!promo ? 0 : promo.kind === 'fixed' ? Math.min(promo.usd, from) : from * promo.pct / 100)
  let dev = devAmt, promoAmt = 0
  if (mode === 'sum') promoAmt = Math.min(promoOf(i.list), i.list - devAmt)
  else if (mode === 'best') { const pa = promoOf(i.list); if (pa > devAmt) { promoAmt = pa; dev = 0 } }
  else promoAmt = promoOf(i.list - devAmt)
  const base = Math.max(0, i.list - dev - promoAmt)
  const poolAllowed = !(mode === 'exclusive' && promoAmt > 0)
  const ceiling = i.ceiling ?? 100
  let disc = clamp(Number(i.disc) || 0, 0, poolAllowed ? ceiling : 0)
  if (disc !== (Number(i.disc) || 0)) clamped.push(poolAllowed ? 'Скидка из пула не больше {c}' : 'По условиям акции скидка из пула не применяется')
  const final = base * (1 - disc / 100)
  const total = final + (i.optionsUsd || 0)
  // график: свой план застройщика (этапы) или «взнос + равные платежи»
  const p: Plan = fixed && plan ? plan : { id: 'calc', project_id: '', building_id: null, name: '', down_payment_pct: downPct, months: months || null, full_payment_discount_pct: null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: null }
  const rows = paymentRows(p, total, i.start ? new Date(i.start + 'T00:00:00Z') : undefined)
  const down = rows.find((r) => r.kind === 'down' || r.kind === 'full')?.amount ?? 0
  const monthly = rows.find((r) => r.kind === 'month')?.amount ?? 0
  const last = rows.length ? rows[rows.length - 1].due : null
  return {
    plan, approx, downPct, months, disc, minDown, maxMonths, fixed,
    devPct: dev ? devPct : 0, devAmt: r2(dev), promoAmt: r2(promoAmt), promoApplied: promoAmt > 0, poolAllowed,
    base: r2(base), final: r2(final), total: r2(total), down, monthly, last, rows,
    needsApproval: disc > (i.cap ?? Infinity) + 1e-9, clamped,
    split: i.cond ? split(i.cond, base, disc, i.ext !== false) : null,
  }
}

// Начальные параметры от плана: его взнос и срок
export function fromPlan(p: Plan | null | undefined) {
  if (!p) return { downPct: 30, months: 24 }
  if (isFull(p)) return { downPct: 100, months: 0 }
  return { downPct: Number(p.down_payment_pct || 0), months: Number(p.months || 0) }
}
