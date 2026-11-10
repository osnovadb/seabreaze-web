// QA 2.2 · 19 Ответ Дениса на 361/349/373 (11.11): сетка «взнос и срок» — максимум скидки (пул плана), а не вычет;
// предел сейлза и своя часть партнёра — в пределах пула плана; «Попросить больше» — только когда своя часть отдана целиком
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, register, freeUnit, q, one, close, act, lastBooking } from './h.mjs'

let S, H, u, PR
after(async () => { if (PR) await q(`delete from portal.down_discounts where project_id = $1 and note = 'QA 19'`, [PR]); await close() })
const lastVariant = (uid, author) => one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 order by created_at desc limit 1`, [uid, author])
test('setup: сетка Арада «30 % на 36 мес. → 8 %» на тестовом проекте', async () => {
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
  S = await user('seller')
  const ag = await agency('DE'); H = await user('agency_head', { agency_id: ag.id })
  u = await freeUnit(); PR = u.project_id
  await q(`insert into portal.down_discounts (project_id, from_pct, max_months, discount_pct, note) values ($1, 30, 36, 8, 'QA 19')`, [PR])
})
test('сейлз: скидка не больше пула плана (8 %), цена клиента = прайс − скидка, автоматического вычета нет', async () => {
  await act(S, 'saveVariant', { unit: u.id, name: 'QA19 сейлз', params: JSON.stringify({ downPct: 30, months: 36, disc: 15 }) })
  const v = await lastVariant(u.id, S.id)
  assert.equal(Number(v.params.disc), 8, 'скидка не обрезана пулом плана: ' + v.params.disc)
  assert.ok(Math.abs(v.snapshot.total - u.price * 0.92) < 1, `цена ${v.snapshot.total} ≠ прайс ${u.price} − 8 %`)
  await act(S, 'saveVariant', { unit: u.id, name: 'QA19 без скидки', params: JSON.stringify({ downPct: 30, months: 36, disc: 0 }) })
  assert.ok(Math.abs((await lastVariant(u.id, S.id)).snapshot.total - u.price) < 1, 'без скидки цена ниже прайса — остался автоматический вычет')
})
test('бронь из варианта: пул плана — в снимке брони; скидка сверх пула не принимается', async () => {
  const cl = (await register(S)).result.id
  const v = await one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 and name = 'QA19 сейлз'`, [u.id, S.id])
  const over = await act(S, 'createBooking', { unit: u.id, client: cl, discount: '9', variant: v.id })
  assert.match(JSON.stringify(over.result || over), /только по запросу/, 'скидка сверх пула плана принята')
  const ok = await act(S, 'createBooking', { unit: u.id, client: cl, discount: '8', variant: v.id })
  assert.ok(!ok.result?.error, JSON.stringify(ok.result))
  const b = await lastBooking(cl)
  assert.equal(Number(b.snapshot.plan_pool), 8); assert.equal(b.snapshot.plan_pool_source, 'grid')
  assert.equal(Number(b.snapshot.pool_pct), 8, 'раздел денег брони не от пула плана')
  await act(S, 'bookingAction', { id: b.id, act: 'cancel' })
})
test('партнёр: своя часть — доля пула плана; «Попросить больше» — только когда своя часть отдана целиком', async () => {
  const k = await one('select pool_pct::float pool, agent_pool_pct::float own from portal.conditions where id = (select (portal.cur_conditions($1)).id)', [PR])
  const part = Math.round(8 * k.own / k.pool * 1e4) / 1e4
  await act(H, 'saveVariant', { unit: u.id, name: 'QA19 партнёр', params: JSON.stringify({ downPct: 30, months: 36, disc: part }) })
  const v = await lastVariant(u.id, H.id)
  assert.equal(Number(v.params.disc), part); assert.equal(v.needs_approval, false)
  const r1 = await act(H, 'saveVariant', { unit: u.id, params: JSON.stringify({ downPct: 30, months: 36, disc: part + 1 }) })
  assert.match(JSON.stringify(r1.result || r1), /Попросить больше/, 'сверх своей части без запроса сохранилось')
  const r2 = await act(H, 'saveVariant', { unit: u.id, params: JSON.stringify({ downPct: 30, months: 36, disc: 0 }), ask_pct: String(part + 2) })
  assert.match(JSON.stringify(r2.result || r2), /Сначала отдайте/, '«Попросить больше» при неотданной своей части принят')
  await act(H, 'saveVariant', { unit: u.id, name: 'QA19 запрос', params: JSON.stringify({ downPct: 30, months: 36, disc: part }), ask_pct: String(part + 2) })
  const a = await lastVariant(u.id, H.id)
  assert.ok(a.needs_approval && Number(a.params.disc) === part + 2, 'запрос после своей части не ушёл на согласование: ' + JSON.stringify(a.params))
})
