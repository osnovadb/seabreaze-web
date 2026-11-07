'use server'
// Лист ожидания и сохранённые поиски (М12)
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { isExternal } from './perm'
import { clientScope } from './scope'
import { projectVisible, TYPE_NAME, VIEW_NAME } from './catalog'
import { normFilter } from './unitMatch.mjs'

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
  // свободная квартира — бронировать, а не ждать
  if (u.status === 'available' && !(await one(`select 1 from portal.bookings where unit_id = $1 and status in ('hold','queued','requested','confirmed','release_pending') union all select 1 from portal.deals where unit_id = $1 and stage <> 'cancelled' limit 1`, [u.id]))) return
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
  // Партнёр — только по открытому ему проекту (черновик или закрытый не сохраняется)
  if (isExternal(c.user.role) && !(await projectVisible(p.id, c.user))) return
  // Тот же фильтр, что в каталоге (lib/unitMatch.mjs); цена в форме — в тысячах долларов
  const k = (n: string) => (Number(s(f, n)) ? Number(s(f, n)) * 1000 : null)
  const b = s(f, 'b') ? await one<{ id: string; name: string }>('select id, name from buildings where id = $1 and project_id = $2', [s(f, 'b'), p.id]) : null
  const filters = normFilter({ project: p.id, building: b?.id, types: s(f, 't'), rooms: s(f, 'r'), pmin: k('pmin'), pmax: k('pmax') ?? k('max'), amin: s(f, 'amin'), amax: s(f, 'amax'),
    fmin: s(f, 'fmin'), fmax: s(f, 'fmax'), view: s(f, 'v') || null, outdoor: s(f, 'o'), corner: !!s(f, 'c'), promo: !!s(f, 'promo') })
  const th = (n: number) => `$${Math.round(n / 1000)}k`
  const name = [p.name, b?.name, filters.types.map((x) => TYPE_NAME[x] || x).join('/'), filters.rooms.length ? filters.rooms.map((r) => (r >= 4 ? '4+' : r)).join('/') + 'к' : '',
    filters.pmin != null || filters.pmax != null ? `${filters.pmin != null ? th(filters.pmin) : ''}–${filters.pmax != null ? th(filters.pmax) : ''}` : '',
    filters.amin != null || filters.amax != null ? `${filters.amin ?? ''}–${filters.amax ?? ''} м²` : '', filters.fmin != null || filters.fmax != null ? `эт. ${filters.fmin ?? ''}–${filters.fmax ?? ''}` : '',
    filters.view ? VIEW_NAME[filters.view] || filters.view : '', filters.outdoor === 'g' ? 'сад' : filters.outdoor === 't' ? 'терраса' : '', filters.corner ? 'угловая' : '', filters.promo ? 'акция' : ''].filter(Boolean).join(' · ')
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
