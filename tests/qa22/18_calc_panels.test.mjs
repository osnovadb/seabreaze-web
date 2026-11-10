// QA 2.2 · 18 Калькулятор вариантов, этап 4: калькулятор в боковой панели шахматки и во вкладке «Расчёт» карточки клиента в Bitrix24
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, freeUnit, one, close, act, page } from './h.mjs'

after(close)
let S, u, cl
test('setup', async () => {
  S = await user('seller')
  u = await freeUnit()
  cl = (await register(S)).result.id
  await act(S, 'addToSelection', { client: cl, unit: u.id })
})
test('шахматка: в панели выбранной квартиры — калькулятор вариантов', async () => {
  const b = await one(`select u.building_id, p.slug from public.units u join public.projects p on p.id = u.project_id where u.id = $1`, [u.id])
  const p = await page(S, `/projects/${b.slug}/chess?b=${b.building_id}&u=${u.id}`)
  assert.equal(p.status, 200, 'шахматка не открылась: ' + p.status)
  assert.ok(p.html.includes('upanel__calc') && p.html.includes('Калькулятор вариантов'), 'в панели шахматки нет калькулятора')
})
test('Bitrix24 → вкладка «Расчёт»: квартиры клиента, вариант сохраняется на клиента и виден только у него', async () => {
  const p = await page(S, `/b24/units/${cl}?tab=calc`)
  assert.equal(p.status, 200)
  assert.ok(p.html.includes(`tab=calc&amp;u=${u.id}`) || p.html.includes(`tab=calc&u=${u.id}`), 'нет квартиры клиента во вкладке «Расчёт»')
  assert.ok(p.html.includes('vcalc'), 'нет калькулятора во вкладке «Расчёт»')
  await act(S, 'saveVariant', { unit: u.id, client: cl, name: 'QA этап 4 · на клиента', params: JSON.stringify({ downPct: 40, months: 12, disc: 0 }) })
  await act(S, 'saveVariant', { unit: u.id, name: 'QA этап 4 · без клиента', params: JSON.stringify({ downPct: 50, months: 6, disc: 0 }) })
  const p2 = await page(S, `/b24/units/${cl}?tab=calc&u=${u.id}`)
  assert.ok(p2.html.includes('QA этап 4 · на клиента'), 'вариант клиента не виден во вкладке')
  assert.ok(!p2.html.includes('QA этап 4 · без клиента'), 'во вкладке клиента — вариант без клиента')
})
