// QA 2.2 · 16 Калькулятор вариантов (этап 2): сохранение с пересчётом на сервере, согласование скидки выше порога, права
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, freeUnit, q, one, close, act } from './h.mjs'

after(close)
test('вариант: суммы считает сервер; скидка выше порога — нужно согласование; согласует руководитель рынка; чужой не удалить', async () => {
  const S = await user('seller'), H = await user('market_head'), S2 = await user('seller')
  const u = await freeUnit()
  const cond = await one(`select seller_self_disc::float self, seller_max_disc::float max from portal.conditions where project_id = $1 and status = 'published' order by valid_from desc, version desc limit 1`, [u.project_id])
  // в браузере можно подсунуть любые суммы — сервер их не берёт
  const disc = Math.min(cond.max, cond.self + 1)
  await act(S, 'saveVariant', { unit: u.id, name: 'QA вариант', params: JSON.stringify({ downPct: 40, months: 12, disc, total: 1 }) })
  const v = await one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 order by created_at desc limit 1`, [u.id, S.id])
  assert.ok(v, 'вариант не сохранён')
  assert.ok(v.snapshot.total > 1000, 'сумма взята из браузера, а не посчитана на сервере: ' + v.snapshot.total)
  assert.equal(v.needs_approval, disc > cond.self, 'пометка согласования не совпадает с порогом сейлза')
  await act(S, 'approveVariant', { id: v.id })
  assert.equal((await one('select approved_at from portal.calc_variants where id = $1', [v.id])).approved_at, null, 'сейлз сам согласовал свою скидку')
  if (v.needs_approval) {
    await act(H, 'approveVariant', { id: v.id })
    assert.ok((await one('select approved_at from portal.calc_variants where id = $1', [v.id])).approved_at, 'руководитель рынка не смог согласовать')
  }
  await act(S2, 'deleteVariant', { id: v.id })
  assert.ok(await one('select 1 from portal.calc_variants where id = $1', [v.id]), 'чужой сейлз удалил вариант')
  await act(S, 'deleteVariant', { id: v.id })
  assert.equal(await one('select 1 from portal.calc_variants where id = $1', [v.id]), undefined, 'автор не смог удалить свой вариант')
})
test('партнёр: скидка — до своей части пула; больше — только «Попросить больше», без показа нашей части', async () => {
  const { agency, register } = await import('./h.mjs')
  const ag = await agency('DE'); const H = await user('agency_head', { agency_id: ag.id })
  const u = await freeUnit()
  const cond = await one(`select agent_pool_pct::float own, pool_pct::float pool from portal.conditions where project_id = $1 and status = 'published' order by valid_from desc, version desc limit 1`, [u.project_id])
  if (!(cond.pool > cond.own)) return // в условиях проекта нет нашей части пула — проверять нечего
  const over = Math.min(cond.pool, cond.own + 1)
  const r1 = await act(H, 'saveVariant', { unit: u.id, params: JSON.stringify({ downPct: 40, months: 12, disc: over }) })
  assert.match(JSON.stringify(r1.result || r1), /Попросить больше/, 'скидка сверх своей части сохранилась без запроса')
  assert.ok(!new RegExp(`\\b${cond.pool}\\b`).test(JSON.stringify(r1.result || r1)), 'в ответе партнёру виден размер пула')
  await act(H, 'saveVariant', { unit: u.id, params: JSON.stringify({ downPct: 40, months: 12, disc: cond.own }), ask_pct: String(over), ask_note: 'QA клиент просит больше' })
  const v = await one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 order by created_at desc limit 1`, [u.id, H.id])
  assert.ok(v && v.needs_approval && Number(v.params.disc) === over, 'запрос «Попросить больше» не сохранил вариант на согласование: ' + JSON.stringify(v?.params))
  // QA 10.11 (Ревью): запрос сверх всего пула принимается на согласование — граница «нельзя» не раскрывает размер пула; отказ — за руководителем рынка
  await act(H, 'saveVariant', { unit: u.id, params: JSON.stringify({ downPct: 40, months: 12, disc: 0 }), ask_pct: String(cond.pool + 5) })
  const v2 = await one(`select * from portal.calc_variants where unit_id = $1 and author_id = $2 order by created_at desc limit 1`, [u.id, H.id])
  assert.ok(v2.needs_approval && Number(v2.params.disc) === cond.pool + 5, 'запрос сверх пула обрезан или не ушёл на согласование: ' + JSON.stringify(v2.params))
  const r3 = await act(H, 'saveVariant', { unit: u.id, params: JSON.stringify({ downPct: 40, months: 12, disc: 0 }), ask_pct: '55' })
  assert.match(JSON.stringify(r3.result || r3), /не запрашивается/, 'запрос сверх нейтрального потолка принят')
  assert.ok(!JSON.stringify(r3.result || r3).includes(String(cond.pool)), 'в ответе партнёру виден размер пула')
  // бронь: сверх своей части без ask — отказ
  const cl = (await register(H, { fields: { goal: 'invest', budget: '200-300k', timeline: '3m' } })).result?.id
  const b = await act(H, 'createBooking', { unit: u.id, client: cl, discount: String(over) })
  assert.match(JSON.stringify(b.result || b), /Попросить больше/, 'бронь со скидкой сверх своей части прошла без запроса: ' + JSON.stringify(b).slice(0, 300))
})
