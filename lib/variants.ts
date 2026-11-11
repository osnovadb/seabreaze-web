// 2.2 · Калькулятор вариантов, этап 2: входные данные расчёта по квартире и пересчёт сохранённых вариантов на сервере.
// Суммы варианта считаем здесь, а не берём из браузера: от действующей цены, планов, сетки, акции и условий проекта.
import { q } from './db'
import type { User } from './auth'
import { unitById, plansFor, downGridFor, conditionsFor } from './catalog'
import { promoForUnit } from './promo'
import { optionsFor } from './options'
import { activeGrid, calcVariant, type CalcIn, type CalcOut } from './calc'
import { isExternal, maxDiscount, discountCeiling, canBook } from './perm'

export type VariantParams = { downPct: number; months: number; disc: number; start?: string; options?: string[]; planId?: string | null }
export type Snapshot = { list: number; total: number; down: number; monthly: number; months: number; downPct: number; last: string | null; devPct: number; disc: number; approx: boolean; needsApproval: boolean }
export type VariantRow = { id: string; unit_id: string; author_id: string; author: string; client_id: string | null; client: string | null; name: string; params: VariantParams; snapshot: Snapshot
  needs_approval: boolean; approved_at: string | null; rejected_at?: string | null; created_at: string }

export async function calcInputs(unitId: string, user: User) {
  const u = await unitById(unitId)
  if (!u || u.usd == null) return null
  const [plans, gridAll, promo, cond, options] = await Promise.all([plansFor(u.project_id, u.building_id), downGridFor(u.project_id), promoForUnit(u), conditionsFor(u.project_id, user), optionsFor(u)])
  const role = user.role, ext = isExternal(role)
  return {
    unit: u, options,
    base: {
      list: u.usd, plans, grid: activeGrid(gridAll, new Date().toISOString().slice(0, 10), u.building_id), promo: promo.promo, mode: promo.mode,
      cond: cond ? { fix_pct: cond.fix_pct, pool_pct: cond.pool_pct, agent_fix_pct: cond.agent_fix_pct, agent_pool_pct: cond.agent_pool_pct, agent_our_pool_share: cond.agent_our_pool_share, seller_share_pct: cond.seller_share_pct, fix_base: cond.fix_base || 'final' } : null,
      ext, cap: cond ? maxDiscount(role, cond) : 0, ceiling: cond && canBook(role) ? discountCeiling(role, cond) : 0,
    } satisfies Omit<CalcIn, 'downPct' | 'months' | 'disc'>,
  }
}

export function runVariant(inp: NonNullable<Awaited<ReturnType<typeof calcInputs>>>, p: VariantParams, askMax?: number): CalcOut {
  const optionsUsd = inp.options.filter((o) => (p.options || []).includes(o.id)).reduce((a, o) => a + o.usd, 0)
  return calcVariant({ ...inp.base, planId: p.planId || null, downPct: p.downPct, months: p.months, disc: p.disc, start: p.start, optionsUsd, askMax })
}
export const snapshotOf = (r: CalcOut, list: number): Snapshot => ({ list, total: r.total, down: r.down, monthly: r.monthly, months: r.months, downPct: r.downPct, last: r.last, devPct: r.devPct, disc: r.disc, approx: r.approx, needsApproval: r.needsApproval })

// Варианты квартиры: свои; руководителю рынка и владельцу — все (для согласования скидки)
export const variantsOf = (unitId: string, user: User) => q<VariantRow>(
  `select v.id, v.unit_id, v.author_id, a.name author, v.client_id, cl.name client, v.name, v.params, v.snapshot, v.needs_approval, v.approved_at, v.rejected_at, v.created_at
   from portal.calc_variants v join portal.users a on a.id = v.author_id left join portal.clients cl on cl.id = v.client_id
   where v.unit_id = $1 and (v.author_id = $2 or $3) order by v.created_at`, [unitId, user.id, ['owner', 'market_head'].includes(user.role)])
