// QA 2.2 · 20 Ответ Дениса на 344/314 (11.11): ставка застройщика — по рынку сделки; ставки партнёра и рекомендателя — на пару «проект и рынок»;
// условия, где партнёр + консультант + рекомендатель больше нашего фикса на рынке, не сохраняются
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, freeUnit, q, one, close, act, lastBooking } from './h.mjs'

after(close)
let OW, SIL, BR
test('setup', async () => {
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
  OW = await user('owner', { market: null }); SIL = await user('seller', { market: 'IL' })
  BR = await one(`select p.id, k.rates_by_market from public.projects p cross join lateral portal.cur_conditions(p.id) k where p.slug = 'brabus-island-baku'`)
  assert.equal(Number(BR.rates_by_market?.IL), 2.5, 'у BRABUS нет ставки Израиля 2,5 % (базовые условия 11.11)')
})
test('бронь клиента из Израиля по BRABUS: фикс 2,5 % от прайса, партнёру 1 %, рекомендателю 0,5 %', async () => {
  const cl = (await register(SIL)).result.id
  assert.equal((await one('select market from portal.clients where id = $1', [cl])).market, 'IL')
  const u = await freeUnit('brabus-island-baku')
  const r = await act(SIL, 'createBooking', { unit: u.id, client: cl, discount: '0' })
  assert.ok(!r.result?.error, JSON.stringify(r.result))
  const b = await lastBooking(cl)
  assert.equal(Number(b.snapshot.fix_pct), 2.5, 'в брони не ставка рынка сделки: ' + b.snapshot.fix_pct)
  assert.equal(b.snapshot.rate_market, 'IL')
  assert.equal(Number(b.snapshot.agent_fix_pct), 1); assert.equal(Number(b.snapshot.referrer_pct), 0.5)
  assert.equal(b.snapshot.fix_base, 'list'); assert.ok(Math.abs(b.snapshot.split.fix - Number(b.price_list) * 0.025) < 1, `фикс Арада не от прайса: ${b.snapshot.split.fix} при прайсе ${b.price_list}`)
  await act(SIL, 'bookingAction', { id: b.id, act: 'cancel' })
})
test('ставка рынка, при которой доли больше нашего фикса, не сохраняется', async () => {
  const r = await act(OW, 'saveAgentRateState', { project: BR.id, who: 'market:IL', fix: '2', pool: '10', ref: '1' })
  assert.match(JSON.stringify(r.result || r), /больше нашего фикса/, 'ставка 2 % + консультант + рекомендатель при фиксе 2,5 % сохранилась')
  assert.equal((await one(`select count(*)::int n from portal.agent_rates where project_id = $1 and market = 'IL' and agent_fix_pct = 2`, [BR.id])).n, 0)
})
