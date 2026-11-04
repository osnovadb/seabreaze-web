'use server'
// Наблюдаемость (ТЗ «Запуск»): ошибка страницы → журнал и уведомление владельцу, не чаще раза в час на адрес.
// Текст ошибки в production скрыт — передаём код (digest), по нему ищем в журнале сервера (journalctl -u <служба>).
// Вызов приходит от клиента: только вошедшим, путь и код — по маске, не больше 5 отчётов в час на пользователя,
// вид 'system' — не срочный (в сводку, без немедленного письма и Telegram)
import { q, one, audit } from './db'
import { getCtx } from './auth'

const PATH = /^\/[\w\-/.]{0,150}$/
const DIGEST = /^[\w-]{1,40}$/

export async function reportError(digest: string, path: string) {
  const c = await getCtx().catch(() => null)
  if (!c) return
  const p = String(path || '').split('?')[0], d = String(digest || '')
  if (!PATH.test(p) || (d && !DIGEST.test(d))) return
  const n = await one<{ n: number }>(`select count(*)::int n from portal.audit where user_id = $1 and action = 'error.page' and created_at > now() - interval '1 hour'`, [c.real.id])
  if ((n?.n ?? 0) >= 5) return
  await audit(c.real.id, 'error.page', 'page', p, { digest: d, as: c.impersonating ? c.user.id : undefined })
  const key = `err:${p}:${new Date().toISOString().slice(0, 13)}`
  for (const o of await q<{ id: string }>(`select id from portal.users where active and role = 'owner'`))
    await q(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1,'system','Ошибка на странице {p} (код {d}) — подробности в журнале сервера', '/admin/journal', $2, $3) on conflict (dedup) where dedup is not null do nothing`,
      [o.id, JSON.stringify({ p, d: d || '—' }), key + ':' + o.id])
}
