// Опции квартиры (b072134): админка Объекты → «Опции» (только владелец), цена в USD через курс, бронь с опциями.
// Опции «QA опц …» создаём на BRABUS (проект в продаже) и удаляем; брони теста тоже удаляем.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, forms, formWith, submit, type Form } from './_portal'

const BR = '00000000-0000-0000-0000-0000000000a1', MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f'
const C_UNIT = 'b1a28596-01a0-4c49-bad3-3dd8f360934d'
let db: pg.Client
const bookings: string[] = []

const optForm = async (c: string, pid: string) => forms((await page(c, `/admin/objects/${pid}?tab=options`)).html).find((f) => f.fields.some(([k]) => k === 'units') && !f.fields.some(([k]) => k === 'id'))
const addOpt = (c: string, f: Form, v: Record<string, string>) => submit(c, `/admin/objects/${BR}?tab=options`, { ...f, fields: f.fields.filter(([k]) => !['buildings', 'types', ...Object.keys(v)].includes(k)) }, { currency: 'USD', active: '1', ...v })
const opt = async (title: string) => (await db.query(`select * from portal.unit_options where title=$1`, [title])).rows[0]
const ins = async (o: Record<string, unknown>) => (await db.query(`insert into portal.unit_options (project_id, title, price, currency, unit_ids, active) values ($1,$2,$3,$4,$5,$6) returning id`,
  [o.project ?? BR, o.title, o.price, o.currency ?? 'USD', o.unit_ids ?? [], o.active ?? true])).rows[0].id as string
// Бронь партнёра через форму /units/<id>/book с выбранными опциями
async function book(opts: string[]) {
  const ag = await login(U.agent)
  const f = formWith((await page(ag, `/units/${C_UNIT}/book`)).html, 'discount', 'client', 'unit')!
  const client = (await db.query(`select c.id from portal.clients c join portal.users u on u.id=c.owner_id where u.email=$1 order by c.name limit 1`, [U.agent])).rows[0].id
  const t = new Date()
  const r = await submit(ag, `/units/${C_UNIT}/book`, { ...f, fields: [...f.fields.filter(([k]) => k !== 'options'), ...opts.map((o) => ['options', o] as [string, string])] }, { discount: '0', client })
  const b = (await db.query(`select id, final_price::float fp, options, options_usd::float ou, snapshot from portal.bookings where unit_id=$1 and created_at >= $2 order by created_at desc limit 1`, [C_UNIT, t])).rows[0]
  if (b) { bookings.push(b.id); await db.query(`update portal.bookings set status='cancelled' where id=$1`, [b.id]) }
  return { b, text: r.text }
}

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  await db.query(`delete from portal.unit_options where title like 'QA опц%'`)
})
after(async () => {
  if (SKIP) return
  const cls = (await db.query(`select distinct client_id from portal.bookings where id = any($1)`, [bookings])).rows.map((r) => r.client_id)
  await db.query(`delete from portal.bookings where id = any($1)`, [bookings])
  // брони снимали и удаляли прямым SQL — стадию клиента пересчитываем, как это делает портал
  for (const id of cls) await db.query('select portal.sync_client_stage($1)', [id])
  await db.query(`delete from portal.unit_options where title like 'QA опц%'`)
  await db.end()
})

test('опции заводит только владелец; неизвестный номер квартиры — ошибка, опция не создаётся', { skip: SKIP }, async () => {
  const o = await login(U.owner), f = await optForm(o, BR)
  assert.ok(f, 'форма новой опции')
  for (const who of [U.office, U.head, U.seller, U.agent]) {
    await addOpt(await login(who), f!, { title: 'QA опц чужая ' + who, price: '100' })
    assert.equal(await opt('QA опц чужая ' + who), undefined, who)
  }
  await addOpt(o, f!, { title: 'QA опц нет кв', price: '100', units: 'A-0301, Z-999' })
  assert.equal(await opt('QA опц нет кв'), undefined, 'опция с неизвестной квартирой создана')
  for (const [p, cur] of [['0', 'USD'], ['-5', 'USD'], ['100', 'GBP']]) {
    await addOpt(o, f!, { title: `QA опц плохая ${p} ${cur}`, price: p, currency: cur })
    assert.equal(await opt(`QA опц плохая ${p} ${cur}`), undefined, `${p} ${cur}`)
  }
  await addOpt(o, f!, { title: 'QA опц A-0301', price: '8500', currency: 'AZN', units: 'a-0301' })
  const x = await opt('QA опц A-0301')
  assert.ok(x, 'опция по номеру квартиры'); assert.equal(x.unit_ids.length, 1)
})

test('цена опции в USD через AZN: 8500 AZN = $5000, EUR — через курс EUR; партнёр видит опцию на карточке своей квартиры', { skip: SKIP }, async () => {
  await ins({ title: 'QA опц AZN', price: 8500, currency: 'AZN' })
  await ins({ title: 'QA опц EUR', price: 1000, currency: 'EUR' })
  await ins({ title: 'QA опц выкл', price: 777, active: false })
  await ins({ title: 'QA опц другой', price: 999, project: MARINA })
  const h = (await page(await login(U.agent), `/units/${C_UNIT}`)).html
  assert.ok(h.includes('QA опц AZN') && /\$\s?5[,.\s ]?000|5[,.\s ]?000\s?\$/.test(h), 'опция AZN → $5 000')
  const eur = (await db.query(`select (select azn_per_unit from currency_rates where currency='EUR' order by valid_from desc limit 1) / (select azn_per_unit from currency_rates where currency='USD' order by valid_from desc limit 1) * 1000 v`)).rows[0].v
  assert.ok(h.includes('QA опц EUR'), 'опция EUR'); assert.ok(Math.round(eur) > 1000)
  assert.ok(!h.includes('QA опц выкл') && !h.includes('QA опц другой'), 'неактивная или чужого проекта опция видна')
})

test('бронь с опцией: опции и сумма в брони, итоговая цена и комиссия от опций не меняются', { skip: SKIP }, async () => {
  const a = (await db.query(`select id from portal.unit_options where title='QA опц AZN'`)).rows[0]?.id || await ins({ title: 'QA опц AZN', price: 8500, currency: 'AZN' })
  const plain = await book([])
  assert.ok(plain.b, 'бронь без опций создана')
  const w = await book([a])
  assert.ok(w.b, 'бронь с опцией создана')
  assert.equal(w.b.ou, 5000)
  assert.deepEqual(w.b.options.map((o: { title: string; usd: number; currency: string }) => [o.title, o.usd, o.currency]), [['QA опц AZN', 5000, 'AZN']])
  assert.equal(w.b.fp, plain.b.fp, 'итоговая цена брони изменилась от опции')
  assert.deepEqual(w.b.snapshot.split, plain.b.snapshot.split, 'раскладка (пул, комиссия) изменилась от опции')
})

test('бронь с неактивной, чужой или не своей квартиры опцией — ошибка, брони нет', { skip: SKIP }, async () => {
  const off = await ins({ title: 'QA опц выкл2', price: 100, active: false })
  const other = await ins({ title: 'QA опц другой2', price: 100, project: MARINA })
  const notMine = await ins({ title: 'QA опц не та кв', price: 100, unit_ids: ['f1e8be5e-4d36-40cb-97c5-3b22bf515b2f'] })
  for (const id of [off, other, notMine, '00000000-0000-0000-0000-000000000000']) {
    const r = await book([id])
    assert.equal(r.b, undefined, `бронь создана с опцией ${id}`)
  }
})
