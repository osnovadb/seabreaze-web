// Прайс-листы и журнал квартиры (d47d993): черновик → публикация → откат, гонка двух вкладок, пропуск изменённых квартир,
// права, автор в журнале при правке в Объектах → Квартиры. Работаем на «Тест · Marina Village»; цены квартир возвращаем как были.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, forms, formWith, submit, type Form } from './_portal'

const MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f', BR = '00000000-0000-0000-0000-0000000000a1'
const U601 = 'eef33d4a-da9a-4d5f-b4c8-381a1c37f2ea', U602 = '807045c5-818f-4ce8-a992-baf8f30c2379', U101 = 'bb8a8393-6287-41e2-853d-9b75b444d525'
let db: pg.Client, prices0: { id: string; price_list: string | null; status: string }[] = []
const lists: string[] = [], units: string[] = []
const t0 = new Date()

const price = async (id: string) => (await db.query('select price_list::float p from units where id=$1', [id])).rows[0].p as number | null
const marina = async () => Object.fromEntries((await db.query(`select id, price_list::float p from units where project_id=$1`, [MARINA])).rows.map((r) => [r.id, r.p]))
// Новый черновик через форму /admin/prices; возвращает id прайс-листа
async function draft(c: string, pid: string, values: Record<string, string>, extra: [string, string][] = []) {
  const f = formWith((await page(c, `/admin/prices?p=${pid}`)).html, 'op', 'value'); assert.ok(f, 'форма нового прайс-листа')
  const before = new Date()
  const fd = { ...f!, fields: f!.fields.filter(([k]) => !['statuses', 'rooms', 'types', 'buildings', 'layouts', ...Object.keys(values)].includes(k)).concat(extra) }
  await submit(c, `/admin/prices?p=${pid}`, fd, values)
  const id = (await db.query(`select id from portal.price_lists where project_id=$1 and created_at >= $2 order by created_at desc limit 1`, [pid, before])).rows[0]?.id
  if (id) lists.push(id)
  return id as string | undefined
}
const listForm = async (c: string, id: string, re: RegExp) => forms((await page(c, `/admin/prices/${id}`)).html).find((f) => re.test(f.html) && f.fields.some(([k, v]) => k === 'id' && v === id))
const items = async (id: string) => (await db.query(`select unit_id, old_price::float, new_price::float, applied from portal.price_list_items where list_id=$1 order by unit_id`, [id])).rows

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  prices0 = (await db.query(`select id, price_list, status from units where project_id=$1`, [MARINA])).rows
})
after(async () => {
  if (SKIP) return
  for (const u of prices0) await db.query(`update units set price_list=$2, status=$3 where id=$1 and (price_list is distinct from $2 or status is distinct from $3)`, [u.id, u.price_list, u.status])
  await db.query('delete from portal.posts where auto_key = any($1)', [lists.map((l) => 'prices:' + l)])
  await db.query('delete from portal.price_lists where id = any($1)', [lists])
  await db.query('delete from units where id = any($1)', [units])
  // журнал: наши прайс-листы, вставленные квартиры и откат цен в after
  await db.query(`delete from portal.unit_events where (source = any($1) or unit_id = any($2) or (unit_id in (select id from units where project_id=$3) and at >= $4))`, [lists.map((l) => 'pricelist:' + l), units, MARINA, t0])
  await db.end()
})

test('прайс-листы: агент, продавец, руководитель рынка не открывают и не вызывают действия; офис — может', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  for (const who of [U.agent, U.seller, U.head]) {
    const c = await login(who)
    assert.notEqual((await page(c, `/admin/prices?p=${MARINA}`)).status, 200, who)
  }
  const id = (await draft(o, MARINA, { op: 'pct', value: '3', statuses: 'available' }))!
  assert.ok(id)
  const pub = (await listForm(o, id, /Опубликовать|Publish/))!
  for (const who of [U.agent, U.seller, U.head]) {
    const c = await login(who)
    await submit(c, `/admin/prices/${id}`, pub, {})
    assert.equal((await db.query('select status from portal.price_lists where id=$1', [id])).rows[0].status, 'draft', `${who} опубликовал`)
    const f = formWith((await page(o, `/admin/prices?p=${MARINA}`)).html, 'op', 'value')!
    const n = (await db.query('select count(*)::int n from portal.price_lists')).rows[0].n
    await submit(c, `/admin/prices?p=${MARINA}`, f, { op: 'pct', value: '5', title: 'QA чужой' })
    assert.equal((await db.query('select count(*)::int n from portal.price_lists')).rows[0].n, n, `${who} создал прайс-лист`)
  }
  assert.equal((await page(await login(U.office), `/admin/prices?p=${MARINA}`)).status, 200, 'офис')
})

