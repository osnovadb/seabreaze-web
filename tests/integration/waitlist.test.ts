// М12: лист ожидания и сохранённые поиски. Шаги tick (7в, 7г) гоняем локально: node scripts/tick.mjs на seabreeze_v2
// (тот же код, что у таймера стенда; таймер стенда раз в 15 мин может вмешаться — тогда перезапустить).
// Тест берёт квартиру BRABUS A-0301 (свободна, без броней/сделок/очереди), занимает её своей бронью и всё за собой удаляет.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, forms, submit } from './_portal'

const UNIT = 'f1e8be5e-4d36-40cb-97c5-3b22bf515b2f', SOLD = '6c08492e-5fb8-4588-a4df-092f2fa85ff7'
const BR = '00000000-0000-0000-0000-0000000000a1'
const MARTIN = '689c9cac-e756-4409-ac56-636c517d1acd', SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed'
const DIRK = '1a047999-ee3f-4693-bb34-af813e95c076', MICHAEL = '62ccf16d-10ce-4b6a-b07a-e85f618a7309'
let db: pg.Client, pause0: number | null = null, booking = ''
const tick = () => JSON.parse(execFileSync('node', ['scripts/tick.mjs'], { encoding: 'utf8' }).trim().split(' ').slice(1).join(' '))
const setPause = (h: number) => db.query(`insert into portal.project_settings (project_id, waitlist_pause_hours) values ($1,$2) on conflict (project_id) do update set waitlist_pause_hours = excluded.waitlist_pause_hours`, [BR, h])
const wl = async () => (await db.query(`select user_id, active, notified_at is not null notified from portal.waitlist where unit_id=$1 order by created_at`, [UNIT])).rows

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  pause0 = (await db.query('select waitlist_pause_hours h from portal.project_settings where project_id=$1', [BR])).rows[0]?.h ?? null
  const u = (await db.query(`select project_id, price_list from units where id=$1`, [UNIT])).rows[0]
  booking = (await db.query(`insert into portal.bookings (unit_id, project_id, client_id, agent_id, status, price_list, currency, discount_pct, final_price, snapshot, ends_at)
    values ($1,$2,$3,$4,'confirmed',$5,'USD',0,$5,'{}',now() + interval '10 days') returning id`, [UNIT, u.project_id, MICHAEL, SOPHIE, 100000])).rows[0].id
})
after(async () => {
  if (SKIP) return
  const ids = (await db.query('select id from portal.waitlist where unit_id = any($1)', [[UNIT, SOLD]])).rows.map((r) => r.id)
  await db.query(`delete from portal.notifications where dedup = any($1)`, [ids.map((i: string) => 'wait:' + i)])
  await db.query('delete from portal.waitlist where unit_id = any($1)', [[UNIT, SOLD]])
  await db.query('delete from portal.unit_hidden where unit_id=$1', [UNIT])
  await db.query('delete from portal.bookings where id=$1', [booking])
  await db.query(`delete from portal.saved_searches where name like 'QA %'`)
  await db.query('update portal.project_settings set waitlist_pause_hours = coalesce($2, 24) where project_id=$1', [BR, pause0])
  await db.end()
})

