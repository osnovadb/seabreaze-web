import { q } from './db'
import type { PromoMode, PromoView } from './plans'
import type { Unit } from './catalog'

// Действующие акции проекта на сегодня; на квартиру берётся самая выгодная из подходящих (по проекту, блоку или списку квартир)
type Offer = { id: string; building_id: string | null; name: string; badge: string | null; kind: 'pct' | 'fixed'; value: number; currency: string | null; unit_ids: string[] | null; ends_on: string | null }
export const offersFor = (projectId: string) => q<Offer>(`select id, building_id, name, badge, kind, value::float, currency, unit_ids, ends_on::text from portal.special_offers
  where project_id = $1 and active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)`, [projectId])
export function promoOf(u: Pick<Unit, 'id' | 'building_id' | 'usd' | 'price' | 'currency'>, offers: Offer[]): PromoView | null {
  if (!u.usd) return null
  let best: PromoView | null = null
  for (const o of offers) {
    if (o.building_id && o.building_id !== u.building_id) continue
    if (o.unit_ids?.length && !o.unit_ids.includes(u.id)) continue
    // фиксированная скидка — в валюте проекта; в USD по тому же курсу, что и цена квартиры
    const usd = o.kind === 'fixed' ? (o.currency === u.currency && u.price ? o.value * u.usd / u.price : o.currency === 'USD' ? o.value : 0) : u.usd * o.value / 100
    if (!usd) continue
    const v: PromoView = { id: o.id, name: o.name, badge: o.badge, kind: o.kind, pct: o.kind === 'pct' ? o.value : usd / u.usd * 100, usd, ends_on: o.ends_on }
    if (!best || v.usd > best.usd) best = v
  }
  return best
}
export async function promoMode(projectId: string): Promise<PromoMode> {
  const r = await q<{ promo_mode: PromoMode }>('select promo_mode from portal.project_settings where project_id = $1', [projectId])
  return r[0]?.promo_mode || 'chain'
}
export async function promoForUnit(u: Pick<Unit, 'id' | 'building_id' | 'usd' | 'price' | 'currency' | 'project_id'>) {
  return { promo: promoOf(u, await offersFor(u.project_id)), mode: await promoMode(u.project_id) }
}
