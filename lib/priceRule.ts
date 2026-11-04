// Прайс-лист (группа 4): правило отбора квартир и правило новой цены. Чистый расчёт без базы — его же показывает предпросмотр.
// Как у Profitbase: черновик → предпросмотр «было → стало» → публикация; отличие — откат одной кнопкой и защита от гонки
// (квартира, чья цена успела измениться после расчёта, при публикации пропускается).
import { riser } from './catalog'

export type PriceOp = 'pct' | 'add' | 'set' | 'm2' | 'floor_step'
export type PriceRule = {
  buildings: string[]; types: string[]; rooms: number[]; layouts: string[]; risers: string[]; units: string[]
  floor_from: number | null; floor_to: number | null; statuses: string[]
  op: PriceOp; value: number; base_floor: number | null; round: number; currency: string | null
}
export const OPS: [PriceOp, string][] = [
  ['pct', 'Изменить на %'], ['add', 'Прибавить сумму'], ['set', 'Установить цену'], ['m2', 'Установить цену за м²'], ['floor_step', '% за каждый этаж выше базового'],
]
export const ROUNDS = [1, 10, 100, 1000]

export type RuleUnit = { id: string; building_id: string; unit_type: string; rooms: number | null; layout_id: string | null; number: string; floor: number; status: string; price: number | null; currency: string; area: number }

const nums = (v: unknown) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n))
const strs = (v: unknown) => (Array.isArray(v) ? v : []).map(String).map((x) => x.trim()).filter(Boolean)
const n = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))

export function normRule(r: Record<string, unknown> = {}): PriceRule {
  const op = OPS.some(([k]) => k === r.op) ? (r.op as PriceOp) : 'pct'
  const st = strs(r.statuses)
  return {
    buildings: strs(r.buildings), types: strs(r.types), rooms: nums(r.rooms), layouts: strs(r.layouts), risers: strs(r.risers), units: strs(r.units),
    floor_from: n(r.floor_from), floor_to: n(r.floor_to), statuses: st.length ? st : ['available'],
    op, value: n(r.value) ?? 0, base_floor: n(r.base_floor), round: ROUNDS.includes(Number(r.round)) ? Number(r.round) : 100,
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
  }
}

// Что не так с правилом — до расчёта (пустая строка — всё в порядке)
export function ruleError(r: PriceRule): string {
  if (!r.value && r.op !== 'pct') return 'Укажите значение'
  if (r.op === 'pct' && (r.value === 0 || Math.abs(r.value) > 50)) return 'Процент — от −50 до 50, не ноль'
  if (r.op === 'floor_step' && (r.base_floor == null || r.value === 0 || Math.abs(r.value) > 10)) return 'Для шага по этажам нужны базовый этаж и шаг от −10 до 10 %'
  if (['set', 'm2'].includes(r.op) && r.value <= 0) return 'Цена должна быть больше нуля'
  if (['add', 'set', 'm2'].includes(r.op) && !r.currency) return 'Укажите валюту суммы'
  if (r.floor_from != null && r.floor_to != null && r.floor_to < r.floor_from) return 'Этажи: «по» меньше, чем «с»'
  return ''
}

export const matches = (u: RuleUnit, r: PriceRule) =>
  (!r.units.length || r.units.includes(u.id)) &&
  (!r.buildings.length || r.buildings.includes(u.building_id)) &&
  (!r.types.length || r.types.includes(u.unit_type)) &&
  (!r.rooms.length || r.rooms.some((x) => (x >= 4 ? (u.rooms || 0) >= 4 : u.rooms === x))) &&
  (!r.layouts.length || (!!u.layout_id && r.layouts.includes(u.layout_id))) &&
  (!r.risers.length || r.risers.includes(riser(u))) &&
  (r.floor_from == null || u.floor >= r.floor_from) && (r.floor_to == null || u.floor <= r.floor_to) &&
  r.statuses.includes(u.status)

const rnd = (v: number, step: number) => Math.round(v / step) * step

// Новая цена квартиры или null — квартира не меняется (нет цены, другая валюта суммы, нет площади для цены за м²)
export function newPrice(u: RuleUnit, r: PriceRule): number | null {
  if (u.price == null && r.op !== 'set' && r.op !== 'm2') return null
  if (['add', 'set', 'm2'].includes(r.op) && r.currency !== u.currency) return null
  const p = u.price ?? 0
  let v: number
  switch (r.op) {
    case 'pct': v = p * (1 + r.value / 100); break
    case 'add': v = p + r.value; break
    case 'set': v = r.value; break
    case 'm2': if (!u.area) return null; v = r.value * u.area; break
    // базовый этаж и ниже не меняются (иначе округление сдвинуло бы цену без шага)
    case 'floor_step': if (u.floor <= (r.base_floor ?? u.floor)) return null; v = p * (1 + (r.value / 100) * (u.floor - (r.base_floor ?? u.floor))); break
  }
  v = rnd(v, r.round)
  return v > 0 && v !== u.price ? v : null
}

export function computeItems(units: RuleUnit[], r: PriceRule) {
  const out: { unit_id: string; old_price: number | null; new_price: number; currency: string }[] = []
  for (const u of units) {
    if (!matches(u, r)) continue
    const v = newPrice(u, r)
    if (v != null) out.push({ unit_id: u.id, old_price: u.price, new_price: v, currency: u.currency }) // без цены — null, откат вернёт пустую
  }
  return out
}
