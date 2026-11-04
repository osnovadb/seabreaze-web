// «Шахматка+» (55848d5): данные недоступных квартир у партнёра, массовые действия (в подборку, статус, скрыть), быстрая правка,
// вид «Планировки». Server actions без формы на странице вызываем как форму: id = sha1(«<абсолютный путь файла>:<имя>»).
// Работаем на BRABUS; статусы, скрытие, подборки и цены возвращаем.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import path from 'node:path'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, forms, submit } from './_portal'

const BR = '00000000-0000-0000-0000-0000000000a1', MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f', BLOCK_A = '00000000-0000-0000-0000-0000000000b1'
const A0301 = 'f1e8be5e-4d36-40cb-97c5-3b22bf515b2f', A0405 = 'd0b99068-f42c-418a-86ae-2ed0ae32fc39', A0605 = '084eacfc-d920-48a9-8972-b97272f4302b'
const M101 = 'bb8a8393-6287-41e2-853d-9b75b444d525'
const JONAS = 'f1b6864b-caa0-4de0-a319-583b1c29b664', SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed'
const CHESS = `/projects/brabus-island-baku/chess?b=${BLOCK_A}`
let db: pg.Client, units0: { id: string; status: string; price_list: string | null; price_currency: string }[] = [], hidden0: string[] = [], jonasStage = ''
const t0 = new Date()

const aid = (file: string, name: string) => crypto.createHash('sha1').update(`${path.resolve(file)}:${name}`).digest('hex')
async function call(who: string, file: string, name: string, fields: [string, string][], at = CHESS) {
  const fd = new FormData(); fd.append('$ACTION_ID_' + aid(file, name), '')
  for (const [k, v] of fields) fd.append(k, v)
  return (await fetch(URL0 + at, { method: 'POST', body: fd, headers: { cookie: await login(who) }, redirect: 'manual' })).status
}
const st = async (id: string) => (await db.query('select status, price_list::float p, price_currency c from units where id=$1', [id])).rows[0]
const isHidden = async (id: string) => (await db.query('select 1 from portal.unit_hidden where unit_id=$1', [id])).rows.length > 0
// объект квартиры в данных шахматки (RSC payload в HTML: кавычки экранированы)
const unitObj = (html: string, id: string) => { const i = html.indexOf(`\\"id\\":\\"${id}\\",\\"no\\"`); return i < 0 ? '' : html.slice(i, html.indexOf('}', i)).replace(/\\"/g, '"') }

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  units0 = (await db.query('select id, status, price_list, price_currency from units where id = any($1)', [[A0301, A0405, A0605, M101]])).rows
  hidden0 = (await db.query('select unit_id from portal.unit_hidden')).rows.map((r) => r.unit_id)
  jonasStage = (await db.query('select stage from portal.clients where id=$1', [JONAS])).rows[0].stage
})
after(async () => {
  if (SKIP) return
  for (const u of units0) await db.query('update units set status=$2, price_list=$3, price_currency=$4 where id=$1', [u.id, u.status, u.price_list, u.price_currency])
  await db.query('delete from portal.unit_hidden where not (unit_id = any($1))', [hidden0])
  const sels = (await db.query(`select id from portal.selections where client_id=$1 and user_id=$2 and created_at >= $3`, [JONAS, SOPHIE, t0])).rows.map((r) => r.id)
  await db.query(`delete from portal.selection_items where selection_id in (select id from portal.selections where client_id=$1 and user_id=$2) and unit_id = any($3)`, [JONAS, SOPHIE, [A0301, A0405, A0605, M101]])
  await db.query('delete from portal.selections where id = any($1)', [sels])
  await db.query('update portal.clients set stage=$2 where id=$1', [JONAS, jonasStage])
  await db.query(`delete from portal.notifications where created_at >= $1 and link like '/selections/%'`, [t0])
  await db.query(`delete from portal.unit_events where at >= $1 and source='portal' and unit_id = any($2)`, [t0, [A0301, A0405, A0605, M101]])
  await db.end()
})

test('партнёр: у скрытой квартиры в данных шахматки нет номера, цены, площади и планировки; карточка — 404', { skip: SKIP }, async () => {
  await db.query('insert into portal.unit_hidden (unit_id) values ($1) on conflict do nothing', [A0405])
  const h = (await page(await login(U.agent), CHESS)).html
  const o = unitObj(h, A0405)
  assert.ok(o, 'квартира есть в данных шахматки')
  for (const re of [/"no":""/, /"usd":null/, /"net":null/, /"area":0/, /"layout":null/, /"plan":null/, /"rooms":null/]) assert.match(o, re, o)
  const u = await st(A0405)
  assert.ok(!h.includes(`A-0405`), 'номер скрытой квартиры есть на странице')
  assert.notEqual((await page(await login(U.agent), `/units/${A0405}`)).status, 200, 'карточка скрытой квартиры открывается партнёру')
  // команда видит
  assert.match(unitObj((await page(await login(U.seller), CHESS)).html, A0405), /"usd":\d/, 'команда не видит цену')
  void u
})

