// Журнал квартиры (portal.unit_events): триггер каталога пишет каждую смену статуса и цены. Портал в своей транзакции
// говорит, кто и откуда правит (app.user_id, app.change_source) — иначе запись будет «manual» без автора (Directus, SQL).
import type { PoolClient } from 'pg'
import { q, tx } from './db'

export function asActor<T>(userId: string, source: string, fn: (db: PoolClient) => Promise<T>) {
  return tx(async (db) => {
    await db.query(`select set_config('app.user_id', $1, true), set_config('app.change_source', $2, true)`, [userId, source])
    return fn(db)
  })
}

export type UnitEvent = { kind: 'created' | 'status' | 'price'; old_value: string | null; new_value: string | null; old_price: number | null; new_price: number | null; currency: string | null; source: string; who: string | null; at: string; list: string | null }
export const unitHistory = (unitId: string, limit = 15) => q<UnitEvent>(`select e.kind, e.old_value, e.new_value, e.old_price::float, e.new_price::float, e.currency, e.source, us.name who, e.at,
    (select pl.title from portal.price_lists pl where e.source = 'pricelist:' || pl.id::text) list
  from portal.unit_events e left join portal.users us on us.id = e.user_id where e.unit_id = $1 order by e.at desc, e.id desc limit $2`, [unitId, limit])
