// Поэтажные планы Premium Residence (295fd8c): целостность данных разметки, экран «Этаж» у партнёра (недоступные без номера и цены),
// вкладка «На этаже» в карточке, доступ к картинке плана. Пишет только исключение видимости для Sophie и скрытие одной квартиры — убирает.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page } from './_portal'
import { riser } from '../../lib/catalog'

const PR = '00000000-0000-0000-0000-0000000000a2', SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed'
const BLOCKS: Record<string, string> = { A: '00000000-0000-0000-0000-0000000002b1', B: '00000000-0000-0000-0000-0000000002b2', C: '00000000-0000-0000-0000-0000000002b3', D: '00000000-0000-0000-0000-0000000002b4' }
let db: pg.Client
const excs: string[] = [], hid: string[] = []

// ячейки плана из данных страницы (RSC payload: кавычки экранированы)
const cells = (html: string) => [...html.replace(/\\"/g, '"').matchAll(/\{"riser":[^{}]*\}/g)].map((m) => JSON.parse(m[0]) as { riser: string; id: string | null; code: string; href: string | null; no: string; info: string; price: string })

before(async () => { if (!SKIP) db = await dbConnect() })
after(async () => {
  if (SKIP) return
  await db.query('delete from portal.project_exceptions where id = any($1)', [excs])
  await db.query('delete from portal.unit_hidden where unit_id = any($1)', [hid])
  await db.end()
})

test('данные: у каждого плана Premium контуры от 3 точек в пределах картинки, стояки без дублей и все находят квартиру этажа', { skip: SKIP }, async () => {
  const plans = (await db.query(`select f.id, f.building_id, f.floor_from, f.floor_to, f.cells, f.file_id from portal.floor_plans f join buildings b on b.id=f.building_id where b.project_id=$1`, [PR])).rows
  assert.equal(plans.length, 46)
  const units = (await db.query(`select id, building_id, number, floor from units where project_id=$1`, [PR])).rows
  const covered = new Set<string>(), problems: string[] = []
  for (const p of plans) {
    assert.equal(p.floor_from, p.floor_to)
    const rs = p.cells.map((c: { riser: string }) => c.riser)
    if (new Set(rs).size !== rs.length) problems.push(`${p.building_id} эт.${p.floor_from}: дубли стояков`)
    for (const c of p.cells as { riser: string; points: number[][] }[]) {
      if (c.points.length < 3 || !c.points.every((xy) => xy.every((v) => v >= 0 && v <= 1))) problems.push(`эт.${p.floor_from} ${c.riser}: контур`)
      const u = units.filter((x) => x.building_id === p.building_id && x.floor === p.floor_from && riser(x) === c.riser)
      if (u.length !== 1) problems.push(`эт.${p.floor_from} ${c.riser}: квартир ${u.length}`)
      else covered.add(u[0].id)
    }
  }
  assert.deepEqual(problems, [])
  const blk = Object.fromEntries(Object.entries(BLOCKS).map(([k, v]) => [v, k]))
  const without = units.filter((u) => !covered.has(u.id)).map((u) => `${blk[u.building_id]}-${u.number}`).sort()
  assert.equal(covered.size, 998, `без контура: ${without.join(', ')}`)
})

test('партнёр на «Этаже»: у недоступных квартир нет номера, площади и цены; у свободных — есть; этажи 1–12 открываются', { skip: SKIP }, async () => {
  const ag = await login(U.agent)
  // скрыть одну свободную квартиру с контуром (C, этаж 5)
  const u = (await db.query(`select u.id, u.number from units u where u.building_id=$1 and u.floor=5 and u.status='available' and u.price_list is not null
    and not exists (select 1 from portal.unit_hidden h where h.unit_id=u.id) and not exists (select 1 from portal.bookings b where b.unit_id=u.id and b.status in ('requested','confirmed')) limit 1`, [BLOCKS.C])).rows[0]
  await db.query('insert into portal.unit_hidden (unit_id) values ($1)', [u.id]); hid.push(u.id)
  let nX = 0, nF = 0
  for (const [k, bid] of Object.entries(BLOCKS)) for (let f = 1; f <= 12; f++) {
    const r = await page(ag, `/projects/premium-residence/floor?b=${bid}&f=${f}`)
    assert.equal(r.status, 200, `${k} эт.${f}`)
    if ((k === 'A' || k === 'B') && f === 1) continue
    const cs = cells(r.html)
    assert.ok(cs.length > 0, `${k} эт.${f}: нет ячеек плана`)
    for (const c of cs) {
      if (c.code === 'X') { nX++; assert.deepEqual([c.no, c.info, c.price, c.href], ['', '', '', null], `${k} эт.${f} ${c.riser}`) }
      if (c.code === 'F') { nF++; assert.ok(c.no && c.price, `${k} эт.${f} ${c.riser}: у свободной нет номера или цены`) }
    }
    if (k === 'C' && f === 5) {
      const h = cs.find((c) => c.id === u.id)
      assert.ok(h && h.code === 'X', 'скрытая квартира не X на плане')
      assert.ok(!r.html.includes(`>${u.number}<`), 'номер скрытой квартиры в HTML')
    }
  }
  assert.ok(nX > 0 && nF > 0, `X: ${nX}, F: ${nF}`)
})

test('команда видит номер и у проданных квартир на плане', { skip: SKIP }, async () => {
  const cs = cells((await page(await login(U.seller), `/projects/premium-residence/floor?b=${BLOCKS.D}&f=9`)).html)
  const sold = cs.filter((c) => c.code === 'S')
  assert.ok(cs.length > 0)
  for (const c of sold) assert.ok(c.no, 'у проданной нет номера для команды')
})

test('партнёр без доступа к Premium: «Этаж» и картинка плана — 404', { skip: SKIP }, async () => {
  const fid = (await db.query(`select f.file_id from portal.floor_plans f where f.building_id=$1 and f.floor_from=5`, [BLOCKS.A])).rows[0].file_id
  const before = await (await fetch(`${URL0}/files/${fid}`, { headers: { cookie: await login(U.agent) } })).text()
  assert.notEqual(before, 'forbidden', 'партнёр с доступом не получает план')
  excs.push((await db.query(`insert into portal.project_exceptions (project_id, user_id, allow) values ($1,$2,false) returning id`, [PR, SOPHIE])).rows[0].id)
  const ag = await login(U.agent)
  assert.notEqual((await page(ag, `/projects/premium-residence/floor?b=${BLOCKS.A}&f=5`)).status, 200)
  const r = await fetch(`${URL0}/files/${fid}`, { headers: { cookie: ag } })
  assert.equal(r.status, 404); assert.equal(await r.text(), 'forbidden')
})

test('карточка квартиры: «На этаже» у Premium (своя подсвечена), без контура — подпись; у BRABUS и Marina вкладки нет; ?img=мусор — план', { skip: SKIP }, async () => {
  const c = await login(U.seller)
  const u = (await db.query(`select id from units where building_id=$1 and floor=5 limit 1`, [BLOCKS.D])).rows[0].id
  const h = (await page(c, `/units/${u}?img=floor`)).html
  assert.ok(h.includes('z-here'), 'своя квартира не подсвечена')
  assert.ok(h.includes('img=floor'), 'нет вкладки «На этаже»')
  // квартира без контура: на её этаже план есть, а её стояка в cells нет
  const cand = (await db.query(`select u.id, u.number, u.floor, f.cells from units u join portal.floor_plans f on f.building_id=u.building_id and u.floor between f.floor_from and f.floor_to where u.project_id=$1`, [PR])).rows
  const no = cand.find((x) => !x.cells.some((cl: { riser: string }) => cl.riser === riser(x)))?.id
  assert.ok(no, 'есть квартира без контура')
  const h2 = (await page(c, `/units/${no}?img=floor`)).html
  assert.ok(!h2.includes('z-here') && h2.includes('z-dim'), 'квартира без контура')
  for (const id of ['f1e8be5e-4d36-40cb-97c5-3b22bf515b2f', 'bb8a8393-6287-41e2-853d-9b75b444d525']) {
    const r = await page(c, `/units/${id}`)
    assert.equal(r.status, 200)
    if (id.startsWith('f1e8')) assert.ok(!r.html.includes('img=floor'), 'у BRABUS есть вкладка «На этаже»')
  }
  const z = await page(c, `/units/${u}?img=zzz`)
  assert.equal(z.status, 200)
})
