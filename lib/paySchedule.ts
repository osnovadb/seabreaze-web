// 2.2 · 292: график платежей клиента по сделке — чистая функция (сервер, юнит-тесты)
import { paymentRows, type Plan, type Row } from './plans.ts'

export type PayRow = Row & { cum: number; paid: boolean; overdue: boolean }
export type PaySchedule = { rows: PayRow[]; total: number; paidPct: number; next: PayRow | null; overdue: PayRow[]; overdueAmount: number }

export type DealSnap = { final_price: number; options_usd: number | null; paid_pct: number; created_at: string; snapshot: { plan?: { down?: number; months?: number | null } | null; variant?: { downPct?: number; months?: number; start?: string | null } | null } | null }

export function scheduleOf(d: DealSnap, today = new Date().toISOString().slice(0, 10)): PaySchedule | null {
  const v = d.snapshot?.variant, p = d.snapshot?.plan
  const down = v?.downPct ?? p?.down ?? null
  if (down == null) return null
  const months = Number(v?.months ?? p?.months ?? 0)
  const plan: Plan = { id: 'deal', project_id: '', building_id: null, name: '', down_payment_pct: Number(down), months: months || null, full_payment_discount_pct: null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: null }
  const total = Math.round(Number(d.final_price) + Number(d.options_usd || 0))
  const start = new Date((v?.start || String(d.created_at).slice(0, 10)) + 'T00:00:00Z')
  const base = paymentRows(plan, total, start)
  let acc = 0
  const paidAmt = total * Number(d.paid_pct || 0) / 100
  const rows: PayRow[] = base.map((r) => { acc += r.amount; const paid = paidAmt + 0.5 >= acc; return { ...r, cum: acc, paid, overdue: !paid && !!r.due && r.due < today } })
  const overdue = rows.filter((r) => r.overdue)
  return { rows, total, paidPct: Number(d.paid_pct || 0), next: rows.find((r) => !r.paid) || null, overdue, overdueAmount: Math.max(0, Math.round((overdue.length ? overdue[overdue.length - 1].cum : 0) - paidAmt)) }
}