test('публикация и откат: цены, журнал с прайс-листом и автором, пост в ленте; откат возвращает и удаляет пост', { skip: SKIP }, async () => {
  const c = await login(U.office), office = (await db.query('select id from portal.users where email=$1', [U.office])).rows[0].id
  const p0 = await marina()
  const id = (await draft(c, MARINA, { op: 'pct', value: '2', round: '1000', title: 'QA +2%', statuses: 'available' }))!
  const its = await items(id)
  assert.ok(its.length >= 6)
  for (const i of its) assert.equal(i.new_price, Math.round(p0[i.unit_id] * 1.02 / 1000) * 1000)
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Опубликовать|Publish/))!, {})
  for (const i of its) assert.equal(await price(i.unit_id), i.new_price)
  const ev = (await db.query(`select unit_id, user_id, old_price::float, new_price::float from portal.unit_events where source=$1`, ['pricelist:' + id])).rows
  assert.equal(ev.length, its.length); assert.ok(ev.every((e) => e.user_id === office), 'автор в журнале — офис')
  assert.equal((await db.query(`select count(*)::int n from portal.posts where auto_key=$1`, ['prices:' + id])).rows[0].n, 1, 'пост «Новые цены»')
  // карточка квартиры: команда видит историю с прайс-листом, партнёр — нет
  assert.ok((await page(await login(U.owner), `/units/${its[0].unit_id}`)).html.includes('QA +2%'))
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Откатить|Roll back|Revert/))!, {})
  assert.deepEqual(await marina(), p0)
  assert.equal((await db.query('select status from portal.price_lists where id=$1', [id])).rows[0].status, 'reverted')
  assert.equal((await db.query(`select count(*)::int n from portal.posts where auto_key=$1`, ['prices:' + id])).rows[0].n, 0)
})

test('две вкладки: двойная публикация применяет цены один раз; двойной откат — тоже', { skip: SKIP }, async () => {
  const c = await login(U.owner), p0 = await marina()
  const id = (await draft(c, MARINA, { op: 'pct', value: '10', round: '1', title: 'QA двойной', statuses: 'available' }))!
  const pub = (await listForm(c, id, /Опубликовать|Publish/))!
  await Promise.all([submit(c, `/admin/prices/${id}`, pub, {}), submit(c, `/admin/prices/${id}`, pub, {}), submit(c, `/admin/prices/${id}`, pub, {})])
  for (const i of await items(id)) assert.equal(await price(i.unit_id), i.new_price, 'цена применена не один раз')
  assert.equal((await db.query(`select count(*)::int n from portal.unit_events where source=$1`, ['pricelist:' + id])).rows[0].n, (await items(id)).length)
  const rev = (await listForm(c, id, /Откатить|Roll back|Revert/))!
  await Promise.all([submit(c, `/admin/prices/${id}`, rev, {}), submit(c, `/admin/prices/${id}`, rev, {})])
  assert.deepEqual(await marina(), p0)
})

test('квартира, чью цену поменяли между расчётом и публикацией, пропускается; откат не трогает изменённые после публикации', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  const id = (await draft(c, MARINA, { op: 'pct', value: '5', round: '1', title: 'QA пропуск', statuses: 'available' }))!
  await db.query('update units set price_list = 149999 where id=$1', [U601])
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Опубликовать|Publish/))!, {})
  assert.equal(await price(U601), 149999, 'цена изменённой квартиры перезаписана')
  assert.equal((await items(id)).find((i) => i.unit_id === U601).applied, false)
  // после публикации кто-то поменял 602 — откат её не трогает, остальные возвращает
  await db.query('update units set price_list = 170001 where id=$1', [U602])
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Откатить|Roll back|Revert/))!, {})
  assert.equal(await price(U602), 170001)
  const i101 = (await items(id)).find((i) => i.unit_id === U101)
  assert.equal(await price(U101), i101.old_price)
})

