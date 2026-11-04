// Опции квартиры (группа 4): платные дополнения со своей валютой и списком объектов. Цена в USD — по курсу ЦБ Азербайджана
// (через AZN), как и цена квартиры; в бронь опции пишутся отдельно и в раздел денег (комиссия, пул) не входят.
import { q } from './db'
import type { Unit } from './catalog'

export type Opt = { id: string; title: string; note: string | null; price: number; currency: string; usd: number }
type Row = Omit<Opt, 'usd'> & { building_ids: string[]; unit_types: string[]; unit_ids: string[]; azn: number | null }

export async function optionsFor(u: Pick<Unit, 'id' | 'project_id' | 'building_id' | 'unit_type'>): Promise<Opt[]> {
  const rows = await q<Row & { usd_azn: number | null }>(`select o.id, o.title, o.note, o.price::float, o.currency, o.building_ids, o.unit_types, o.unit_ids,
      (select azn_per_unit::float from currency_rates r where r.currency = o.currency order by valid_from desc limit 1) azn,
      (select azn_per_unit::float from currency_rates r where r.currency = 'USD' order by valid_from desc limit 1) usd_azn
    from portal.unit_options o where o.project_id = $1 and o.active order by o.sort, o.title`, [u.project_id])
  return rows
    .filter((o) => (!o.building_ids.length || o.building_ids.includes(u.building_id)) && (!o.unit_types.length || o.unit_types.includes(u.unit_type)) && (!o.unit_ids.length || o.unit_ids.includes(u.id)))
    .map((o) => {
      const usd = o.currency === 'USD' ? o.price : o.currency === 'AZN' ? (o.usd_azn ? o.price / o.usd_azn : 0) : o.azn && o.usd_azn ? o.price * o.azn / o.usd_azn : 0
      return { id: o.id, title: o.title, note: o.note, price: o.price, currency: o.currency, usd: Math.round(usd) }
    })
    .filter((o) => o.usd > 0)
}
