// 2.2 · Калькулятор вариантов, этап 3: варианты расчёта в подборке клиента.
// До трёх вариантов на квартиру. Клиенту уходит только вариант без согласования или согласованный.
// Суммы для клиента пересчитываются по действующей цене, плану, сетке и акции (как в калькуляторе), без комиссий.
import { q, one } from './db'
import { unitById, plansFor, downGridFor } from './catalog'
import { promoForUnit } from './promo'
import { optionsFor } from './options'
import { activeGrid, calcVariant, type CalcOut } from './calc'
import type { VariantParams } from './variants'

export const MAX_SEL_VARIANTS = 3

export type SelVariant = { variant_id: string; unit_id: string; name: string; params: VariantParams; needs_approval: boolean; approved_at: string | null; liked_at: string | null; author: string; sort: number }

// Варианты подборки по квартирам
export async function selectionVariants(selectionId: string) {
  const rows = await q<SelVariant>(`select sv.variant_id, sv.unit_id, v.name, v.params, v.needs_approval, v.approved_at, sv.liked_at, a.name author, sv.sort
    from portal.selection_variants sv join portal.calc_variants v on v.id = sv.variant_id join portal.users a on a.id = v.author_id
    where sv.selection_id = $1 order by sv.unit_id, sv.sort, sv.created_at`, [selectionId])
  const by = new Map<string, SelVariant[]>()
  for (const r of rows) by.set(r.unit_id, [...(by.get(r.unit_id) || []), r])
  return by
}
export const clientVisible = (v: Pick<SelVariant, 'needs_approval' | 'approved_at'>) => !v.needs_approval || !!v.approved_at

// Расчёт варианта для клиента: без условий комиссии; скидка — та, что согласована в варианте
export async function clientCalc(unitId: string, p: VariantParams, today = new Date().toISOString().slice(0, 10)): Promise<(CalcOut & { optionTitles: string[] }) | null> {
  const u = await unitById(unitId)
  if (!u || u.usd == null) return null
  const [plans, gridAll, promo, options] = await Promise.all([plansFor(u.project_id, u.building_id), downGridFor(u.project_id), promoForUnit(u), optionsFor(u)])
  const picked = options.filter((o) => (p.options || []).includes(o.id))
  // 361: скидка варианта — в пределах пула плана (сетка или пул проекта) на сегодня
  const poolPct = (await one<{ p: number }>('select pool_pct::float p from portal.cur_conditions($1)', [u.project_id]))?.p ?? 0
  const r = calcVariant({ list: u.usd, plans, grid: activeGrid(gridAll, today, u.building_id), promo: promo.promo, mode: promo.mode, planId: p.planId || null,
    downPct: p.downPct, months: p.months, disc: p.disc, start: p.start, optionsUsd: picked.reduce((a, o) => a + o.usd, 0), cap: p.disc, ceiling: p.disc, cond: null, ext: false, poolPct, today })
  return { ...r, optionTitles: picked.map((o) => o.title) }
}
