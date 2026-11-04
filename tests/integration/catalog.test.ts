// Каталог v2 (1b0e03f): фильтры каталога и сохранённые поиски (tick 7г) должны отбирать одни и те же квартиры.
// Сравниваем: id карточек каталога на всех страницах ↔ seen_ids поиска после прогона tick (node scripts/tick.mjs на seabreeze_v2).
// Тест создаёт свои поиски «QA cat …», скрытие квартиры и акцию; всё удаляет за собой.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, forms, submit } from './_portal'

const BR = '00000000-0000-0000-0000-0000000000a1', PR = '00000000-0000-0000-0000-0000000000a2', MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f'
const SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed', MARTIN = '689c9cac-e756-4409-ac56-636c517d1acd'
let db: pg.Client
const hidden: string[] = [], offers: string[] = [], excs: string[] = [], paused: string[] = []
const tick = () => execFileSync('node', ['scripts/tick.mjs'], { encoding: 'utf8' })

// id квартир каталога со всех страниц (по 48)
async function catalogIds(cookie: string, qs: string) {
  const ids = new Set<string>()
  for (let pg = 1; pg < 30; pg++) {
    const r = await page(cookie, `/catalog?${qs}&view=table&pg=${pg}`); assert.equal(r.status, 200, qs)
    const n = ids.size
    for (const m of r.html.matchAll(/href="\/units\/([0-9a-f-]{36})"/g)) ids.add(m[1])
    if (ids.size - n < 48) break
  }
  return ids
}
// Сохранить поиск кнопкой каталога (форма saveSearch), запустить tick «как будто уже проверяли» и вернуть, что tick счёл подходящим
async function viaSearch(cookie: string, user: string, qs: string, override: Record<string, string> = {}) {
  const r = await page(cookie, `/catalog?${qs}`)
  const f = forms(r.html).find((x) => x.html.includes('$ACTION_ID') && x.fields.some(([k]) => k === 'p'))
  assert.ok(f, 'форма «Сохранить поиск» с проектом')
  const before = new Date()
  await submit(cookie, `/catalog?${qs}`, f!, override)
  const s = (await db.query(`select id, name, filters from portal.saved_searches where user_id=$1 and created_at >= $2 order by created_at desc limit 1`, [user, before])).rows[0]
  assert.ok(s, 'поиск сохранён')
  await db.query(`update portal.saved_searches set name = 'QA cat ' || name, checked_at = now() - interval '1 hour', seen_ids = '{}' where id=$1`, [s.id])
  tick()
  return { ...s, seen: new Set<string>((await db.query('select seen_ids from portal.saved_searches where id=$1', [s.id])).rows[0].seen_ids) }
}
// Свои брони партнёра каталог показывает («ваша бронь»), а свободными для поиска они не считаются — их разницу не считаем ошибкой
const ownBooked = async (user: string) => new Set<string>((await db.query(`select unit_id from portal.bookings where agent_id=$1 and status in ('requested','confirmed')`, [user])).rows.map((r) => r.unit_id))
const diff = (a: Set<string>, b: Set<string>, skip = new Set<string>()) => [...a].filter((x) => !b.has(x) && !skip.has(x))

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  await db.query(`delete from portal.saved_searches where name like 'QA cat %'`)
})
after(async () => {
  if (SKIP) return
  const ss = (await db.query(`select id from portal.saved_searches where name like 'QA cat %' or name like 'QA%Marina%' or (user_id = $1 and filters->>'project' = $2)`, [SOPHIE, MARINA])).rows.map((r) => r.id)
  await db.query(`delete from portal.notifications where dedup like any($1)`, [ss.map((id) => `search:${id}:%`)])
  await db.query(`delete from portal.saved_searches where id = any($1)`, [ss])
  await db.query('delete from portal.unit_hidden where unit_id = any($1)', [hidden])
  await db.query('delete from portal.special_offers where id = any($1)', [offers])
  await db.query('update portal.special_offers set active=true where id = any($1)', [paused])
  await db.query('delete from portal.project_exceptions where id = any($1)', [excs])
  await db.end()
})

// 4+ комнат, цена в AZN (BRABUS — часть квартир в манатах), повтор параметров t и r
const CASES = [
  'p=brabus-island-baku',
  'p=brabus-island-baku&r=4',
  'p=brabus-island-baku&r=1&r=4',
  'p=brabus-island-baku&pmin=300&pmax=900',
  'p=brabus-island-baku&t=2br&t=3br',
  'p=premium-residence&r=2&pmax=250&amin=50',
  'p=premium-residence&fmin=5&fmax=10&o=t',
]

