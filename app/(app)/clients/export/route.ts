import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t } from '@/lib/i18n'
import { canSeeClients } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { makeXlsx } from '@/lib/xlsx'

// Выгрузка клиентов в xlsx (М13): только те, кого пользователь видит в CRM
export async function GET() {
  const c = await requireCtx()
  if (!canSeeClients(c.user.role) || c.user.role === 'office') return new Response('forbidden', { status: 403 })
  const T = (s: string) => t(c.lang, s)
  const cs = clientScope(c.user)
  const rows = await q<any>(`select cl.reg_no, cl.name, cl.phone, cl.email, cl.country, cl.language, cl.market, cl.source, cl.stage, u.name owner, cl.protected_until::text, cl.kyc_status, cl.goal, cl.budget, cl.created_at::date::text created
    from portal.clients cl join portal.users u on u.id = cl.owner_id where ${cs.sql} order by cl.created_at`, cs.params)
  const head = ['Номер', 'Имя', 'Телефон', 'E-mail', 'Страна', 'Язык', 'Рынок', 'Источник', 'Стадия', 'Владелец', 'Закреплён до', 'KYC', 'Цель', 'Бюджет', 'Создан'].map(T)
  const buf = makeXlsx([{ name: T('Клиенты'), rows: [head, ...rows.map((r) => [r.reg_no, r.name, r.phone, r.email, r.country, r.language, r.market, r.source, r.stage, r.owner, r.protected_until, r.kyc_status, r.goal, r.budget, r.created])] }])
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="clients-${new Date().toISOString().slice(0, 10)}.xlsx"` } })
}
