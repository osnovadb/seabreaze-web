// Отчёты (9eec5a3): «Остатки и темп» и «Команда». Права, сходимость таблицы, «свободно» = каталог, граница месяца по Баку,
// руководитель рынка видит свой рынок. Тестовые сделки и события журнала удаляем, квартиры Marina возвращаем.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page } from './_portal'

const MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f', U602 = '807045c5-818f-4ce8-a992-baf8f30c2379', U601 = 'eef33d4a-da9a-4d5f-b4c8-381a1c37f2ea'
const SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed', MARTIN = '689c9cac-e756-4409-ac56-636c517d1acd', MICHAEL = '62ccf16d-10ce-4b6a-b07a-e85f618a7309'
let db: pg.Client, u602: { price_currency: string; price_list: string } | null = null
const deals: string[] = [], events: number[] = []

// Таблицы страницы: строки → ячейки (текст без тегов)
const tables = (html: string) => [...html.matchAll(/<table class="tbl">([\s\S]*?)<\/table>/g)].map((t) =>
  [...t[1].split('<tbody>')[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<div[\s\S]*?<\/div>/g, '').replace(/<[^>]+>/g, '').trim())))
const n = (s: string) => (s === '—' || s === '' ? 0 : Number(s.replace(/[^\d.-]/g, '')))
const kpis = (html: string) => [...html.matchAll(/<div class="v"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  u602 = (await db.query('select price_currency, price_list from units where id=$1', [U602])).rows[0]
})
after(async () => {
  if (SKIP) return
  if (u602) await db.query('update units set price_currency=$2, price_list=$3 where id=$1', [U602, u602.price_currency, u602.price_list])
  await db.query('delete from portal.deals where id = any($1)', [deals])
  await db.query('delete from portal.unit_events where id = any($1)', [events])
  await db.query(`delete from portal.unit_events where unit_id=$1 and at > now() - interval '1 hour' and kind='price' and source='manual' and currency in ('EUR','USD') and new_price = $2`, [U602, u602?.price_list]).catch(() => {})
  await db.end()
})

test('права: остатки — владелец, руководитель рынка, продавец, офис; команда — владелец и руководитель рынка', { skip: SKIP }, async () => {
  for (const who of [U.owner, U.head, U.seller, U.office]) assert.equal((await page(await login(who), '/reports/stock')).status, 200, who)
  for (const who of [U.agent, U.agentIl, U.finance]) assert.notEqual((await page(await login(who), '/reports/stock')).status, 200, who)
  for (const who of [U.owner, U.head]) assert.equal((await page(await login(who), '/reports/team')).status, 200, who)
  for (const who of [U.seller, U.office, U.agent, U.finance]) assert.notEqual((await page(await login(who), '/reports/team')).status, 200, who)
})

test('остатки: в каждой строке группы в сумме = «Всего», строка «Итого» = сумма строк (все проекты, по корпусам и по комнатам)', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  for (const qs of ['', '?by=rooms', '?p=premium-residence', '?p=brabus-island-baku&by=rooms']) {
    const t = tables((await page(c, '/reports/stock' + qs)).html)[0]
    const rows = t.slice(0, -1), tot = t[t.length - 1]
    for (const r of t) assert.equal(n(r[1]), n(r[2]) + n(r[3]) + n(r[4]) + n(r[5]) + n(r[6]), `${qs} ${r[0]}: группы ≠ всего`)
    for (const i of [1, 2, 3, 4, 5, 6]) assert.equal(rows.reduce((a, r) => a + n(r[i]), 0), n(tot[i]), `${qs}: колонка ${i}`)
  }
})

test('остатки: «Свободно» по проекту = свободно в каталоге для команды (в т. ч. квартира с ценой в EUR)', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  // цена в EUR разрешена в Объектах → Квартиры; каталог считает такую квартиру свободной
  await db.query(`update units set price_currency='EUR' where id=$1`, [U602])
  for (const [slug, pid] of [['test-marina', MARINA], ['premium-residence', '00000000-0000-0000-0000-0000000000a2']]) {
    const t = tables((await page(c, `/reports/stock?p=${slug}`)).html)[0]
    const rep = n(t[t.length - 1][2])
    const cat = (await db.query(`select count(*)::int n from units u where u.project_id=$1 and u.status='available' and u.price_list is not null
      and not exists (select 1 from portal.bookings x where x.unit_id=u.id and x.status in ('requested','confirmed')) and not exists (select 1 from portal.deals d where d.unit_id=u.id and d.stage <> 'cancelled')`, [pid])).rows[0].n
    assert.equal(rep, cat, `${slug}: в отчёте свободно ${rep}, в каталоге ${cat}`)
  }
})

