// Планы оплаты из каталога (public.payment_plans): «первый взнос + N месяцев» и «100% сразу» со скидкой застройщика.
// Чистые функции — работают и на сервере, и в калькуляторе в браузере.
export type Plan = { id: string; project_id: string; building_id: string | null; name: string; down_payment_pct: number | null; months: number | null
  full_payment_discount_pct: number | null; valid_from: string | null; valid_to: string | null; source_note: string | null; sort: number }

export const isFull = (p: Plan) => Number(p.down_payment_pct ?? 0) >= 100 || !p.months
// Скидка застройщика за полную оплату уменьшает цену до раздела денег: фикс и пул считаются от неё
export const planBase = (p: Plan | null | undefined, list: number) => (p && isFull(p) ? list * (1 - Number(p.full_payment_discount_pct || 0) / 100) : list)
export function schedule(p: Plan, price: number) {
  if (isFull(p)) return { full: true, down: price, monthly: 0, months: 0 }
  const down = price * Number(p.down_payment_pct || 0) / 100
  const months = Number(p.months || 0)
  return { full: false, down, monthly: months ? (price - down) / months : 0, months }
}
export const PLAN_COLS = `id, project_id, building_id, name, down_payment_pct::float, months, full_payment_discount_pct::float, valid_from::text, valid_to::text, source_note, sort`
