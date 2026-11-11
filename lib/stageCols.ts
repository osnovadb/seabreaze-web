// 382 (Денис 12.11): поля клиента для шкалы стадий — колонка считается staffCol / partnerCol (lib/stages); одна выборка для главной и отчётов
import { partnerCol, staffCol } from './stages'
export const STAGE_COLS_SQL = `cl.b24_stage, cl.b24_deal_id, cl.attach_status, cl.kyc_status,
  (coalesce(cl.goal, '') <> '' and coalesce(cl.budget, '') <> '' and coalesce(cl.timeline, '') <> '' and coalesce(cl.country, '') <> '' and coalesce(cl.language, '') <> '') as qualified,
  (select b.status from portal.bookings b where b.client_id = cl.id and b.status in ('queued','requested','confirmed','release_pending','converted') order by array_position(array['converted','release_pending','confirmed','requested','queued'], b.status) limit 1) as bstatus,
  exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled' and d.paid_pct > 0) as paid,
  exists (select 1 from portal.registrations r where r.client_id = cl.id and r.status <> 'to_send') as regs_sent,
  exists (select 1 from portal.bookings b where b.client_id = cl.id and b.status in ('confirmed','release_pending') and b.spa_approval_at is not null) as spa`
export type StageColsRow = { b24_stage: string | null; b24_deal_id: number | null; attach_status: string; kyc_status: string | null; qualified: boolean; bstatus: string | null; paid: boolean; regs_sent: boolean; spa: boolean }
export const colOf = (x: StageColsRow, ext: boolean) => ext
  ? partnerCol({ b24_stage: x.b24_stage, attach_status: x.attach_status, booking: x.bstatus, paid: x.paid, regs_sent: x.regs_sent })
  : staffCol({ b24_stage: x.b24_stage, b24_deal_id: x.b24_deal_id, attach_status: x.attach_status, booking: x.bstatus, paid: x.paid, regs_sent: x.regs_sent, kyc: x.kyc_status, spa: x.spa, qualified: x.qualified })
