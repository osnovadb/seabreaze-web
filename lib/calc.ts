// 2.2 · Калькулятор вариантов (запрос Дениса 10.11): расчёт по квартире с регулировками — первый взнос, срок, скидка из пула,
// дата первого взноса, опции. Рамки — из планов застройщика, если они есть; без планов — свободный расчёт с пометкой «ориентировочно».
// 361 (Денис 11.11): по договорам застройщик отдельной скидки за взнос не даёт. Сетка «взнос от X % и срок до N мес. → скидка» (Приложение 1)
// и «скидка за 100 %» плана — это максимум скидки (пул плана), которым распоряжаемся мы; клиенту автоматически ничего не вычитается.
// Цена клиента = прайс (после акции застройщика) минус скидка в пределах пула плана и порога роли; опции сверху.
// Чистые функции: сервер, браузер, юнит-тесты.
import { paymentRows, isFull, type Plan, type Row, type PromoView, type PromoMode } from './plans.ts'
import { split, planCond, type SplitCond } from './money.ts'

export type DownStep = { from_pct: number; discount_pct: number; max_months?: number | null; building_id?: string | null; valid_from?: string | null; valid_to?: string | null }
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
  poolPct?: number                   // пул проекта (conditions.pool_pct), если сетка не задана; по умолчанию — из cond
  askMax?: number                    // партнёр «Попросить больше»: запрос сверх своей части — до этого нейтрального предела
  today?: string
}
export type CalcOut = {
  plan: Plan | null; approx: boolean          // approx — планов нет, расчёт ориентировочный
  downPct: number; months: number; disc: number
  minDown: number; maxMonths: number | null; fixed: boolean   // рамки плана; fixed — свой график застройщика (этапы)
  devPct: number; devAmt: number; promoAmt: number; promoApplied: boolean; poolAllowed: boolean  // devPct/devAmt — всегда 0 (вычета за взнос нет, 361)
  poolPct: number; poolSource: 'grid' | 'plan' | 'pool'   // максимум скидки по плану и откуда он взят
  capEff: number; ceilingEff: number                       // порог без согласования и предел скидки — в пределах пула плана
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
// Скидка по взносу (без учёта срока) — лучшая ступень, до которой взнос дотягивает; для подсказок
export const gridDiscount = (grid: DownStep[], downPct: number) => grid.filter((g) => downPct + 1e-9 >= Number(g.from_pct)).reduce((m, g) => Math.max(m, Number(g.discount_pct) || 0), 0)

// Пул плана (361): строка сетки — наибольший взнос не выше фактического и ближайший срок не короче выбранного;
// полная оплата — «скидка за 100 %» плана полной оплаты (или строка сетки от 100 %); сетки нет или строка не нашлась — пул проекта
export function planPool(o: { grid?: DownStep[]; plans?: Plan[]; poolPct: number; downPct: number; months: number }): { pct: number; source: 'grid' | 'plan' | 'pool' } {
  const full = o.downPct >= 100 - 1e-9
  if (full) {
    const fp = (o.plans || []).find((p) => isFull(p) && Number(p.full_payment_discount_pct) > 0)
    if (fp) return { pct: Number(fp.full_payment_discount_pct), source: 'plan' }
  }
  const rows = (o.grid || []).filter((g) => o.downPct + 1e-9 >= Number(g.from_pct) && (full || g.max_months == null || Number(g.max_months) >= o.months))
  if (rows.length) {
    const top = Math.max(...rows.map((g) => Number(g.from_pct)))
    const best = rows.filter((g) => Number(g.from_pct) === top).sort((a, b) => (a.max_months ?? 1e9) - (b.max_months ?? 1e9))[0]
    return { pct: Number(best.discount_pct) || 0, source: 'grid' }
  }
  return { pct: Number(o.poolPct) || 0, source: 'pool' }
}

export const MAX_FREE_MONTHS = 120
// Какой план застройщика подходит под взнос и срок: 100 % — полная оплата; иначе рассрочка, в рамки которой укладываемся
// (взнос не меньше её минимума, срок не длиннее максимума); не укладываемся ни в одну — ближайшая (меньший минимум, длиннее срок), её рамки подправят ввод
export function pickPlan(plans: Plan[], downPct: number, months: number, preferId?: string | null): Plan | null {
  if (!plans.length) return null
  const fullP = plans.find(isFull)
  const inst = plans.filter((p) => !isFull(p))
  if (downPct >= 100 && fullP) return fullP
  if (!inst.length) return fullP || null
  const fits = (p: Plan) => downPct + 1e-9 >= Number(p.down_payment_pct || 0) && (!p.months || months <= Number(p.months))
  const ok = inst.filter(fits)
  if (ok.length) return ok.find((p) => p.id === preferId) || ok[0]
  return [...inst].sort((a, b) => Number(a.down_payment_pct || 0) - Number(b.down_payment_pct || 0) || Number(b.months || 9999) - Number(a.months || 9999))[0]
}

export function calcVariant(i: CalcIn): CalcOut {
  const today = i.today || new Date().toISOString().slice(0, 10)
  const clamped: string[] = []
  const reqDown = clamp(Number(i.downPct) || 0, 0, 100)
  const reqMonths = Math.max(0, Math.round(Number(i.months) || 0))
  // QA 10.11: план выбирается сам по взносу и сроку (60 % / 12 мес. — это план «30 % / 24», а не ошибка); 100 % — план полной оплаты
  const plan = pickPlan(i.plans, reqDown, reqMonths, i.planId)
  const full = !!plan && isFull(plan)
  const minDown = full ? 100 : plan ? Number(plan.down_payment_pct || 0) : 0
  // срок: максимум плана; без плана или у плана без срока — до 120 мес. (QA: в поле можно было ввести 200)
  const maxMonths = full ? 0 : plan?.months ? Number(plan.months) : MAX_FREE_MONTHS
  let downPct = reqDown
  if (downPct < minDown) { downPct = minDown; clamped.push('Первый взнос не меньше {p} — по плану застройщика') }
  let months = reqMonths
  if (downPct >= 100) months = 0
  if (months > maxMonths) { months = maxMonths; clamped.push(plan?.months ? 'Срок не длиннее {m} мес. — по плану застройщика' : 'Срок не длиннее {m} мес.') }
  // ориентировочно: планов нет или у плана застройщика срок не задан, а срок выбран
  const approx = !plan || (!full && !plan.months && !plan.schedule?.length && months > 0)
  // свой график застройщика (этапы) — только если параметры как в плане
  const fixed = !!plan?.schedule?.some((m) => Number(m.pct) > 0) && downPct === minDown && !i.months
  // 361: пул плана — максимум скидки по выбранному взносу и сроку; автоматически из цены ничего не вычитаем
  const pool = planPool({ grid: i.grid, plans: i.plans, poolPct: i.poolPct ?? Number(i.cond?.pool_pct ?? 0), downPct, months })
  // акция застройщика (его собственная скидка из прайса) — как в priceChain
  const mode = i.mode || 'chain', promo = i.promo || null
  const promoAmt = !promo ? 0 : promo.kind === 'fixed' ? Math.min(promo.usd, i.list) : i.list * promo.pct / 100
  const base = Math.max(0, i.list - promoAmt)
  const poolAllowed = !(mode === 'exclusive' && promoAmt > 0)
  // пороги ролей прежние, но не выше пула плана; у партнёра своя часть — его доля пула плана (349, 373)
  const agentPart = i.cond ? planCond(i.cond, pool.pct).agent_pool_pct : Math.min(i.cap ?? 0, pool.pct)
  const capEff = i.ext ? agentPart : Math.min(i.cap ?? Infinity, pool.pct)
  // партнёру предел — своя часть; запрос «Попросить больше» (askMax) — до нейтрального предела, отказ — за руководителем рынка
  const ceilingEff = i.ext ? (i.askMax ?? capEff) : Math.min(i.ceiling ?? 100, pool.pct)
  let disc = clamp(Number(i.disc) || 0, 0, poolAllowed ? ceilingEff : 0)
  if (disc !== (Number(i.disc) || 0)) clamped.push(poolAllowed ? 'Скидка не больше {c} — максимум по плану и вашему порогу' : 'По условиям акции скидка из пула не применяется')
  const final = Math.max(0, base - i.list * disc / 100) // ревью 11.11: скидка в % — от прайса, как в договорах
  const total = final + (i.optionsUsd || 0)
  // график: свой план застройщика (этапы) или «взнос + равные платежи»
  const p: Plan = fixed && plan ? plan : { id: 'calc', project_id: '', building_id: null, name: '', down_payment_pct: downPct, months: months || null, full_payment_discount_pct: null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: null }
  const rows = paymentRows(p, total, i.start ? new Date(i.start + 'T00:00:00Z') : undefined)
  const down = rows.find((r) => r.kind === 'down' || r.kind === 'full')?.amount ?? 0
  const monthly = rows.find((r) => r.kind === 'month')?.amount ?? 0
  const last = rows.length ? rows[rows.length - 1].due : null
  return {
    plan, approx, downPct, months, disc, minDown, maxMonths, fixed,
    devPct: 0, devAmt: 0, promoAmt: r2(promoAmt), promoApplied: promoAmt > 0, poolAllowed,
    poolPct: pool.pct, poolSource: pool.source, capEff, ceilingEff,
    base: r2(base), final: r2(final), total: r2(total), down, monthly, last, rows,
    needsApproval: disc > capEff + 1e-9, clamped,
    split: i.cond ? split(planCond(i.cond, pool.pct), base, disc, i.ext !== false, i.list) : null,
  }
}

// Начальные параметры от плана: его взнос и срок
export const startPlan = (plans: Plan[]) => plans.find((p) => !isFull(p)) || plans[0] || null
export function fromPlan(p: Plan | null | undefined) {
  if (!p) return { downPct: 30, months: 24 }
  if (isFull(p)) return { downPct: 100, months: 0 }
  return { downPct: Number(p.down_payment_pct || 0), months: Number(p.months || 0) }
}
