import { q } from './db'
import type { PromoMode, PromoView } from './plans'
import type { Unit } from './catalog'
import { bestOffer } from './promoMatch.mjs'

// Действующие акции проекта на сегодня; на квартиру берётся самая выгодная из подходящих (по проекту, блоку или списку квартир)
type Offer = { id: string; building_id: string | null; name: string; badge: string | null; kind: 'pct' | 'fixed'; value: number; currency: string | null; unit_ids: string[] | null; ends_on: string | null }
export const offersFor = (projectId: string) => q<Offer>(`select id, building_id, name, badge, kind, value::float, currency, unit_ids, ends_on::text from portal.special_offers
  where project_id = $1 and active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)
  order by ends_on nulls last, created_at, id`, [projectId])
export function promoOf(u: Pick<Unit, 'id' | 'building_id' | 'usd' | 'price' | 'currency'>, offers: Offer[]): PromoView | null {
  const b = bestOffer(u, offers)
  if (!b || !u.usd) return null
  const o = b.offer
  return { id: o.id, name: o.name, badge: o.badge, kind: o.kind, pct: o.kind === 'pct' ? o.value : (b.usd / u.usd) * 100, usd: b.usd, ends_on: o.ends_on }
}
export async function promoMode(projectId: string): Promise<PromoMode> {
  const r = await q<{ promo_mode: PromoMode }>('select promo_mode from portal.project_settings where project_id = $1', [projectId])
  return r[0]?.promo_mode || 'chain'
}
export async function promoForUnit(u: Pick<Unit, 'id' | 'building_id' | 'usd' | 'price' | 'currency' | 'project_id'>) {
  return { promo: promoOf(u, await offersFor(u.project_id)), mode: await promoMode(u.project_id) }
}