test('по месяцам: продажа в 01:30 1-го числа по Баку (21:30 UTC накануне) — в новом месяце', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  const m0 = tables((await page(c, '/reports/stock?p=test-marina')).html)[1]
  // начало текущего месяца по Баку минус 30 минут по UTC = 01:30 по Баку того же 1-го числа
  const start = (await db.query(`select (date_trunc('month', now() at time zone 'Asia/Baku') at time zone 'Asia/Baku' + interval '90 minutes') t`)).rows[0].t
  events.push((await db.query(`insert into portal.unit_events (unit_id, kind, old_value, new_value, source, at) values ($1,'status','available','sold','manual',$2) returning id`, [U601, start])).rows[0].id)
  const m1 = tables((await page(c, '/reports/stock?p=test-marina')).html)[1]
  assert.equal(n(m1[0][1]), n(m0[0][1]) + 1, 'текущий месяц не получил продажу')
  assert.equal(n(m1[1][1]), n(m0[1][1]), 'продажа ушла в прошлый месяц')
})

test('команда: руководитель рынка DE не видит IL; m=мусор или будущее — текущий месяц', { skip: SKIP }, async () => {
  const il = (await db.query(`select name from portal.users where email=$1`, [U.agentIl])).rows[0].name
  assert.ok(!(await page(await login(U.head), '/reports/team')).html.includes(il), 'руководитель DE видит агента IL')
  assert.ok((await page(await login(U.owner), '/reports/team')).html.includes(il), 'владелец не видит агента IL')
  const c = await login(U.owner)
  for (const m of ['2099-01', 'abc', '2026-13', '0000-00']) assert.equal((await page(c, '/reports/team?m=' + m)).status, 200, m)
})

test('команда: сделка с агентом и продавцом в итогах считается один раз', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  const k0 = kpis((await page(c, '/reports/team')).html)
  const u = (await db.query(`select project_id from units where id=$1`, [U601])).rows[0]
  deals.push((await db.query(`insert into portal.deals (client_id, unit_id, project_id, final_price, agent_id, seller_id, stage) values ($1,$2,$3,100000,$4,$5,'contract') returning id`, [MICHAEL, U601, u.project_id, SOPHIE, MARTIN])).rows[0].id)
  const h = (await page(c, '/reports/team')).html, k1 = kpis(h)
  // строки: и агенту, и продавцу (так задумано)
  const rows = tables(h)[0]
  const [nm0, nm1] = await Promise.all([SOPHIE, MARTIN].map(async (id) => (await db.query('select name from portal.users where id=$1', [id])).rows[0].name as string))
  const sophie = rows.find((r) => r[0].startsWith(nm0)), martin = rows.find((r) => r[0].startsWith(nm1))
  assert.ok(sophie && martin, 'строки агента и продавца')
  assert.equal(n(k1[2]) - n(k0[2]), 1, `KPI «сделок»: было ${k0[2]}, стало ${k1[2]}`)
})

// 4182bc2: «Продано всего» = distinct квартир (продажа у застройщика ∪ наша сделка) — одна квартира не считается дважды
test('по месяцам: наша сделка и продажа той же квартиры у застройщика в одном месяце — «Продано всего» +1', { skip: SKIP }, async () => {
  const c = await login(U.owner)
  const m0 = tables((await page(c, '/reports/stock?p=test-marina')).html)[1][0]
  const u = (await db.query(`select project_id from units where id=$1`, [U602])).rows[0]
  deals.push((await db.query(`insert into portal.deals (client_id, unit_id, project_id, final_price, agent_id, stage) values ($1,$2,$3,100000,$4,'contract') returning id`, [MICHAEL, U602, u.project_id, SOPHIE])).rows[0].id)
  events.push((await db.query(`insert into portal.unit_events (unit_id, kind, old_value, new_value, source) values ($1,'status','available','sold','manual') returning id`, [U602])).rows[0].id)
  const m1 = tables((await page(c, '/reports/stock?p=test-marina')).html)[1][0]
  assert.equal(n(m1[1]) - n(m0[1]), 1, `«Продано всего»: ${m0[1]} → ${m1[1]}`)
  assert.equal(n(m1[2]) - n(m0[2]), 1, 'у застройщика'); assert.equal(n(m1[4]) - n(m0[4]), 1, 'наши сделки')
})
