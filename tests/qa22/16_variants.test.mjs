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
