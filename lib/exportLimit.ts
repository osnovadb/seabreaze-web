// 2.2 · Н2 (ревью 10.11, до запуска): лимит выгрузки контактов клиентов. Каждая выгрузка уже пишется в журнал —
// по нему считаем: не больше EXPORTS_PER_DAY файлов с контактами за сутки на человека (владелец — без лимита).
// Упёрлись — отказ и уведомление владельцу (раз в сутки на человека): массовая выгрузка базы — повод проверить.
import { q, one } from './db'

export const EXPORTS_PER_DAY = 20
export const CONTACT_EXPORTS = ['registration.export', 'registration.contacts_export']

export async function exportAllowed(userId: string, role: string, who: string): Promise<boolean> {
  if (role === 'owner') return true
  const n = await one<{ n: number }>(`select count(*)::int n from portal.audit where user_id = $1 and action = any($2) and created_at > now() - interval '24 hours'`, [userId, CONTACT_EXPORTS])
  if ((n?.n ?? 0) < EXPORTS_PER_DAY) return true
  const key = `exportlimit:${userId}:${new Date().toISOString().slice(0, 10)}`
  for (const o of await q<{ id: string }>(`select id from portal.users where active and role = 'owner'`))
    await q(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1,'system','{u} упёрся в лимит выгрузки контактов ({n} файлов за сутки)', '/admin/journal', $2, $3) on conflict (dedup) where dedup is not null do nothing`,
      [o.id, JSON.stringify({ u: who, n: EXPORTS_PER_DAY }), key + ':' + o.id])
  return false
}