test('каталог и сохранённый поиск на одних фильтрах отбирают одно и то же — команда (продавец)', { skip: SKIP }, async () => {
  const c = await login(U.seller), own = await ownBooked(MARTIN)
  for (const qs of CASES) {
    const cat = await catalogIds(c, qs), s = await viaSearch(c, MARTIN, qs)
    assert.ok(cat.size > 0 || qs.includes('fmin'), `${qs}: каталог пуст — тест ничего не проверяет`)
    assert.deepEqual(diff(cat, s.seen, own), [], `${qs}: в каталоге есть, поиск не видит (${s.name})`)
    assert.deepEqual(diff(s.seen, cat), [], `${qs}: поиск видит, в каталоге нет (${s.name})`)
  }
})

test('то же для партнёра; скрытая квартира не приходит ни в каталог, ни в поиск', { skip: SKIP }, async () => {
  const c = await login(U.agent), own = await ownBooked(SOPHIE)
  // скрыть одну свободную 4+ квартиру BRABUS
  const u = (await db.query(`select u.id from units u where u.project_id=$1 and u.status='available' and u.price_list is not null
    and coalesce((u.raw->>'rooms')::int, case u.unit_type when 'studio' then 1 when '1br' then 2 when '2br' then 3 when '3br' then 4 else u.bedrooms + 1 end) >= 4
    and not exists (select 1 from portal.unit_hidden h where h.unit_id=u.id) and not exists (select 1 from portal.bookings b where b.unit_id=u.id and b.status in ('requested','confirmed'))
    and not exists (select 1 from portal.deals d where d.unit_id=u.id and d.stage <> 'cancelled') limit 1`, [BR])).rows[0]?.id
  assert.ok(u, 'есть свободная 4+ в BRABUS')
  await db.query(`insert into portal.unit_hidden (unit_id) values ($1)`, [u]); hidden.push(u)
  for (const qs of CASES) {
    const cat = await catalogIds(c, qs), s = await viaSearch(c, SOPHIE, qs)
    assert.ok(!cat.has(u) && !s.seen.has(u), `${qs}: скрытая квартира видна партнёру`)
    assert.deepEqual(diff(cat, s.seen, own), [], `${qs}: в каталоге есть, поиск не видит (${s.name})`)
    assert.deepEqual(diff(s.seen, cat), [], `${qs}: поиск видит, в каталоге нет (${s.name})`)
  }
})

test('«Только с акцией»: каталог и поиск видят одни и те же квартиры (в т. ч. фиксированная скидка в AZN у квартир в долларах)', { skip: SKIP }, async () => {
  const c = await login(U.seller), own = await ownBooked(MARTIN)
  // В BRABUS цены в AZN и USD; админка разрешает fixed-акцию в AZN (валюта цен проекта). На квартиру в долларах каталог её не применяет
  // (promoOf: валюта не совпала → скидка 0), а tick 7г считает квартиру «с акцией» по одному факту попадания в акцию.
  const us = (await db.query(`select id from units where project_id=$1 and status='available' and price_currency='USD' and price_list is not null limit 1`, [BR])).rows.map((r) => r.id)
  assert.equal(us.length, 1, 'в BRABUS есть свободная квартира в USD')
  // действующие акции BRABUS на время теста выключаем (иначе квартира «с акцией» и так), в after включаем обратно
  paused.push(...(await db.query(`update portal.special_offers set active=false where project_id=$1 and active returning id`, [BR])).rows.map((r) => r.id))
  offers.push((await db.query(`insert into portal.special_offers (project_id, name, kind, value, currency, unit_ids, active) values ($1,'QA cat AZN','fixed',5000,'AZN',$2,true) returning id`, [BR, us])).rows[0].id)
  for (const qs of ['p=brabus-island-baku&promo=1', 'p=premium-residence&promo=1']) {
    const cat = await catalogIds(c, qs), s = await viaSearch(c, MARTIN, qs)
    assert.deepEqual(diff(cat, s.seen, own), [], `${qs}: в каталоге есть, поиск не видит`)
    assert.deepEqual(diff(s.seen, cat), [], `${qs}: поиск видит, в каталоге нет`)
  }
})

