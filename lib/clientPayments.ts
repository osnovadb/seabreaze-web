// 2.2 · 292 (Денис 11.11): список платежей клиента по рассрочке, следующий платёж и флаг просрочки.
// График — по плану брони (или варианту расчёта, из которого бронь сделана) от даты договора; оплачено — доля, которую вносят финансы (paid_pct).
import { q } from './db'
import { scheduleOf, type PaySchedule, type DealSnap } from './paySchedule'
export { scheduleOf, type PaySchedule }

export async function dealSchedules(clientId: string) {
  const ds = await q<DealSnap & { id: string; unit: string }>(`select d.id, portal.unit_no(bl.external_id, un.number) unit, d.final_price::float, b.options_usd::float, d.paid_pct::float, d.created_at, b.snapshot
    from portal.deals d join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id left join portal.bookings b on b.id = d.booking_id
    where d.client_id = $1 and d.stage <> 'cancelled' order by d.created_at`, [clientId])
  return ds.map((d) => ({ id: d.id, unit: d.unit, paid: Number(d.paid_pct || 0), s: scheduleOf(d) }))
}
