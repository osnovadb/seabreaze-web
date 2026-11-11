'use server'
// 2.2 · Карточка условий застройщика (ТЗ 2.2 §7, экран Админ 03): правит админ, читают руководитель рынка, бэк-офис, финансы
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

const INT = ['reg_response_days', 'silence_extra_days', 'protect_months', 'renew_remind_days', 'booking_days', 'booking_ext_days', 'max_bookings_total', 'max_bookings_person', 'clawback_months', 'payment_wait_days'] as const

export async function saveDeveloper(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.user.role !== 'owner' || c.impersonating) return { error: 'Править условия застройщика может только админ' }
  const id = s(f, 'id')
  const ints: number[] = []
  for (const k of INT) { const v = Number(s(f, k)); if (!Number.isInteger(v) || v < 0) return { error: 'Проверьте число: ' + k }; ints.push(v) }
  const sub = s(f, 'protect_months_sub') ? Number(s(f, 'protect_months_sub')) : null
  const comm = s(f, 'commission_pct') ? Number(s(f, 'commission_pct').replace(',', '.')) : null
  if (comm !== null && (Number.isNaN(comm) || comm < 0 || comm > 50)) return { error: 'Комиссия — от 0 до 50%' }
  const rates: Record<string, number> = {}
  for (const m of ['DE', 'IL', 'GLOBAL']) { const v = s(f, 'rate_' + m); if (v) { const n = Number(v.replace(',', '.')); if (Number.isNaN(n)) return { error: 'Ставка рынка ' + m }; rates[m] = n } }
  const pick = (k: string, ok: string[], d: string) => (ok.includes(s(f, k)) ? s(f, k) : d)
  const vals = [
    s(f, 'name'), pick('reg_method', ['crm', 'email', 'api', 'file'], 'email'), s(f, 'reg_email') || null, pick('silence_rule', ['confirm', 'remind'], 'remind'), sub,
    comm, JSON.stringify(rates), pick('vat_mode', ['over', 'incl'], 'over'), f.get('options_in_base') === 'on', f.get('booking_write_api') === 'on',
    s(f, 'pay_timing') || 'after_first_payment', s(f, 'fx_rule') || null, pick('clawback_offset', ['any', 'same_client'], 'any'), f.get('sells_to_az') === 'on',
    s(f, 'contacts') || null, s(f, 'note') || null, f.get('active') !== null ? f.get('active') === 'on' : true, ...ints,
  ]
  if (!vals[0]) return { error: 'Название обязательно' }
  const cols = ['name', 'reg_method', 'reg_email', 'silence_rule', 'protect_months_sub', 'commission_pct', 'rates_by_market', 'vat_mode', 'options_in_base', 'booking_write_api',
    'pay_timing', 'fx_rule', 'clawback_offset', 'sells_to_az', 'contacts', 'note', 'active', ...INT]
  let rid = id
  if (id) {
    await q(`update portal.developers set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...vals])
  } else {
    const r = await one<{ id: string }>(`insert into portal.developers (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, vals)
    rid = r!.id
  }
  await audit(c.real.id, id ? 'developer.save' : 'developer.create', 'developer', rid)
  revalidatePath('/admin/developers')
  return { ok: 'Сохранено' }
}
