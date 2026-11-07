// QA 2.2 · 04 Брони (§7): холд 24 ч, чужой холд, запрос, скидка сверх порога и согласование, лимит застройщика и очередь, подтверждение, отказ, Release pending, флаг «переговоры о цене»
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, qualify, freeUnit, project, q, one, close, act, lastBooking, booking, tick } from './h.mjs'

after(close)
let S1, S2, OF, MH, OW, P, c1, c2
test('setup', async () => {
  S1 = await user('seller'); S2 = await user('seller'); OF = await user('office'); MH = await user('market_head'); OW = await user('owner', { market: null }); P = await user('agent')
  c1 = (await register(S1)).result.id; c2 = (await register(S2)).result.id
  await q(`update portal.markets set price_negotiation = true`)
})
test('холд 24 ч: квартира придержана; второй сейлз не может запросить бронь на чужой холд', async () => {
  const u = await freeUnit()
  const h = await act(S1, 'holdUnit', { unit: u.id, client: c1 })
  const b = await lastBooking(c1)
  assert.equal(b?.status, 'hold', 'холд не поставлен: ' + JSON.stringify(h))
  const hrs = (new Date(b.ends_at) - Date.now()) / 3600000
  assert.ok(hrs > 23 && hrs <= 24.1, 'холд не 24 часа')
  const r = await act(S2, 'createBooking', { unit: u.id, client: c2, discount: 0 })
  assert.ok(r.result?.error, 'запрос на чужой холд прошёл')
  // свой холд → запрос брони
  const own = await act(S1, 'createBooking', { unit: u.id, client: c1, discount: 0 })
  assert.ok(own.redirect, 'свой холд не превратился в запрос: ' + JSON.stringify(own))
  assert.equal((await lastBooking(c1)).status, 'requested')
})
test('кандидата партнёра бронировать нельзя', async () => {
  const cand = (await register(P)).result.id
  const r = await act(P, 'createBooking', { unit: (await freeUnit()).id, client: cand, discount: 0 })
  assert.ok(r.result?.error && /квалифиц/i.test(r.result.error), JSON.stringify(r))
})
test('скидка в пределах порога — без согласования; сверх порога — ждёт руководителя рынка', async () => {
  const u1 = await freeUnit(), u2 = await freeUnit('premium-residence', { exclude: [u1.id] })
  const cl = (await register(S1)).result.id
  await act(S1, 'createBooking', { unit: u1.id, client: cl, discount: 5 })
  assert.equal((await lastBooking(cl)).approval, null)
  await act(S1, 'createBooking', { unit: u2.id, client: cl, discount: 15 })
  const b = await lastBooking(cl)
  assert.equal(b.approval, 'pending', 'скидка 15% у сейлза (порог 10%) не ушла на согласование')
  const conf = await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-1' })
  assert.notEqual((await booking(b.id)).status, 'confirmed', 'бэк-офис подтвердил бронь до согласования скидки')
  await act(MH, 'bookingAction', { id: b.id, act: 'approve' })
  assert.equal((await booking(b.id)).approval, 'approved')
})
test('скидка больше потолка пула — ошибка', async () => {
  const cl = (await register(S1)).result.id
  const r = await act(S1, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 35 })
  assert.ok(r.result?.error, 'скидка 35% прошла')
})
test('подтверждение бэк-офисом с № брони застройщика; партнёр и сейлз подтвердить не могут', async () => {
  const cl = (await register(S1)).result.id
  await act(S1, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(S1, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-X' })
  assert.equal((await booking(b.id)).status, 'requested', 'сейлз подтвердил бронь')
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-777', until: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) })
  const x = await booking(b.id)
  assert.equal(x.status, 'confirmed'); assert.equal(x.dev_booking_no, 'QA-777')
})
test('отклонение с причиной из списка', async () => {
  const cl = (await register(S1)).result.id
  await act(S1, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'reject', reason: 'developer_refused' })
  const x = await booking(b.id)
  assert.equal(x.status, 'declined'); assert.equal(x.decline_reason, 'developer_refused')
})
test('лимит застройщика: сверх лимита — очередь (Queued), освободилось место — следующий в Requested (tick)', async () => {
  const pr = await project('brabus-island-baku')
  const cid = (await one(`select (portal.cur_conditions($1)).id`, [pr.id])).id
  const used = (await one(`select count(*)::int n from portal.bookings where project_id = $1 and status in ('requested','confirmed','release_pending')`, [pr.id])).n
  await q(`update portal.conditions set max_bookings_total = $2, max_bookings_client = 10 where id = $1`, [cid, used + 1])
  const cl = (await register(S1)).result.id
  const a = await freeUnit('brabus-island-baku'), b = await freeUnit('brabus-island-baku', { exclude: [a.id] })
  await act(S1, 'createBooking', { unit: a.id, client: cl, discount: 0 })
  const first = await lastBooking(cl)
  await act(S1, 'createBooking', { unit: b.id, client: cl, discount: 0 })
  const second = await lastBooking(cl)
  assert.equal(first.status, 'requested'); assert.equal(second.status, 'queued', 'сверх лимита не встал в очередь')
  await act(S1, 'bookingAction', { id: first.id, act: 'cancel' })
  await tick()
  assert.equal((await booking(second.id)).status, 'requested', 'очередь не продвинулась')
  await q(`update portal.conditions set max_bookings_total = 5 where id = $1`, [cid])
})
test('конец подтверждённой брони → Release pending (квартира ещё «бронь») → бэк-офис подтверждает снятие → свободна', async () => {
  const cl = (await register(S1)).result.id
  const u = await freeUnit()
  await act(S1, 'createBooking', { unit: u.id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-R' })
  await q(`update portal.bookings set ends_at = now() - interval '1 minute' where id = $1`, [b.id])
  await tick()
  assert.equal((await booking(b.id)).status, 'release_pending')
  await act(OF, 'bookingAction', { id: b.id, act: 'release_confirm' })
  assert.equal((await booking(b.id)).status, 'expired')
})
test('холд истекает сам через 24 ч (tick)', async () => {
  const cl = (await register(S1)).result.id
  const u = await freeUnit()
  await act(S1, 'holdUnit', { unit: u.id, client: cl })
  const b = await lastBooking(cl)
  await q(`update portal.bookings set ends_at = now() - interval '1 minute' where id = $1`, [b.id])
  await tick()
  assert.equal((await booking(b.id)).status, 'expired')
})
test('повторный холд той же квартиры тем же сейлзом — не раньше чем через 24 ч', async () => {
  const cl = (await register(S1)).result.id
  const u = await freeUnit()
  await act(S1, 'holdUnit', { unit: u.id, client: cl })
  const b = await lastBooking(cl)
  await act(S1, 'bookingAction', { id: b.id, act: 'release_hold' })
  await act(S1, 'holdUnit', { unit: u.id, client: cl })
  assert.equal((await lastBooking(cl)).id, b.id, 'повторный холд поставлен раньше 24 часов')
})
test('270: переговоры о цене выключены на рынке — сейлз не бронирует, руководитель Global может', async () => {
  const cl = (await register(S1)).result.id
  await q(`update portal.markets set price_negotiation = false where code = 'DE'`)
  try {
    const r = await act(S1, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
    assert.ok(r.result?.error && /Global/.test(r.result.error), JSON.stringify(r))
    const G = await user('market_head', { market: 'GLOBAL' })
    const ok = await act(G, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
    assert.ok(ok.redirect, 'руководитель Global не смог: ' + JSON.stringify(ok))
  } finally { await q(`update portal.markets set price_negotiation = true where code = 'DE'`) }
})
test('продление брони — один раз', async () => {
  const cl = (await register(S1)).result.id
  await act(S1, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(S1, 'bookingAction', { id: b.id, act: 'extend' })
  const x1 = await booking(b.id)
  await act(S1, 'bookingAction', { id: b.id, act: 'extend' })
  const x2 = await booking(b.id)
  assert.ok(x1.extended); assert.equal(String(x1.ends_at), String(x2.ends_at), 'продлили дважды')
})
