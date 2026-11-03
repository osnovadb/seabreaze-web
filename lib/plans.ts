// Планы оплаты из каталога (public.payment_plans): «первый взнос + N месяцев» и «100% сразу» со скидкой застройщика.
// Чистые функции — работают и на сервере, и в калькуляторе в браузере.
export type Plan = { id: string; project_id: string; building_id: string | null; name: string; down_payment_pct: number | null; months: number | null
  full_payment_discount_pct: number | null; valid_from: string | null; valid_to: string | null; source_note: string | null; sort: number
  schedule?: Milestone[] | null }
// Свой график застройщика вместо равных платежей: доля цены и через сколько месяцев от первого взноса
export type Milestone = { label?: string; pct: number; after_months: number }

// 100% — только явная полная оплата; взнос без срока («срок уточнить») — рассрочка с неизвестным графиком
export const isFull = (p: Plan) => Number(p.down_payment_pct ?? 0) >= 100
export const termUnknown = (p: Plan) => !isFull(p) && !p.months && !p.schedule?.length
// Скидка застройщика за полную оплату уменьшает цену до раздела денег: фикс и пул считаются от неё
export const planBase = (p: Plan | null | undefined, list: number) => (p && isFull(p) ? list * (1 - Number(p.full_payment_discount_pct || 0) / 100) : list)
export function schedule(p: Plan, price: number) {
  if (isFull(p)) return { full: true, down: price, monthly: 0, months: 0 }
  const down = price * Number(p.down_payment_pct || 0) / 100
  const months = Number(p.months || 0)
  return { full: false, down, monthly: months ? (price - down) / months : 0, months }
}
export const PLAN_COLS = `id, project_id, building_id, name, down_payment_pct::float, months, full_payment_discount_pct::float, valid_from::text, valid_to::text, source_note, sort, schedule`

// График платежей по датам (М7). Суммы — в целых единицах валюты, остаток округления уходит в последний платёж,
// поэтому сумма строк всегда равна цене. start — дата первого взноса (по умолчанию сегодня), дальше платёж раз в месяц.
export type Row = { n: number; kind: 'full' | 'down' | 'month' | 'step' | 'rest'; label?: string; due: string | null; amount: number }
export function paymentRows(p: Plan, price: number, start: Date = new Date()): Row[] {
  const total = Math.round(price)
  const at = (m: number) => { const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1)); d.setUTCDate(Math.min(start.getUTCDate(), daysIn(d))); return d.toISOString().slice(0, 10) }
  if (isFull(p)) return [{ n: 1, kind: 'full', due: at(0), amount: total }]
  const down = Math.round(total * Number(p.down_payment_pct || 0) / 100)
  const rows: Row[] = [{ n: 1, kind: 'down', due: at(0), amount: down }]
  const ms = (p.schedule || []).filter((m) => Number(m.pct) > 0)
  if (ms.length) {
    ms.forEach((m) => rows.push({ n: rows.length + 1, kind: 'step', label: m.label, due: at(Number(m.after_months) || 0), amount: Math.round(total * Number(m.pct) / 100) }))
  } else if (p.months) {
    const each = Math.floor((total - down) / p.months)
    for (let i = 1; i <= p.months; i++) rows.push({ n: i + 1, kind: 'month', due: at(i), amount: each })
  } else {
    rows.push({ n: 2, kind: 'rest', due: null, amount: total - down })
  }
  // остаток округления — в последний платёж
  const sum = rows.reduce((a, r) => a + r.amount, 0)
  rows[rows.length - 1].amount += total - sum
  return rows
}
const daysIn = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()

// Акция застройщика и правило сложения (М6). Скидка за 100% и акция уменьшают цену до раздела денег —
// от получившейся базы считаются фикс и пул, как раньше от planBase. Фиксированная акция — в USD уже на квартире.
export type PromoMode = 'chain' | 'sum' | 'best' | 'exclusive'
export type PromoView = { id: string; name: string; badge: string | null; kind: 'pct' | 'fixed'; pct: number; usd: number; ends_on: string | null }
export function priceChain(list: number, plan: Plan | null | undefined, promo: PromoView | null | undefined, mode: PromoMode = 'chain') {
  const planPct = plan && isFull(plan) ? Number(plan.full_payment_discount_pct || 0) : 0
  const planAmt0 = list * planPct / 100
  const promoOf = (from: number) => (!promo ? 0 : promo.kind === 'fixed' ? Math.min(promo.usd, from) : from * promo.pct / 100)
  let planAmt = planAmt0, promoAmt = 0
  if (mode === 'sum') promoAmt = promoOf(list)
  else if (mode === 'best') { const pa = promoOf(list); if (pa > planAmt0) { promoAmt = pa; planAmt = 0 } }
  else promoAmt = promoOf(list - planAmt0)
  const base = Math.max(0, list - planAmt - promoAmt)
  return { list, planPct, planAmt, promoAmt, base, promoApplied: promoAmt > 0, poolAllowed: !(mode === 'exclusive' && promoAmt > 0) }
}
