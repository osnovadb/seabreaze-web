// М5: заявки с сайтов и смарт-каталога → «чей клиент» → очередь Bitrix24. Гоняем через локальный портал с локальным LEADS_SECRET
// (в .env.local, свой, не стендовый). Номера телефонов — случайные на прогон; тест удаляет свои заявки, клиентов и очередь.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, formWith, submit } from './_portal'

const SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const SECRET = env.LEADS_SECRET || '', ORIGIN = (env.LEADS_ORIGINS || '').split(',')[0]
const skip = SKIP || (!SECRET ? 'нужен LEADS_SECRET в .env.local' : false)
const run = String(Math.floor(Math.random() * 9e5) + 1e5)          // 6 цифр на прогон
const ph = (i: number) => `+49 151 ${run}${String(i).padStart(2, '0')}`  // +49 151 XXXXXXXX
let db: pg.Client, seq0 = 0

const post = (b: Record<string, unknown>, headers: Record<string, string> = {}, path = '') =>
  fetch(`${URL0}/api/leads/${SECRET}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) })
const lead = (i: number, extra: Record<string, unknown> = {}) => ({ name: `QA Лид ${run}-${i}`, phone: ph(i), lang: 'de', consent: { text: 'QA', version: 't' }, ...extra })
const res = async (id: string) => (await db.query('select result, client_id from portal.inbound_leads where id=$1', [id])).rows[0]
const clientsByPhone = async (i: number) => (await db.query(`select id, reg_no, owner_id from portal.clients where right(phone_norm, 9) = right($1, 9)`, [ph(i).replace(/\D/g, '')])).rows
// заявки этого прогона «состарить», чтобы следующая не попала в окно повтора (10 минут)
const age = () => db.query(`update portal.inbound_leads set created_at = created_at - interval '11 minutes' where phone_norm like $1 or name like $2`, [`%151${run}%`, `QA Лид ${run}%`])

before(async () => {
  if (skip) return
  db = await dbConnect()
  seq0 = (await db.query('select last_value::int v from portal.client_reg_seq')).rows[0].v
})
after(async () => {
  if (skip) return
  const leads = (await db.query(`select id from portal.inbound_leads where phone_norm like $1 or name like $2 or email_norm like $3`, [`%151${run}%`, `QA Лид ${run}%`, `qa${run}%`])).rows.map((r) => r.id)
  const cl = (await db.query(`select id from portal.clients where phone_norm like $1 or name like $2`, [`%151${run}%`, `QA%${run}%`])).rows.map((r) => r.id)
  await db.query(`delete from portal.bitrix_outbox where ref_kind='inbound_lead' and ref_id = any($1)`, [leads])
  await db.query(`delete from portal.inbound_leads where id = any($1)`, [leads])
  await db.query(`delete from portal.notifications where link = any($1)`, [cl.map((id) => `/clients/${id}`)]).catch(() => {})
  await db.query(`delete from portal.clients where id = any($1)`, [cl])
  // последовательность номеров не откатываем ниже уже выданных
  await db.query(`select setval('portal.client_reg_seq', greatest((select last_value from portal.client_reg_seq), $1))`, [seq0])
  await db.end()
})

test('чужой секрет → 404; CORS только для LEADS_ORIGINS; ловушка _hp → спам без клиента и без Bitrix24', { skip }, async () => {
  assert.equal((await fetch(`${URL0}/api/leads/${'x'.repeat(SECRET.length)}`, { method: 'POST', body: '{}' })).status, 404)
  const evil = await post(lead(90, { _hp: 'x' }), { origin: 'https://evil.example' })
  assert.equal(evil.status, 200); assert.equal(evil.headers.get('access-control-allow-origin'), null)
  const r = await res((await evil.json()).id)
  assert.deepEqual(r, { result: 'spam', client_id: null })
  assert.equal((await clientsByPhone(90)).length, 0)
  const good = await fetch(`${URL0}/api/leads/${SECRET}`, { method: 'OPTIONS', headers: { origin: ORIGIN } })
  assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN)
})

test('новый клиент: номер, руководитель рынка DE, очередь Bitrix24; двойная отправка — тот же лид', { skip }, async () => {
  const r1 = await post(lead(1)), j1 = await r1.json()
  assert.equal(r1.status, 200)
  const l = await res(j1.id); assert.equal(l.result, 'new_client')
  const cl = await clientsByPhone(1); assert.equal(cl.length, 1)
  const head = (await db.query(`select id from portal.users where email=$1`, [U.head])).rows[0].id
  assert.equal(cl[0].owner_id, head, 'клиент с рынка DE — руководителю рынка DE')
  assert.equal((await db.query(`select status from portal.bitrix_outbox where ref_id=$1`, [j1.id])).rows[0]?.status, 'pending')
  const j2 = await (await post(lead(1))).json()
  assert.equal(j2.id, j1.id, 'повтор за 10 минут — тот же лид')
  assert.equal((await clientsByPhone(1)).length, 1)
})

test('двойная отправка одновременно (двойной клик) не создаёт двух клиентов', { skip }, async () => {
  const rs = await Promise.all([post(lead(2)), post(lead(2)), post(lead(2))])
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200])
  const cl = await clientsByPhone(2)
  assert.equal(cl.length, 1, `создано клиентов: ${cl.length} (${cl.map((c) => c.reg_no).join(', ')})`)
})

test('клиент партнёра находится по телефону в других форматах и по e-mail в другом регистре', { skip }, async () => {
  const mail = `qa${run}@partner.example`
  const c = (await db.query(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, market, stage, protected_until)
    values ($1,$2,$3,$4,$5,$6,$6,'DE','lead', current_date + 90) returning id`, [`QA-${run}`, SOPHIE, `QA Партнёрский ${run}`, ph(3), ph(3).replace(/\D/g, ''), mail])).rows[0].id
  for (const phone of [`0049151${run}03`, `0151 ${run}03`, `+49 (151) ${run}-03`]) {
    await age()
    const j = await (await post(lead(3, { phone, name: `QA Лид ${run}-3` }))).json()
    assert.deepEqual(await res(j.id), { result: 'partner_client', client_id: c }, phone)
  }
  await age()
  const j = await (await post({ name: `QA Лид ${run}-m`, email: mail.toUpperCase(), lang: 'de', consent: { text: 'QA' } })).json()
  assert.deepEqual(await res(j.id), { result: 'partner_client', client_id: c }, 'e-mail в верхнем регистре')
  assert.equal((await db.query(`select owner_id from portal.clients where id=$1`, [c])).rows[0].owner_id, SOPHIE, 'клиент остался у партнёра')
})

