// М6: акции и правило сложения на живом локальном портале (seabreeze_v2). Тест создаёт свои акции с именем «QA …» и удаляет их.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, formWith, submit, scheduleTotal } from './_portal'

const BR = '00000000-0000-0000-0000-0000000000a1', MR = 'c531e4dd-e500-47cf-b000-febd86a6fc7f'
const MR_UNIT = '4e2534a7-8e5e-40d8-961b-b1c77c43f62d' // test-marina 102, $150 000, «100% сразу» −5%
const A_UNIT = 'd0b99068-f42c-418a-86ae-2ed0ae32fc39', C_UNIT = 'b1a28596-01a0-4c49-bad3-3dd8f360934d', BLOCK_A = '00000000-0000-0000-0000-0000000000b1'
let db: pg.Client, modes: Record<string, string> = {}
const addOffer = (x: Record<string, unknown>) => db.query(`insert into portal.special_offers (project_id, building_id, name, kind, value, currency, unit_ids, starts_on, ends_on, active)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [x.project, x.building ?? null, x.name, x.kind ?? 'pct', x.value, x.currency ?? null, x.unit_ids ?? null, x.starts_on ?? null, x.ends_on ?? null, x.active ?? true])
const setMode = (p: string, m: string) => db.query(`insert into portal.project_settings (project_id, promo_mode) values ($1,$2) on conflict (project_id) do update set promo_mode = excluded.promo_mode`, [p, m])
const cleanup = () => db.query(`delete from portal.special_offers where name like 'QA %'`)

before(async () => {
  if (SKIP) return
  db = await dbConnect(); await cleanup()
  for (const p of [BR, MR]) modes[p] = (await db.query('select promo_mode from portal.project_settings where project_id=$1', [p])).rows[0]?.promo_mode || 'chain'
})
after(async () => { if (SKIP) return; await cleanup(); for (const [p, m] of Object.entries(modes)) await setMode(p, m); await db.end() })

test('четыре режима на «100% сразу» (−5%) + акция 10%: итог графика', { skip: SKIP }, async () => {
  await addOffer({ project: MR, name: 'QA 10%', value: 10 })
  const own = await login(U.owner)
  const want: Record<string, number> = { chain: 128250, sum: 127500, best: 135000, exclusive: 128250 }
  for (const [m, v] of Object.entries(want)) {
    await setMode(MR, m)
    assert.equal(scheduleTotal((await page(own, `/units/${MR_UNIT}`)).html), v, m)
  }
})
test('просроченная, будущая и выключенная акции не применяются', { skip: SKIP }, async () => {
  await cleanup(); await setMode(MR, 'chain')
  const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
  await addOffer({ project: MR, name: 'QA вчера', value: 50, ends_on: d(-1) })
  await addOffer({ project: MR, name: 'QA завтра', value: 50, starts_on: d(1) })
  await addOffer({ project: MR, name: 'QA выкл', value: 50, active: false })
  const h = (await page(await login(U.owner), `/units/${MR_UNIT}`)).html
  assert.equal(scheduleTotal(h), 142500, 'только скидка за 100%')
  assert.ok(!/QA (вчера|завтра|выкл)/.test(h), 'имя недействующей акции на странице')
})
test('акция на блок A не задевает блок C', { skip: SKIP }, async () => {
  await cleanup(); await addOffer({ project: BR, building: BLOCK_A, name: 'QA блок A', value: 20 })
  const own = await login(U.owner)
  assert.ok((await page(own, `/units/${A_UNIT}`)).html.includes('QA блок A'), 'квартира блока A')
  assert.ok(!(await page(own, `/units/${C_UNIT}`)).html.includes('QA блок A'), 'квартира блока C')
})
test('партнёр не видит «Акции» и не может вызвать savePromo прямым POST', { skip: SKIP }, async () => {
  await cleanup()
  const own = await login(U.owner)
  const adm = (await page(own, `/admin/objects/${BR}?tab=promos`)).html
  const f = formWith(adm, 'name', 'kind', 'value'); assert.ok(f, 'форма новой акции у владельца')
  const ag = await login(U.agent)
  assert.notEqual((await page(ag, `/admin/objects/${BR}?tab=promos`)).status, 200)
  await submit(ag, `/admin/objects/${BR}?tab=promos`, f!, { name: 'QA от партнёра', kind: 'pct', value: '50', units: '', active: 'on' })
  assert.equal((await db.query(`select count(*)::int n from portal.special_offers where name='QA от партнёра'`)).rows[0].n, 0)
})
test('exclusive: бронь со скидкой из пула сервер отклоняет', { skip: SKIP }, async () => {
  await cleanup(); await addOffer({ project: BR, name: 'QA экскл', value: 5 }); await setMode(BR, 'exclusive')
  const ag = await login(U.agent)
  const bp = await page(ag, `/units/${C_UNIT}/book`)
  const f = formWith(bp.html, 'discount', 'client', 'unit'); assert.ok(f, 'форма брони')
  const client = (await db.query(`select c.id from portal.clients c join portal.users u on u.id=c.owner_id where u.email=$1 order by c.name limit 1`, [U.agent])).rows[0].id
  const n0 = (await db.query('select count(*)::int n from portal.bookings where unit_id=$1', [C_UNIT])).rows[0].n
  await submit(ag, `/units/${C_UNIT}/book`, f!, { discount: '3', client })
  assert.equal((await db.query('select count(*)::int n from portal.bookings where unit_id=$1', [C_UNIT])).rows[0].n, n0, 'бронь не должна создаться')
})
test('сумма графика = итог брони (chain, акция 5%, скидка 2%)', { skip: SKIP }, async () => {
  await cleanup(); await addOffer({ project: BR, name: 'QA сумма', value: 5 }); await setMode(BR, 'chain')
  const ag = await login(U.agent)
  const bp = await page(ag, `/units/${C_UNIT}/book`)
  const f = formWith(bp.html, 'discount', 'client', 'unit')!
  const plan = f.fields.find(([k]) => k === 'plan')?.[1]
  const list = scheduleTotal(bp.html)! // при скидке 0: цена с акцией = итог графика в форме
  const client = (await db.query(`select c.id from portal.clients c join portal.users u on u.id=c.owner_id where u.email=$1 order by c.name limit 1`, [U.agent])).rows[0].id
  await submit(ag, `/units/${C_UNIT}/book`, f, { discount: '2', client, plan: plan || '' })
  const b = (await db.query(`select id, final_price::float fp, price_list::float p, snapshot from portal.bookings where unit_id=$1 and created_at > now() - interval '1 minute' order by created_at desc limit 1`, [C_UNIT])).rows[0]
  assert.ok(b, 'бронь создана')
  try {
    const expected = Math.round(list * 0.98)
    assert.ok(Math.abs(b.fp - expected) <= 1, `итог брони ${b.fp} ≠ график ${expected}`)
    assert.ok(b.snapshot?.promo?.amount > 0, 'акция в снимке брони')
  } finally { await db.query(`delete from portal.bookings where id=$1`, [b.id]) }
})