test('встать в очередь: на занятую — да (повтор не дублирует), на проданную — сервер отказывает', { skip: SKIP }, async () => {
  const m = await login(U.seller)
  const f = forms((await page(m, `/units/${UNIT}`)).html).find((x) => x.fields.some(([k]) => k === 'unit') && x.fields.some(([k]) => k === 'client'))
  assert.ok(f, 'форма листа ожидания на карточке занятой квартиры')
  await submit(m, `/units/${UNIT}`, f!, { unit: UNIT, client: DIRK })
  await submit(m, `/units/${UNIT}`, f!, { unit: UNIT, client: DIRK })
  assert.equal((await wl()).length, 1, 'одна запись, без дубля')
  assert.ok(!/waitlist|ожидани/i.test((await page(m, `/units/${SOLD}`)).html.replace(/<script[\s\S]*?<\/script>/g, '').match(/<form[\s\S]*?<\/form>/g)?.join('') || ''), 'на проданной нет кнопки')
  await submit(m, `/units/${SOLD}`, f!, { unit: SOLD, client: DIRK })
  assert.equal((await db.query('select count(*)::int n from portal.waitlist where unit_id=$1', [SOLD])).rows[0].n, 0, 'на проданную не встать')
})
test('освободилась: первому — сразу, второму — только после паузы', { skip: SKIP }, async () => {
  await db.query(`insert into portal.waitlist (unit_id, user_id, client_id, created_at) values ($1,$2,$3, now() + interval '1 second')`, [UNIT, SOPHIE, MICHAEL])
  tick(); assert.deepEqual((await wl()).map((w) => w.active), [true, true], 'пока занята — никого')
  await db.query(`update portal.bookings set status='cancelled' where id=$1`, [booking])
  await setPause(1); tick()
  assert.deepEqual((await wl()).map((w) => [w.active, w.notified]), [[false, true], [true, false]], 'первый уведомлён, второй ждёт')
  tick(); assert.equal((await wl())[1].active, true, 'пауза 1 ч — второй ещё ждёт')
  await setPause(0); tick()
  assert.deepEqual((await wl())[1], { user_id: SOPHIE, active: false, notified: true }, 'пауза 0 — второй уведомлён')
})
test('партнёр по скрытой квартире не уведомляется', { skip: SKIP }, async () => {
  await db.query('delete from portal.waitlist where unit_id=$1', [UNIT])
  await db.query(`insert into portal.waitlist (unit_id, user_id, client_id) values ($1,$2,$3)`, [UNIT, SOPHIE, MICHAEL])
  await db.query(`insert into portal.unit_hidden (unit_id, note) values ($1,'QA')`, [UNIT])
  await setPause(0); tick()
  assert.equal((await wl())[0].active, true, 'скрытая — партнёр не уведомлён')
})
test('скрыть квартиру в админке: партнёры убраны из очереди с уведомлением, команда остаётся', { skip: SKIP }, async () => {
  await db.query('delete from portal.waitlist where unit_id=$1', [UNIT])
  await db.query('delete from portal.unit_hidden where unit_id=$1', [UNIT])
  await db.query(`insert into portal.waitlist (unit_id, user_id, client_id) values ($1,$2,$3), ($1,$4,$5)`, [UNIT, SOPHIE, MICHAEL, MARTIN, DIRK])
  const o = await login(U.owner)
  const path0 = `/admin/objects/${BR}?tab=units&b=00000000-0000-0000-0000-0000000000b1&fl=3`
  const f = forms((await page(o, path0)).html).find((x) => x.fields.some(([k, v]) => k === 'id' && v === UNIT) && x.fields.some(([k]) => k === 'hidden_set'))
  assert.ok(f, 'форма квартиры с «скрыть» в админке объекта')
  const before = await db.query(`select status, price_list::float p from units where id=$1`, [UNIT])
  await submit(o, path0, f!, { hidden: "1" })
  assert.equal((await db.query('select count(*)::int n from portal.unit_hidden where unit_id=$1', [UNIT])).rows[0].n, 1, 'квартира скрыта')
  const w = (await db.query(`select user_id, active from portal.waitlist where unit_id=$1`, [UNIT])).rows
  assert.equal(w.find((x) => x.user_id === SOPHIE)?.active, false, 'партнёр остался в очереди')
  assert.equal(w.find((x) => x.user_id === MARTIN)?.active, true, 'продавца убрали из очереди')
  const n = (await db.query(`select link from portal.notifications where user_id=$1 and kind='waitlist' and text like 'Квартира {u} снята%' and created_at > now() - interval '5 minutes'`, [SOPHIE])).rows
  assert.equal(n.length, 1, 'партнёр не уведомлён'); assert.equal(n[0].link, '/waitlist')
  assert.deepEqual((await db.query(`select status, price_list::float p from units where id=$1`, [UNIT])).rows, before.rows, 'сохранение формы изменило квартиру')
  await db.query(`delete from portal.notifications where user_id=$1 and text like 'Квартира {u} снята%'`, [SOPHIE])
})
test('сохранённый поиск: «2 комнаты» — это 2 комнаты, как в каталоге; max в тыс. $ с пересчётом AZN', { skip: SKIP }, async () => {
  await db.query(`insert into portal.saved_searches (user_id, name, filters) values ($1,'QA 2к ≤ 1500k',$2)`, [MARTIN, { project: BR, rooms: 2, max: 1500, outdoor: null }])
  tick() // первая проверка только запоминает
  const s = (await db.query(`select seen_ids, checked_at from portal.saved_searches where name='QA 2к ≤ 1500k'`)).rows[0]
  assert.ok(s.checked_at && s.seen_ids.length > 0, 'запомнил квартиры')
  const n = (await db.query(`select count(*)::int n from portal.notifications where dedup like $1`, ['search:%'])).rows[0].n
  const rows = (await db.query(`select u.number, u.bedrooms, coalesce((u.raw->>'rooms')::int, case u.unit_type when 'studio' then 1 when '1br' then 2 when '2br' then 3 when '3br' then 4 else u.bedrooms + 1 end) rooms,
    u.price_list / (select azn_per_unit from currency_rates where currency='USD' order by valid_from desc limit 1) usd from units u where u.id = any($1)`, [s.seen_ids])).rows
  assert.ok(rows.every((r) => Number(r.usd) <= 1500000), 'max: все ≤ $1.5m после пересчёта AZN')
  assert.ok(rows.every((r) => r.rooms === 2), 'в поиск попали квартиры с другим числом комнат: ' + rows.map((r) => `${r.number}=${r.rooms}к`).join(' '))
  void n
})
test('чужой поиск и чужую запись в очереди удалить нельзя', { skip: SKIP }, async () => {
  const mine = (await db.query(`insert into portal.saved_searches (user_id, name, filters) values ($1,'QA sophie',$2) returning id`, [SOPHIE, { project: BR }])).rows[0].id
  const other = (await db.query(`insert into portal.saved_searches (user_id, name, filters) values ($1,'QA martin',$2) returning id`, [MARTIN, { project: BR }])).rows[0].id
  const w = (await db.query(`insert into portal.waitlist (unit_id, user_id) values ($1,$2) on conflict do nothing returning id`, [UNIT, MARTIN])).rows[0]?.id
  const so = await login(U.agent)
  const p = await page(so, '/waitlist')
  const f = forms(p.html).find((x) => x.fields.some(([k, v]) => k === 'id' && v === mine)); assert.ok(f, 'форма удаления своего поиска')
  await submit(so, '/waitlist', f!, { id: other })
  assert.equal((await db.query('select count(*)::int n from portal.saved_searches where id=$1', [other])).rows[0].n, 1, 'чужой поиск на месте')
  if (w) {
    const lf = forms(p.html).find((x) => x.fields.some(([k]) => k === 'id') && x !== f) || f!
    await submit(so, '/waitlist', lf, { id: w })
    assert.equal((await db.query('select active from portal.waitlist where id=$1', [w])).rows[0].active, true, 'чужая запись активна')
  }
})
