// QA 2.2 · 12 Гонки: два запроса на одну квартиру одновременно, один человек от двух сейлзов одновременно, двойной приём транша
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, freeUnit, q, one, close, act, phone, lastBooking } from './h.mjs'

after(close)
test('одна квартира — два запроса брони одновременно: активна одна', async () => {
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
  const S1 = await user('seller'), S2 = await user('seller')
  const c1 = (await register(S1)).result.id, c2 = (await register(S2)).result.id
  const u = await freeUnit()
  await Promise.all([act(S1, 'createBooking', { unit: u.id, client: c1, discount: 0 }), act(S2, 'createBooking', { unit: u.id, client: c2, discount: 0 })])
  const n = (await one(`select count(*)::int n from portal.bookings where unit_id = $1 and status in ('hold','queued','requested','confirmed','release_pending')`, [u.id])).n
  assert.equal(n, 1, `на одну квартиру активных броней: ${n}`)
})
test('одна квартира — два холда одновременно: один', async () => {
  const S1 = await user('seller'), S2 = await user('seller')
  const c1 = (await register(S1)).result.id, c2 = (await register(S2)).result.id
  const u = await freeUnit()
  await Promise.all([act(S1, 'holdUnit', { unit: u.id, client: c1 }), act(S2, 'holdUnit', { unit: u.id, client: c2 })])
  const n = (await one(`select count(*)::int n from portal.bookings where unit_id = $1 and status = 'hold'`, [u.id])).n
  assert.equal(n, 1, `холдов на одну квартиру: ${n}`)
})
test('один человек — два сейлза регистрируют одновременно: один клиент', async () => {
  const S1 = await user('seller'), S2 = await user('seller')
  const ph = phone()
  await Promise.all([register(S1, { phone: ph }), register(S2, { phone: ph })])
  const n = (await one(`select count(*)::int n from portal.clients where right(phone_norm, 9) = right($1, 9) and attach_status <> 'junk'`, [ph.replace(/\D/g, '')])).n
  assert.equal(n, 1, `закреплено клиентов с одним телефоном: ${n}`)
})
test('двойной приём одного транша: начисления один раз', async () => {
  const S = await user('seller'), OF = await user('office'), FI = await user('finance')
  const cl = (await register(S)).result.id
  await act(S, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'R' })
  await q(`update portal.clients set kyc_status = 'passed' where id = $1`, [cl])
  await act(OF, 'bookingAction', { id: b.id, act: 'contract' })
  const d = await one('select id from portal.deals where client_id = $1', [cl])
  await act(FI, 'dealPaid', { id: d.id, paid: 10 })
  const t = await one('select id from portal.tranches where deal_id = $1', [d.id])
  await Promise.all([act(FI, 'trancheReceived', { id: t.id }), act(FI, 'trancheReceived', { id: t.id })])
  const n = (await one(`select count(*)::int n from portal.accruals where tranche_id = $1 and role = 'seller'`, [t.id])).n
  assert.equal(n, 1, `начислений сейлзу по одному траншу: ${n}`)
})
test('двойное «Договор подписан»: одна сделка', async () => {
  const S = await user('seller'), OF = await user('office')
  const cl = (await register(S)).result.id
  await act(S, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'R2' })
  await q(`update portal.clients set kyc_status = 'passed' where id = $1`, [cl])
  await Promise.all([act(OF, 'bookingAction', { id: b.id, act: 'contract' }), act(OF, 'bookingAction', { id: b.id, act: 'contract' })])
  const n = (await one('select count(*)::int n from portal.deals where client_id = $1', [cl])).n
  assert.equal(n, 1, `сделок: ${n}`)
  const sh = (await one('select count(*)::int n from portal.deal_shares s join portal.deals d on d.id = s.deal_id where d.client_id = $1', [cl])).n
  assert.ok(sh > 0 && sh < 8, `долей: ${sh}`)
})