test('повторяющиеся t и r = через запятую; all=1 у партнёра ничего не добавляет; pg за пределами — последняя страница', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  assert.deepEqual([...await catalogIds(c, 'p=brabus-island-baku&r=1&r=4')].sort(), [...await catalogIds(c, 'p=brabus-island-baku&r=1,4')].sort())
  assert.deepEqual([...await catalogIds(c, 'p=brabus-island-baku&t=2br&t=3br')].sort(), [...await catalogIds(c, 'p=brabus-island-baku&t=2br,3br')].sort())
  assert.deepEqual([...await catalogIds(c, 'p=brabus-island-baku&all=1')].sort(), [...await catalogIds(c, 'p=brabus-island-baku')].sort())
  for (const qs of ['pg=999', 'pg=-1', 'pg=abc', 'pmin=abc&pmax=-5', 'r=99', 's=zzz', 'b=00000000-0000-0000-0000-000000000000']) assert.equal((await page(c, '/catalog?' + qs)).status, 200, qs)
  // старый параметр max = pmax
  assert.deepEqual([...await catalogIds(c, 'p=brabus-island-baku&max=900')].sort(), [...await catalogIds(c, 'p=brabus-island-baku&pmax=900')].sort())
})

test('партнёр не сохраняет поиск по закрытому для него проекту и не получает по нему уведомлений', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  // черновик test-marina партнёру не виден; форму берём со страницы BRABUS и подменяем проект
  assert.ok(!(await page(c, '/catalog')).html.includes('test-marina'), 'черновик виден партнёру в каталоге')
  const r = await page(c, '/catalog?p=brabus-island-baku')
  const f = forms(r.html).find((x) => x.html.includes('$ACTION_ID') && x.fields.some(([k]) => k === 'p'))!
  await submit(c, '/catalog?p=brabus-island-baku', f, { p: 'test-marina' })
  const n = (await db.query(`select count(*)::int n from portal.saved_searches where user_id=$1 and filters->>'project'=$2`, [SOPHIE, MARINA])).rows[0].n
  assert.equal(n, 0, 'сохранён поиск по черновику, закрытому для партнёра')
})

test('проект закрыли для партнёра после сохранения поиска — уведомлений по нему нет', { skip: SKIP }, async () => {
  const id = (await db.query(`insert into portal.saved_searches (user_id, name, filters, checked_at, seen_ids) values ($1,'QA cat closed',$2, now() - interval '1 hour', '{}') returning id`, [SOPHIE, { project: BR }])).rows[0].id
  excs.push((await db.query(`insert into portal.project_exceptions (project_id, user_id, allow) values ($1,$2,false) returning id`, [BR, SOPHIE])).rows[0].id)
  tick()
  const nn = (await db.query(`select count(*)::int n from portal.notifications where dedup like $1`, [`search:${id}:%`])).rows[0].n
  assert.equal(nn, 0, 'партнёр получил уведомление о квартирах проекта, который ему закрыт')
})

// 63832f1: «цена от–до» сравнивается с ценой после акции (как в карточке) — и в каталоге, и в сохранённом поиске
test('фильтр цены — по цене после акции: квартира с акцией попадает в «до», хотя прайс выше', { skip: SKIP }, async () => {
  const c = await login(U.seller)
  const u = (await db.query(`select id, price_list::float p from units where project_id=$1 and status='available' and price_currency='USD' and price_list > 50000
    and not exists (select 1 from portal.bookings b where b.unit_id=units.id and b.status in ('requested','confirmed')) and not exists (select 1 from portal.deals d where d.unit_id=units.id and d.stage <> 'cancelled') limit 1`, [PR])).rows[0]
  offers.push((await db.query(`insert into portal.special_offers (project_id, name, kind, value, unit_ids, active) values ($1,'QA cat net','pct',20,$2,true) returning id`, [PR, [u.id]])).rows[0].id)
  const pmax = Math.floor(u.p * 0.9 / 1000) // между ценой после акции (80%) и прайсом
  const qs = `p=premium-residence&pmax=${pmax}`
  const cat = await catalogIds(c, qs), s = await viaSearch(c, MARTIN, qs)
  assert.ok(cat.has(u.id), 'каталог: квартира с акцией не попала в «до»')
  assert.ok(s.seen.has(u.id), 'поиск: квартира с акцией не попала в «до»')
  const qs2 = `p=premium-residence&pmin=${Math.ceil(u.p * 0.85 / 1000)}&pmax=${Math.floor(u.p * 1.1 / 1000)}`
  assert.ok(!(await catalogIds(c, qs2)).has(u.id), 'каталог: «от» тоже по цене после акции — квартира ниже «от» не показывается')
})
