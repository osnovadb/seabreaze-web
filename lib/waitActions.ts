'use server'
// Лист ожидания и сохранённые поиски (М12)
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { isExternal } from './perm'
import { clientScope } from './scope'
import { projectVisible } from './catalog'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function writeCtx() {
  const c = await requireCtx()
  if (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1') throw new Error('read-only: impersonation')
  return c
}
export async function joinWaitlist(f: FormData) {
  const c = await writeCtx()
  const u = await one<{ id: string; project_id: string; status: string }>('select id, project_id, status from units where id = $1', [s(f, 'unit')])
  if (!u || u.status === 'sold') return
  if (isExternal(c.user.role) && !(await projectVisible(u.project_id, c.user))) return
  let clientId: string | null = s(f, 'client') || null
  if (clientId) {
    const cs = clientScope(c.user)
    if (!(await one(`select 1 from portal.clients cl where cl.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, clientId]))) clientId = null
  }
  await q(`insert into portal.waitlist (unit_id, user_id, client_id) values ($1,$2,$3) on conflict do nothing`, [u.id, c.user.id, clientId])
  if (clientId) await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'system','Добавлен в лист ожидания на квартиру')`, [clientId, c.user.id])
  await audit(c.real.id, 'waitlist.join', 'unit', u.id, { client: clientId })
  revalidatePath(`/units/${u.id}`); revalidatePath('/waitlist')
}
export async function leaveWaitlist(f: FormData) {
  const c = await writeCtx()
  await q('update portal.waitlist set active = false where id = $1 and user_id = $2', [s(f, 'id'), c.user.id])
  revalidatePath('/waitlist')
}
export async function saveSearch(f: FormData) {
  const c = await writeCtx()
  const p = await one<{ id: string; name: string }>('select id, name from projects where slug = $1', [s(f, 'p')])
  if (!p) return
  const filters = { project: p.id, rooms: Number(s(f, 'r')) || null, max: Number(s(f, 'max')) || null, outdoor: ['g', 't'].includes(s(f, 'o')) ? s(f, 'o') : null }
  const name = [p.name, filters.rooms ? `${filters.rooms}к` : '', filters.max ? `≤ $${filters.max}k` : '', filters.outdoor === 'g' ? 'сад' : filters.outdoor === 't' ? 'терраса' : ''].filter(Boolean).join(' · ')
  // Первая проверка в tick запомнит текущие квартиры без уведомления — сообщаем только о новых
  await q(`insert into portal.saved_searches (user_id, name, filters) values ($1,$2,$3)`, [c.user.id, name, filters])
  await audit(c.real.id, 'search.save', 'project', p.id, filters)
  revalidatePath('/waitlist')
}
export async function deleteSearch(f: FormData) {
  const c = await writeCtx()
  await q('delete from portal.saved_searches where id = $1 and user_id = $2', [s(f, 'id'), c.user.id])
  revalidatePath('/waitlist')
}
