// 2.2 · §12 Роботы приложения в сделках Bitrix24: проверить квартиру, запросить бронь, снять бронь, отправить подборку.
// Bitrix24 вызывает обработчик с токеном приложения; результат возвращаем через bizproc.event.send. Действует от имени ответственного по сделке.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { q, one, audit } from '@/lib/db'
import { restApp, domainOk, restHook } from '@/lib/b24'
import { actingAs } from '@/lib/auth'
import { createBooking } from '@/lib/actions'
import { pushDeal } from '@/lib/b24sync'

export const dynamic = 'force-dynamic'

async function unitByNo(no: string) {
  const rows = await q<{ id: string; status: string; price: number | null; hold: string | null }>(`select u.id, u.status, u.price_list::float price,
      (select b.status from portal.bookings b where b.unit_id = u.id and b.status in ('hold','queued','requested','confirmed','release_pending') limit 1) hold
    from units u join buildings bl on bl.id = u.building_id where upper(portal.unit_no(bl.external_id, u.number)) = upper($1) limit 2`, [no.trim()])
  return rows.length === 1 ? rows[0] : rows.length > 1 ? 'ambiguous' : null
}

export async function POST(req: Request) {
  const f = await req.formData()
  const g = (k: string) => String(f.get(k) ?? '')
  const domain = g('auth[domain]'), token = g('auth[access_token]'), code = g('code'), event = g('event_token')
  if (!domainOk(domain) || !token) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  // токен — от нашего приложения и нашего Bitrix24
  try { await restApp(domain, token, 'app.info') } catch { return NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  const dealId = Number((g('document_id[2]').match(/DEAL_(\d+)/) || [])[1] || 0)
  const prop = (k: string) => g(`properties[${k}]`).trim()
  const send = (values: Record<string, string | number>) => event ? restApp(domain, token, 'bizproc.event.send', { event_token: event, return_values: values, log_message: String(values.RESULT || values.STATUS || values.LINK || '') }).catch(() => null) : null
  const cl = dealId ? await one<{ id: string; market: string | null; language: string | null }>('select id, market, language from portal.clients where b24_deal_id = $1', [dealId]) : null
  // от чьего имени: ответственный по сделке, сопоставленный с пользователем портала; иначе — админ
  const deal = dealId ? await restHook<{ ASSIGNED_BY_ID: string }>('crm.deal.get', { id: dealId }).catch(() => null) : null
  const actor = (await one<{ id: string }>(`select id from portal.users where active and b24_user_id = $1`, [Number(deal?.ASSIGNED_BY_ID || 0)]))?.id
    || (await one<{ id: string }>(`select id from portal.users where active and role = 'owner' order by created_at limit 1`))!.id
  let out: Record<string, string | number> = {}
  if (code === 'ge_check_unit') {
    const u = await unitByNo(prop('UNIT'))
    out = !u ? { AVAILABLE: 'N', STATUS: 'not found', PRICE: 0 } : u === 'ambiguous' ? { AVAILABLE: 'N', STATUS: 'ambiguous: several projects', PRICE: 0 }
      : { AVAILABLE: u.status === 'available' && !u.hold ? 'Y' : 'N', STATUS: u.hold || u.status, PRICE: u.price || 0 }
  } else if (!cl) {
    out = { RESULT: 'deal is not linked to a portal client — open the Units tab first', LINK: '' }
  } else if (code === 'ge_request_booking') {
    const u = await unitByNo(prop('UNIT'))
    if (!u || u === 'ambiguous') out = { RESULT: u ? 'unit number is ambiguous' : 'unit not found' }
    else {
      const fd = new FormData(); fd.set('unit', u.id); fd.set('client', cl.id); fd.set('discount', prop('DISCOUNT') || '0')
      try {
        const r = await actingAs.run(actor, () => createBooking(null, fd)) as { error?: string } | undefined
        out = { RESULT: r?.error ? 'not created: ' + r.error : 'requested' }
      } catch (e) { out = { RESULT: isRedirectError(e) ? 'requested' : 'error: ' + String((e as Error).message).slice(0, 120) } }
    }
  } else if (code === 'ge_release_booking') {
    const no = prop('UNIT')
    const u = no ? await unitByNo(no) : null
    if (no && (!u || u === 'ambiguous')) out = { RESULT: 'unit not found' }
    else {
      const unitId = u && u !== 'ambiguous' ? u.id : null
      const free = await q<{ id: string }>(`update portal.bookings set status = 'cancelled' where client_id = $1 and ($2::uuid is null or unit_id = $2) and status in ('hold','queued','requested') returning id`, [cl.id, unitId])
      // подтверждённая бронь снимается у застройщика — бэк-офис подтверждает снятие (Release pending)
      const rel = await q<{ id: string }>(`update portal.bookings set status = 'release_pending' where client_id = $1 and ($2::uuid is null or unit_id = $2) and status = 'confirmed' returning id`, [cl.id, unitId])
      await audit(actor, 'robot.release', 'client', cl.id, { cancelled: free.length, release_pending: rel.length })
      await pushDeal(cl.id, `робот: снято броней ${free.length}${rel.length ? `, к снятию у застройщика ${rel.length}` : ''}`)
      out = { RESULT: `cancelled ${free.length}, release pending ${rel.length}` }
    }
  } else if (code === 'ge_send_selection') {
    const ids: string[] = []
    for (const no of prop('UNITS').split(/[,;\s]+/).filter(Boolean)) { const u = await unitByNo(no); if (u && u !== 'ambiguous') ids.push(u.id) }
    if (!ids.length) out = { LINK: '', RESULT: 'no units found' }
    else {
      const tok = crypto.randomBytes(9).toString('base64url')
      const s = (await one<{ id: string }>(`insert into portal.selections (token, client_id, user_id, title, lang) values ($1,$2,$3,'Подборка',$4) returning id`, [tok, cl.id, actor, ['ru', 'en', 'de', 'he'].includes(cl.language || '') ? cl.language : 'en']))!
      for (const id of ids) await q(`insert into portal.selection_items (selection_id, unit_id) values ($1,$2) on conflict do nothing`, [s.id, id])
      const link = `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/s/${tok}`
      await pushDeal(cl.id, `робот: подборка из ${ids.length} квартир — ${link}`)
      await audit(actor, 'robot.selection', 'client', cl.id, { units: ids.length })
      out = { LINK: link }
    }
  }
  await send(out)
  return NextResponse.json({ ok: true, ...out })
}
