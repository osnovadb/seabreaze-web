// 2.2 · Портал → Bitrix24 (§13 события 8, 11, 13): квартиры клиента, бронь и стадия в сделке, запись в ленту.
// Стадия двигается только вперёд и по самой продвинутой квартире; Reserved и SPA signed ставит только портал.
import { q, one, audit } from './db'
import { restHook, hookOn } from './b24'

const ORDER = ['Selection', 'Developer registration', 'Reservation request', 'Reserved', 'KYC', 'SPA approval', 'SPA signed', 'Payments', 'Won']
const stageCache = new Map<number, { id: string; name: string }[]>()
async function stagesOf(cat: number) {
  if (!stageCache.has(cat)) {
    const r = await restHook<{ STATUS_ID: string; NAME: string }[]>('crm.status.list', { filter: { ENTITY_ID: cat === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${cat}` }, order: { SORT: 'ASC' } })
    stageCache.set(cat, r.map((s) => ({ id: s.STATUS_ID, name: s.NAME })))
  }
  return stageCache.get(cat)!
}

const RES: Record<string, string> = { hold: 'Hold', queued: 'Queued', requested: 'Requested', confirmed: 'Reserved', release_pending: 'Reserved', declined: 'Declined', cancelled: 'Released', expired: 'Expired', converted: 'Reserved' }
const STAGE_OF: Record<string, string> = { requested: 'Reservation request', queued: 'Reservation request', confirmed: 'Reserved', release_pending: 'Reserved', converted: 'SPA signed' }

// Собрать состояние клиента и записать в его сделку Bitrix24; note — строка в ленту сделки
export async function pushDeal(clientId: string, note?: string) {
  if (!hookOn()) return
  const cl = await one<{ b24_deal_id: number | null; name: string }>('select b24_deal_id, name from portal.clients where id = $1', [clientId])
  if (!cl?.b24_deal_id) return
  try {
    const units = await q<{ no: string; status: string; ends_at: string | null; list: number; final: number; disc: number; dev_no: string | null }>(`
      select portal.unit_no(bl.external_id, u.number) no, b.status, b.ends_at::date::text ends_at, b.price_list::float list, b.final_price::float final, b.discount_pct::float disc, b.dev_booking_no dev_no
      from portal.bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
      where b.client_id = $1 and b.status in ('hold','queued','requested','confirmed','release_pending','converted') order by b.created_at`, [clientId])
    const liked = await q<{ no: string }>(`select distinct portal.unit_no(bl.external_id, u.number) no from portal.selection_items si join portal.selections s on s.id = si.selection_id
      join units u on u.id = si.unit_id join buildings bl on bl.id = u.building_id where s.client_id = $1`, [clientId])
    const rank = (s: string) => ORDER.indexOf(STAGE_OF[s] || 'Selection')
    const main = [...units].sort((a, z) => rank(z.status) - rank(a.status))[0]
    const deal = await restHook<{ CATEGORY_ID: string; STAGE_ID: string }>('crm.deal.get', { id: cl.b24_deal_id })
    const cat = Number(deal.CATEGORY_ID)
    const stages = await stagesOf(cat)
    const curName = stages.find((s) => s.id === deal.STAGE_ID)?.name || 'Selection'
    const want = main ? STAGE_OF[main.status] || 'Selection' : 'Selection'
    const fields: Record<string, unknown> = {
      UF_CRM_GE_UNITS: Array.from(new Set([...units.map((u) => u.no), ...liked.map((u) => u.no)])).join(', '),
      UF_CRM_GE_MAIN_UNIT: main?.no || '',
      UF_CRM_GE_LIST_PRICE: main?.list ?? '', UF_CRM_GE_FINAL_PRICE: main?.final ?? '', UF_CRM_GE_DISCOUNT: main?.disc ?? '',
      UF_CRM_GE_RES_UNTIL: main?.ends_at || '', UF_CRM_GE_DEV_RES_NO: main?.dev_no || '',
      UF_CRM_GE_PORTAL_LINK: `${process.env.PUBLIC_URL || ''}/b24/units/${clientId}`,
      OPPORTUNITY: main?.final ?? 0, CURRENCY_ID: 'USD',
    }
    // поле-список: значение — по тексту варианта
    const resStatus = main ? RES[main.status] : ''
    if (resStatus) {
      const uf = (await restHook<any[]>('crm.deal.userfield.list', { filter: { FIELD_NAME: 'UF_CRM_GE_RES_STATUS' } }))[0]
      const item = uf?.LIST?.find((x: { VALUE: string }) => x.VALUE === resStatus)
      if (item) fields.UF_CRM_GE_RES_STATUS = item.ID
    }
    if (ORDER.indexOf(want) > ORDER.indexOf(curName)) {
      const st = stages.find((s) => s.name === want)
      if (st) fields.STAGE_ID = st.id
    }
    await restHook('crm.deal.update', { id: cl.b24_deal_id, fields, params: { REGISTER_SONET_EVENT: 'N' } })
    if (note) await restHook('crm.timeline.comment.add', { fields: { ENTITY_ID: cl.b24_deal_id, ENTITY_TYPE: 'deal', COMMENT: `GetsEstate · ${note}` } })
    await audit(null, 'b24.push', 'client', clientId, { deal: cl.b24_deal_id, stage: fields.STAGE_ID || null, note: note || null })
  } catch (e) {
    await audit(null, 'b24.push_failed', 'client', clientId, { error: String((e as Error).message).slice(0, 200) })
  }
}
