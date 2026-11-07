// 2.2 · Связь карточек Bitrix24 с клиентами портала (чтение; без 'use server')
import { q, one } from './db'
import { restHook, hookOn, contactKeys } from './b24'

export type Kind = 'deal' | 'contact' | 'lead'
export const COL: Record<Kind, string> = { deal: 'b24_deal_id', contact: 'b24_contact_id', lead: 'b24_lead_id' }

// Данные человека из Bitrix24: для сделки — её контакт; рынок — по воронке (Sales DE → DE)
export async function b24Person(kind: Kind, id: number) {
  if (!hookOn()) return null
  let src: any, contactId: number | null = null, market: string | null = null
  if (kind === 'deal') {
    const d = await restHook('crm.deal.get', { id })
    contactId = Number(d.CONTACT_ID) || null
    const cats = (await restHook('crm.category.list', { entityTypeId: 2 })).categories as { id: number; name: string }[]
    const nm = cats.find((x) => String(x.id) === String(d.CATEGORY_ID))?.name || ''
    market = /\bIL\b/.test(nm) ? 'IL' : /Global/.test(nm) ? 'GLOBAL' : /\bDE\b/.test(nm) ? 'DE' : null
    src = contactId ? await restHook('crm.contact.get', { id: contactId }) : { NAME: d.TITLE }
  } else if (kind === 'contact') { src = await restHook('crm.contact.get', { id }); contactId = id }
  else src = await restHook('crm.lead.get', { id })
  const k = contactKeys(src)
  const name = [src.NAME, src.LAST_NAME].filter(Boolean).join(' ') || src.TITLE || 'Клиент Bitrix24'
  return { name, contactId, market, ...k }
}

// Найти клиента портала: по связи, затем по телефону (9 последних цифр) или e-mail — и запомнить связь
export async function resolveClient(kind: Kind, id: number) {
  const linked = await one<{ id: string }>(`select id from portal.clients where ${COL[kind]} = $1 limit 1`, [id])
  if (linked) return { id: linked.id, person: null }
  const p = await b24Person(kind, id).catch(() => null)
  if (!p) return { id: null, person: null }
  const m = await one<{ id: string }>(`select id from portal.clients where attach_status <> 'junk' and ((length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or (email_norm <> '' and email_norm = $2)) order by created_at limit 1`, [p.phoneNorm, p.emailNorm])
  if (m) {
    await q(`update portal.clients set ${COL[kind]} = $2, b24_contact_id = coalesce(b24_contact_id, $3) where id = $1`, [m.id, id, p.contactId])
    return { id: m.id, person: p }
  }
  return { id: null, person: p }
}

