// 2.2 · Застройщики: чтение карточек условий (без 'use server' — не превращать в публичные действия)
import { q, one } from './db'

export type Developer = {
  id: string; name: string; catalog_id: string | null; reg_method: string; reg_email: string | null; reg_response_days: number
  silence_rule: 'confirm' | 'remind'; silence_extra_days: number; protect_months: number; protect_months_sub: number | null; renew_remind_days: number
  booking_days: number; booking_ext_days: number; max_bookings_total: number; max_bookings_person: number; booking_write_api: boolean
  commission_pct: number | null; rates_by_market: Record<string, number>; vat_mode: 'over' | 'incl'; options_in_base: boolean
  pay_timing: string; fx_rule: string | null; clawback_months: number; clawback_offset: 'any' | 'same_client'; payment_wait_days: number
  sells_to_az: boolean; tz: string; contacts: string | null; note: string | null; active: boolean
}

export async function listDevelopers() {
  return q<Developer & { projects: string | null }>(`select d.*, d.commission_pct::float commission_pct,
      (select string_agg(p.name, ', ' order by p.name) from public.projects p where p.developer_id = d.catalog_id) projects
    from portal.developers d order by d.active desc, d.name`)
}

export async function developerOfProject(projectId: string) {
  return one<Developer>(`select d.*, d.commission_pct::float commission_pct from portal.developers d join public.projects p on p.developer_id = d.catalog_id where p.id = $1`, [projectId])
}