// Без согласия — 422; человек ставит галочку и отправляет снова (в пределах 10 минут). Сейчас вторая заявка считается
// «повтором» первой (ошибочной) — ответ 200, но клиента нет и в Bitrix24 ничего не уходит: лид потерян.
test('после отказа «нет согласия» повторная отправка с согласием заводит клиента', { skip }, async () => {
  const r1 = await post(lead(4, { consent: undefined })); assert.equal(r1.status, 422)
  const r2 = await post(lead(4)); assert.equal(r2.status, 200)
  const j2 = await r2.json()
  assert.equal((await res(j2.id)).result, 'new_client', 'вторая отправка (с согласием) вернула ошибочный лид как «повтор»')
  assert.equal((await clientsByPhone(4)).length, 1)
})

// Номер клиента: ручная регистрация считает count(*)+142, заявки — последовательность client_reg_seq. Номера пересекаются,
// а reg_no уникален — заявка падает с 500 и теряется (или падает ручная регистрация).
test('номера клиентов из заявок и ручной регистрации не пересекаются', { skip }, async () => {
  await age()
  const c = await login(U.agent)
  const p = await page(c, '/clients/new')
  const f = formWith(p.html, 'name', 'phone'); assert.ok(f, 'форма регистрации клиента')
  await submit(c, '/clients/new', f!, { name: `QA Ручной ${run}`, phone: ph(5), consent: 'on', language: 'de' })
  const manual = (await clientsByPhone(5))[0]; assert.ok(manual, 'ручная регистрация прошла')
  const m = Number(manual.reg_no.split('-').pop())
  // следующие заявки получают номера из последовательности; ставим её прямо перед номером ручного клиента
  await db.query(`select setval('portal.client_reg_seq', $1)`, [m - 1])
  const r = await post(lead(6)), body = await r.text()
  assert.equal(r.status, 200, `заявка упала: ${r.status} ${body.slice(0, 80)} (номер R-…-0${m} уже у ручного клиента ${manual.reg_no})`)
})

test('/admin/leads: партнёр и продавец не видят; руководитель рынка DE видит только DE', { skip }, async () => {
  for (const who of [U.agent, U.agentIl, U.seller]) assert.notEqual((await page(await login(who), '/admin/leads')).status, 200, who)
  await post(lead(7, { lang: 'he', market: 'IL', name: `QA Лид ${run}-IL` }))
  await post(lead(8))
  const h = await page(await login(U.head), '/admin/leads'); assert.equal(h.status, 200)
  assert.ok(h.html.includes(`QA Лид ${run}-8`) || h.html.includes(`QA Лид ${run}-1`), 'свой рынок виден')
  assert.ok(!h.html.includes(`QA Лид ${run}-IL`), 'заявка рынка IL видна руководителю DE')
  assert.equal((await page(await login(U.office), '/admin/leads')).status, 200)
})
