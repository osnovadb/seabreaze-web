// 2.2 · Калькулятор вариантов, этап 4: одни и те же данные калькулятора для карточки квартиры, боковой панели шахматки
// и вкладки «Расчёт» карточки клиента в Bitrix24 — чтобы расчёт и права не расходились между экранами.
import type { Ctx } from './auth'
import type { Unit } from './catalog'
import { plansFor, downGridFor, conditionsFor } from './catalog'
import { optionsFor } from './options'
import { promoForUnit } from './promo'
import { fxFor } from './fx'
import { activeGrid } from './calc'
import { isExternal, maxDiscount, discountCeiling, canBook } from './perm'
import { variantsOf } from './variants'

export async function calcViewProps(u: Unit, c: Ctx, o: { clients: { id: string; name: string }[]; bookable: boolean; clientId?: string | null }) {
  if (u.usd == null) return null
  const ext = isExternal(c.user.role), role = c.user.role
  const [plans, opts, fx, pr, cond, gridAll, vs] = await Promise.all([plansFor(u.project_id, u.building_id), optionsFor(u), fxFor(c.user.market, c.lang), promoForUnit(u),
    conditionsFor(u.project_id, c.user), downGridFor(u.project_id), variantsOf(u.id, c.user)])
  const self: 'agent' | 'ours' | 'seller' | null = ext ? (role === 'agency_head' || !c.user.agency_id ? 'agent' : null) : ['owner', 'market_head'].includes(role) ? 'ours' : role === 'seller' ? 'seller' : null
  // во вкладке клиента — только его варианты; на карточке квартиры и в шахматке — все свои (руководителю — все)
  const variants = vs.filter((v) => !o.clientId || v.client_id === o.clientId).map((v) => ({ id: v.id, name: v.name, author: v.author, client: v.client, client_id: v.client_id, mine: v.author_id === c.user.id,
    needs_approval: v.needs_approval, approved_at: v.approved_at, rejected_at: v.rejected_at || null, created_at: v.created_at, params: v.params, snapshot: v.snapshot }))
  return {
    list: u.usd, plans, grid: activeGrid(gridAll, new Date().toISOString().slice(0, 10), u.building_id), fx, promo: pr.promo, mode: pr.mode, options: opts,
    cond: cond ? { fix_pct: cond.fix_pct, pool_pct: cond.pool_pct, agent_fix_pct: cond.agent_fix_pct, agent_pool_pct: cond.agent_pool_pct, agent_our_pool_share: cond.agent_our_pool_share, seller_share_pct: cond.seller_share_pct, fix_base: cond.fix_base || 'final' } : null,
    ext, cap: cond ? maxDiscount(role, cond) : 0, ceiling: cond && canBook(role) ? (ext ? maxDiscount(role, cond) : discountCeiling(role, cond)) : 0, ask: ext, self,
    unitId: u.id, variants, clients: o.clients, clientPreset: o.clientId || undefined,
    canApprove: ['owner', 'market_head'].includes(role), ownerView: role === 'owner', bookable: o.bookable,
  }
}