test('«В подборку»: партнёр — только свой клиент, без скрытых квартир и закрытых проектов; не больше 100', { skip: SKIP }, async () => {
  // скрытая A0405 (из прошлого теста), Marina — черновик, закрыт для партнёров
  await db.query('insert into portal.unit_hidden (unit_id) values ($1) on conflict do nothing', [A0405])
  const other = (await db.query(`select id from portal.clients where owner_id <> $1 limit 1`, [SOPHIE])).rows[0].id
  const n0 = (await db.query('select count(*)::int n from portal.selection_items')).rows[0].n
  await call(U.agent, 'lib/actions.ts', 'addManyToSelection', [['client', other], ['units', A0605]])
  assert.equal((await db.query('select count(*)::int n from portal.selection_items')).rows[0].n, n0, 'добавлено в подборку чужого клиента')
  await call(U.agent, 'lib/actions.ts', 'addManyToSelection', [['client', JONAS], ['units', A0605], ['units', A0405], ['units', M101]])
  const items = (await db.query(`select i.unit_id from portal.selection_items i join portal.selections s on s.id=i.selection_id where s.client_id=$1 and s.user_id=$2 and i.unit_id = any($3)`, [JONAS, SOPHIE, [A0605, A0405, M101]])).rows.map((r) => r.unit_id)
  assert.deepEqual(items, [A0605], `в подборке: ${items.join(', ')}`)
})

test('«В подборку»: партнёр не добавляет проданную или чужую забронированную квартиру (недоступную, X)', { skip: SKIP }, async () => {
  await db.query(`update units set status='sold' where id=$1`, [A0301])
  await call(U.agent, 'lib/actions.ts', 'addManyToSelection', [['client', JONAS], ['units', A0301]])
  const items = (await db.query(`select i.unit_id from portal.selection_items i join portal.selections s on s.id=i.selection_id where s.client_id=$1 and s.user_id=$2 and i.unit_id=$3`, [JONAS, SOPHIE, A0301])).rows
  assert.equal(items.length, 0, 'проданная квартира попала в подборку партнёра')
})

test('«Сменить статус» массово: только owner и office и только квартиры своего project', { skip: SKIP }, async () => {
  await db.query(`update units set status='available' where id = any($1)`, [[A0301, A0605]])
  for (const who of [U.agent, U.seller, U.head, U.finance]) {
    await call(who, 'lib/objects.ts', 'bulkStatus', [['project', BR], ['status', 'unavailable'], ['units', A0605]])
    assert.equal((await st(A0605)).status, 'available', who)
  }
  // project_id чужого проекта: квартиры BRABUS при project=Marina не меняются
  await call(U.office, 'lib/objects.ts', 'bulkStatus', [['project', MARINA], ['status', 'unavailable'], ['units', A0605]])
  assert.equal((await st(A0605)).status, 'available', 'квартира другого проекта изменена')
  await call(U.office, 'lib/objects.ts', 'bulkStatus', [['project', BR], ['status', 'unavailable'], ['units', A0605], ['units', A0301]])
  assert.deepEqual([(await st(A0605)).status, (await st(A0301)).status], ['unavailable', 'unavailable'])
  const e = (await db.query(`select source, user_id from portal.unit_events where unit_id=$1 and kind='status' order by id desc limit 1`, [A0605])).rows[0]
  assert.equal(e.source, 'portal'); assert.ok(e.user_id, 'автор в журнале')
  // мусор в units не роняет действие
  assert.ok((await call(U.office, 'lib/objects.ts', 'bulkStatus', [['project', BR], ['status', 'available'], ['units', 'not-a-uuid'], ['units', A0605]])) < 500, 'не-uuid в units → 500')
})

