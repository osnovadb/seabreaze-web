// Запись брони и продажи в Profitbase (М3): ставим в очередь portal.pb_outbox, отправляет tick. Только для квартир из источника Profitbase.
import { q, one } from './db'

export async function pbEnqueue(unitId: string, op: 'reserve' | 'release' | 'sold', bookingId: string | null, by: string | null) {
  const s = await one<{ id: string; config: { reserve_status?: string; sold_status?: string } }>(`select s.id, s.config from units u join sources s on s.id = u.source_id where u.id = $1 and s.kind = 'profitbase' and s.active`, [unitId])
  if (!s) return
  const alias = op === 'reserve' ? s.config.reserve_status || 'BOOKED' : op === 'sold' ? s.config.sold_status || 'SOLD' : 'AVAILABLE'
  await q(`insert into portal.pb_outbox (source_id, unit_id, booking_id, op, status_alias, created_by) values ($1,$2,$3,$4,$5,$6)`, [s.id, unitId, bookingId, op, alias, by])
}
