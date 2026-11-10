// QA 2.2 · 17 Калькулятор вариантов, этап 3: варианты в подборке (до трёх на квартиру, несогласованный клиенту не уходит),
// страница клиента с расчётом и «Мне подходит», бронь из варианта (план и согласованная скидка переносятся)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, freeUnit, q, one, close, act, page, lastBooking } from './h.mjs'

after(close)
let S, H, u, cl, sel, cond
const saveV = async (name, disc) => {
  await act(S, 'saveVariant', { unit: u.id, client: cl, name, params: JSON.stringify({ downPct: 40, months: 12, disc }) })
  return one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 and name = $3 order by created_at desc limit 1`, [u.id, S.id, name])
}
test('setup: сейлз, клиент, квартира в подборке, варианты', async () => {
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
  S = await user('seller'); H = await user('market_head')
  u = await freeUnit()
  cl = (await register(S)).result.id
  await act(S, 'addToSelection', { client: cl, unit: u.id })
  sel = await one(`select s.id, s.token from portal.selections s join portal.selection_items i on i.selection_id = s.id where s.client_id = $1 and i.unit_id = $2`, [cl, u.id])
  assert.ok(sel, 'подборка не создана')
  cond = await one(`select seller_self_disc::float self, seller_max_disc::float max from portal.conditions where id = (select (portal.cur_conditions($1)).id)`, [u.project_id])
})
test('в подборку — до трёх вариантов; несогласованный не прикрепляется', async () => {
  const vs = []
  for (let i = 0; i < 4; i++) vs.push(await saveV(`QA вариант ${i + 1}`, 0))
  const over = await saveV('QA скидка сверх порога', Math.min(cond.max, cond.self + 1))
  assert.ok(over.needs_approval, 'вариант сверх порога не требует согласования')
  await act(S, 'selectionUpdate', { id: sel.id, vunit: u.id, [`vars:${u.id}`]: [over.id, ...vs.map((v) => v.id)] })
  const at = await q('select variant_id from portal.selection_variants where selection_id = $1 and unit_id = $2', [sel.id, u.id])
  assert.equal(at.length, 3, 'не три варианта: ' + at.length)
  assert.ok(!at.some((x) => x.variant_id === over.id), 'несогласованный вариант прикреплён к подборке')
  // после согласования — можно
  await act(H, 'approveVariant', { id: over.id })
  await act(S, 'selectionUpdate', { id: sel.id, vunit: u.id, [`vars:${u.id}`]: [over.id, vs[0].id] })
  const at2 = (await q('select variant_id from portal.selection_variants where selection_id = $1 and unit_id = $2', [sel.id, u.id])).map((x) => x.variant_id)
  assert.deepEqual(at2.sort(), [over.id, vs[0].id].sort(), 'снятые галочки не сняли варианты или согласованный не прикрепился')
})
test('чужую подборку не меняют: сейлз не автор — заметка и варианты не сохраняются', async () => {
  const S2 = await user('seller')
  await act(S2, 'selectionUpdate', { id: sel.id, [`note:${u.id}`]: 'QA чужая заметка', vunit: u.id })
  assert.notEqual((await one('select note from portal.selection_items where selection_id = $1 and unit_id = $2', [sel.id, u.id])).note, 'QA чужая заметка', 'не автор поменял заметку')
  assert.ok((await one('select count(*)::int n from portal.selection_variants where selection_id = $1', [sel.id])).n > 0, 'не автор снял варианты')
})
test('страница клиента: варианты на языке подборки, без комиссий; «Мне подходит» → консультанту уведомление', async () => {
  await act(S, 'selectionUpdate', { id: sel.id, lang: 'en' })
  const p = await page(null, `/s/${sel.token}?preview=1`)
  assert.equal(p.status, 200)
  assert.ok(p.html.includes('Option 1') && p.html.includes('Payment options'), 'вариантов нет на странице клиента или не по-английски')
  assert.ok(!p.html.includes('QA вариант') && !p.html.includes('QA скидка'), 'клиенту видно внутреннее название варианта')
  assert.match(p.html, /<html lang="en"/, 'язык страницы не совпадает с языком подборки')
  // сотрудник со своим входом — не клиент: «открывал» не растёт
  const { cookie, BASE } = await import('./h.mjs')
  const before = (await one('select opened from portal.selections where id = $1', [sel.id])).opened
  await fetch(`${BASE}/s/${sel.token}`, { headers: { host: 'portal.pdna.pro', cookie: `ge_s=${await cookie(S)}` } })
  assert.equal((await one('select opened from portal.selections where id = $1', [sel.id])).opened, before, 'сотрудник засчитан как клиент, открывший подборку')
  assert.ok(!/commission|комисс|pool|пул/i.test(p.html.replace(/<script[\s\S]*?<\/script>/g, '')), 'на странице клиента — комиссия или пул')
  const v1 = await one(`select variant_id from portal.selection_variants where selection_id = $1 and sort = (select min(sort) from portal.selection_variants where selection_id = $1)`, [sel.id])
  await act(null, 'likeSelVariant', { token: sel.token, variant: v1.variant_id })
  assert.ok((await one('select liked_at from portal.selection_variants where selection_id = $1 and variant_id = $2', [sel.id, v1.variant_id])).liked_at, '«подходит» не записан')
  assert.ok(await one(`select 1 from portal.notifications where user_id = $1 and text like 'Клиенту подходит вариант%'`, [S.id]), 'консультанту не пришло уведомление')
})
test('бронь из согласованного варианта: скидка сверх порога не уходит на повторное согласование, вариант — в брони', async () => {
  const over = await one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 and name = 'QA скидка сверх порога'`, [u.id, S.id])
  const r = await act(S, 'createBooking', { unit: u.id, client: cl, discount: String(over.params.disc), variant: over.id, plan: over.params.planId || '' })
  assert.ok(!r.result?.error, JSON.stringify(r.result))
  const b = await lastBooking(cl)
  assert.equal(b.approval, null, 'согласованная скидка варианта ушла на повторное согласование')
  assert.equal(b.snapshot.variant?.id, over.id, 'вариант не записан в бронь')
  assert.equal(Number(b.snapshot.variant.downPct), 40)
  await act(S, 'bookingAction', { id: b.id, act: 'cancel' })
  // без варианта та же скидка — на согласование
  const r2 = await act(S, 'createBooking', { unit: u.id, client: cl, discount: String(over.params.disc) })
  assert.ok(!r2.result?.error, JSON.stringify(r2.result))
  assert.equal((await lastBooking(cl)).approval, 'pending', 'скидка сверх порога без варианта прошла без согласования')
  await act(S, 'bookingAction', { id: (await lastBooking(cl)).id, act: 'cancel' })
})