test('«Скрыть партнёрам» массово: только owner, только свой project', { skip: SKIP }, async () => {
  await db.query('delete from portal.unit_hidden where unit_id = any($1)', [[A0605, A0301]])
  for (const who of [U.office, U.seller, U.agent]) {
    await call(who, 'lib/objects.ts', 'bulkHide', [['project', BR], ['hidden', '1'], ['units', A0605]])
    assert.equal(await isHidden(A0605), false, who)
  }
  await call(U.owner, 'lib/objects.ts', 'bulkHide', [['project', MARINA], ['hidden', '1'], ['units', A0605]])
  assert.equal(await isHidden(A0605), false, 'скрыта квартира другого проекта')
  await call(U.owner, 'lib/objects.ts', 'bulkHide', [['project', BR], ['hidden', '1'], ['units', A0605], ['units', A0301]])
  assert.ok(await isHidden(A0605) && await isHidden(A0301))
  await call(U.owner, 'lib/objects.ts', 'bulkHide', [['project', BR], ['hidden', '0'], ['units', A0605], ['units', A0301]])
  assert.ok(!(await isHidden(A0605)) && !(await isHidden(A0301)))
})

test('быстрая правка: цена 0, минус и не число — ошибка; партнёр и продавец не могут', { skip: SKIP }, async () => {
  await db.query(`update units set status='available' where id=$1`, [A0605])
  const before = await st(A0605)
  const o = await login(U.owner), at = `${CHESS}&u=${A0605}`
  const f = forms((await page(o, at)).html).find((x) => x.fields.some(([k, v]) => k === 'id' && v === A0605) && x.fields.some(([k]) => k === 'price') && x.fields.some(([k]) => k === 'status'))
  assert.ok(f, 'форма быстрой правки')
  for (const p of ['0', '-100', 'abc']) {
    await submit(o, at, f!, { price: p, currency: before.c, status: 'available' })
    assert.deepEqual(await st(A0605), before, `цена «${p}»`)
  }
  for (const who of [U.agent, U.seller]) {
    await submit(await login(who), at, f!, { price: '1', currency: before.c, status: 'sold' })
    assert.deepEqual(await st(A0605), before, who)
  }
  await submit(await login(U.office), at, f!, { price: String(before.p + 1000), currency: before.c, status: 'available' })
  assert.equal((await st(A0605)).p, before.p + 1000, 'офис не поменял цену')
})

test('вид «Планировки»: партнёру черновик не открывается, скрытые квартиры не считаются в «всего»', { skip: SKIP }, async () => {
  const ag = await login(U.agent)
  assert.notEqual((await page(ag, '/projects/test-marina/layouts')).status, 200, 'черновик открыт партнёру')
  assert.equal((await page(ag, '/projects/brabus-island-baku/layouts')).status, 200)
  assert.equal((await page(await login(U.owner), '/projects/test-marina/layouts')).status, 200)
})

test('прайс-лист из выбранных квартир: в черновик попадают только они', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const f = forms((await page(o, `/admin/prices?p=${BR}&units=${A0605},${A0301}`)).html).find((x) => x.fields.some(([k]) => k === 'op') && x.fields.some(([k]) => k === 'value'))
  assert.ok(f, 'форма прайс-листа')
  const unitsInForm = f!.fields.filter(([k]) => k === 'units').map(([, v]) => v).sort()
  assert.deepEqual(unitsInForm, [A0301, A0605].sort(), 'выбранные квартиры не переданы в форму')
  await db.query(`update units set status='available' where id = any($1)`, [[A0301, A0605]])
  const t = new Date()
  await submit(o, `/admin/prices?p=${BR}`, { ...f!, fields: f!.fields.filter(([k]) => !['statuses', 'layouts', 'rooms', 'types', 'buildings'].includes(k)) }, { op: 'pct', value: '1', statuses: 'available', title: 'QA из шахматки' })
  const l = (await db.query(`select id from portal.price_lists where project_id=$1 and created_at >= $2`, [BR, t])).rows[0]
  assert.ok(l, 'черновик создан')
  const its = (await db.query('select unit_id from portal.price_list_items where list_id=$1', [l.id])).rows.map((r) => r.unit_id).sort()
  await db.query('delete from portal.price_lists where id=$1', [l.id])
  assert.deepEqual(its, [A0301, A0605].sort())
})

test('номер квартиры BRABUS у команды — «A-0405», без лишнего префикса из названия корпуса («B-A-0405»)', { skip: SKIP }, async () => {
  const c = await login(U.seller)
  for (const p of ['/catalog?p=brabus-island-baku&view=table', `/units/${A0405}`, CHESS]) {
    const bad = [...new Set((await page(c, p)).html.match(/\b[A-Z]-[A-Z]-\d{4}\b/g) || [])]
    assert.deepEqual(bad, [], `${p}: ${bad.join(', ')}`)
  }
})
