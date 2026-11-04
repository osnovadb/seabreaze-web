'use server'
// Наблюдаемость (ТЗ «Запуск»): ошибка страницы → журнал и уведомление владельцу, не чаще раза в час на адрес.
// Текст ошибки в production скрыт — передаём код (digest), по нему ищем в журнале сервера (journalctl -u <служба>).
import { q, audit } from './db'
import { getCtx } from './auth'

export async function reportError(digest: string, path: string) {
  const c = await getCtx().catch(() => null)
  const d = String(digest || '').slice(0, 40), p = String(path || '').slice(0, 200)
  await audit(c?.real.id || null, 'error.page', 'page', p, { digest: d, as: c?.impersonating ? c.user.id : undefined })
  const key = `err:${p.split('?')[0]}:${new Date().toISOString().slice(0, 13)}`
  for (const o of await q<{ id: string }>(`select id from portal.users where active and role = 'owner'`))
    await q(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1,'access','Ошибка на странице {p} (код {d}) — подробности в журнале сервера', '/admin/journal', $2, $3) on conflict (dedup) where dedup is not null do nothing`,
      [o.id, JSON.stringify({ p, d: d || '—' }), key + ':' + o.id])
}