test('«Установить цену» квартире без цены и откат: цена снова пустая, а не 0', { skip: SKIP }, async () => {
  const b = (await db.query(`select building_id from units where id=$1`, [U101])).rows[0].building_id
  const u = (await db.query(`insert into units (project_id, building_id, number, floor, unit_type, area_total_m2, status, price_currency, source_id) values ($1,$2,'QA-901',9,'1br',50,'available','USD','manual') returning id`, [MARINA, b])).rows[0].id
  units.push(u)
  const c = await login(U.owner)
  const id = (await draft(c, MARINA, { op: 'set', value: '200000', currency: 'USD', round: '1', title: 'QA set', floor_from: '9', floor_to: '9', statuses: 'available' }))!
  assert.deepEqual((await items(id)).map((i) => [i.unit_id, i.old_price, i.new_price]), [[u, null, 200000]])
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Опубликовать|Publish/))!, {})
  assert.equal(await price(u), 200000)
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Откатить|Roll back|Revert/))!, {})
  assert.equal(await price(u), null, 'после отката у квартиры цена 0 вместо пустой')
})

test('«Прибавить сумму» в USD: квартиры в AZN не попадают в прайс-лист (BRABUS, только черновик)', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  const id = (await draft(c, BR, { op: 'add', value: '1000', currency: 'USD', round: '1', title: 'QA add USD', statuses: 'available' }))!
  const cur = (await db.query(`select distinct u.price_currency c from portal.price_list_items i join units u on u.id=i.unit_id where i.list_id=$1`, [id])).rows.map((r) => r.c)
  assert.deepEqual(cur, ['USD'])
  for (const i of await items(id)) assert.equal(i.new_price - i.old_price, 1000)
})

test('шаг по этажам: на базовом этаже и ниже цена не меняется (и не округляется)', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  await db.query('update units set price_list = 150499 where id=$1', [U101]) // этаж 1, «некруглая» цена
  const id = (await draft(c, MARINA, { op: 'floor_step', value: '1', base_floor: '3', round: '1000', title: 'QA шаг', statuses: 'available' }))!
  const fl = Object.fromEntries((await db.query(`select id, floor from units where project_id=$1`, [MARINA])).rows.map((r) => [r.id, r.floor]))
  const its = await items(id)
  assert.ok(its.length > 0 && its.every((i) => fl[i.unit_id] > 3), `в прайс-лист попали этажи ≤ базового: ${its.filter((i) => fl[i.unit_id] <= 3).map((i) => fl[i.unit_id] + ': ' + i.old_price + ' → ' + i.new_price).join(', ')}`)
})

test('правка квартиры в Объектах → Квартиры пишет в журнал автора (владелец и офис)', { skip: SKIP }, async () => {
  for (const who of [U.owner, U.office]) {
    const c = await login(who), uid = (await db.query('select id from portal.users where email=$1', [who])).rows[0].id
    const path = `/admin/objects/${MARINA}?tab=units`
    const f = forms((await page(c, path)).html).find((x) => x.fields.some(([k, v]) => k === 'id' && v === U601) && x.fields.some(([k]) => k === 'price'))
    assert.ok(f, `${who}: форма квартиры 601`)
    const u = (await db.query('select building_id, layout_id, price_currency, status, published, price_list::float p from units where id=$1', [U601])).rows[0]
    const np = String((u.p || 150000) + 1000)
    await submit(c, path, f!, { price: np, building: u.building_id, layout: u.layout_id || '', currency: u.price_currency, status: u.status, published: u.published ? 'on' : '' })
    assert.equal(await price(U601), Number(np), `${who}: цена не сохранилась`)
    const e = (await db.query(`select user_id, source from portal.unit_events where unit_id=$1 and kind='price' order by id desc limit 1`, [U601])).rows[0]
    assert.deepEqual(e, { user_id: uid, source: 'portal' }, who)
  }
})

test('публикация пропускает квартиру, которую продали между расчётом и публикацией (202f0a1)', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  const id = (await draft(c, MARINA, { op: 'pct', value: '4', round: '1', title: 'QA статус', statuses: 'available' }))!
  const p601 = await price(U601)
  await db.query(`update units set status='sold' where id=$1`, [U601])
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Опубликовать|Publish/))!, {})
  assert.equal(await price(U601), p601, 'цена проданной квартиры изменена')
  assert.equal((await items(id)).find((i) => i.unit_id === U601).applied, false)
  await submit(c, `/admin/prices/${id}`, (await listForm(c, id, /Откатить|Roll back|Revert/))!, {})
})
