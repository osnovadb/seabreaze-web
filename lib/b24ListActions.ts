'use server'
// 2.2 · §12 Список сделок → «отправить подборку выбранным сделкам»: одна подборка квартир каждому клиенту, ссылка — в ленту его сделки
import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { pushDeal } from './b24sync'

export async function sendSelectionToDeals(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (!['owner', 'market_head', 'seller', 'office'].includes(c.user.role) || c.impersonating) return { error: 'Нет прав' }
  const clients = f.getAll('client').map(String).filter(Boolean)
  const nos = String(f.get('units') || '').split(/[,;\s]+/).filter(Boolean)
  const units: string[] = []
  for (const no of nos) {
    const u = await q<{ id: string }>(`select u.id from units u join buildings bl on bl.id = u.building_id where upper(portal.unit_no(bl.external_id, u.number)) = upper($1) limit 2`, [no])
    if (u.length !== 1) return { error: `Квартира ${no} не найдена или номер есть в нескольких проектах` }
    units.push(u[0].id)
  }
  if (!clients.length || !units.length) return { error: 'Выберите клиентов и квартиры' }
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  for (const cid of clients) {
    const cl = await one<{ language: string | null }>('select language from portal.clients where id = $1', [cid])
    if (!cl) continue
    const tok = crypto.randomBytes(9).toString('base64url')
    const sel = (await one<{ id: string }>(`insert into portal.selections (token, client_id, user_id, title, lang) values ($1,$2,$3,'Подборка',$4) returning id`, [tok, cid, c.user.id, ['ru', 'en', 'de', 'he'].includes(cl.language || '') ? cl.language : 'en']))!
    for (const u of units) await q('insert into portal.selection_items (selection_id, unit_id) values ($1,$2) on conflict do nothing', [sel.id, u])
    await pushDeal(cid, `подборка из ${units.length} квартир — ${base}/s/${tok}`)
  }
  await audit(c.real.id, 'b24.list_selection', 'b24', undefined, { clients: clients.length, units: units.length })
  revalidatePath('/b24/deals')
  return { ok: true, made: clients.length }
}
