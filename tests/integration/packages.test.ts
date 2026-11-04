// Пакеты броней (33f3acd) и платная бронь (5eebf9d) на BRABUS. Клиент — Jonas Becker (партнёр Sophie): на время теста KYC = passed.
// Платную бронь включаем отдельной опубликованной версией условий BRABUS (копия текущей с взносом) и удаляем её в after.
// Все брони, сделки, акты и уведомления теста удаляем, стадию и KYC клиента возвращаем.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, forms, formWith, submit } from './_portal'

const BR = '00000000-0000-0000-0000-0000000000a1'
const JONAS = 'f1b6864b-caa0-4de0-a319-583b1c29b664', SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed'
const UNITS = ['084eacfc-d920-48a9-8972-b97272f4302b', 'b2cccf0d-6c22-47a8-ac16-88effc35d0a0', 'e9d96431-3782-466e-bab7-3de9490d9b21'] // A-0605, A-0701, A-0905
let db: pg.Client, jonas0: { kyc_status: string; stage: string } | null = null, feeCond: string | null = null, actId = ''
const t0 = new Date()

// Бронь партнёра через форму; package — id брони-основы пакета
async function book(unit: string, pkg = '') {
  const ag = await login(U.agent)
  const f = formWith((await page(ag, `/units/${unit}/book`)).html, 'discount', 'client', 'unit')
  assert.ok(f, 'форма брони')
  const before = new Date()
  const r = await submit(ag, `/units/${unit}/book`, { ...f!, fields: f!.fields.filter(([k]) => k !== 'package') }, { discount: '0', client: JONAS, ...(pkg ? { package: pkg } : {}) })
  const b = (await db.query(`select * from portal.bookings where unit_id=$1 and created_at >= $2 order by created_at desc limit 1`, [unit, before])).rows[0]
  return { b, text: r.text }
}
// Действие с бронью (bookingAction) от имени пользователя
async function act(who: string, id: string, a: string) {
  if (!actId) { const h = (await page(await login(U.owner), '/bookings')).html; for (const f of h.split('<form').slice(1)) if (f.includes('name="act"')) { const m = f.match(/name="\$ACTION_ID_([0-9a-f]+)"/); if (m) { actId = m[1]; break } } }
  assert.ok(actId, 'id действия брони')
  const fd = new FormData(); fd.append('$ACTION_ID_' + actId, ''); fd.append('id', id); fd.append('act', a)
  return (await fetch(URL0 + '/bookings', { method: 'POST', body: fd, headers: { cookie: await login(who) }, redirect: 'manual' })).status
}
const bk = async (id: string) => (await db.query('select status, group_id, fee_status, fee_amount::float, fee_currency, fee_usd::float from portal.bookings where id=$1', [id])).rows[0]
const cancelAll = () => db.query(`update portal.bookings set status='cancelled' where client_id=$1 and created_at >= $2 and status in ('requested','confirmed')`, [JONAS, t0])
const userId = async (email: string) => (await db.query('select id from portal.users where email=$1', [email])).rows[0].id as string

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  jonas0 = (await db.query('select kyc_status, stage from portal.clients where id=$1', [JONAS])).rows[0]
  await db.query(`update portal.clients set kyc_status='passed' where id=$1`, [JONAS])
})
after(async () => {
  if (SKIP) return
  const bs = (await db.query(`select id from portal.bookings where client_id=$1 and created_at >= $2`, [JONAS, t0])).rows.map((r) => r.id)
  const ds = (await db.query(`select id from portal.deals where booking_id = any($1)`, [bs])).rows.map((r) => r.id)
  await db.query('delete from portal.commission_acts where deal_id = any($1)', [ds])
  await db.query('delete from portal.deals where id = any($1)', [ds])
  await db.query('delete from portal.bookings where id = any($1)', [bs])
  await db.query(`delete from portal.notifications where created_at >= $1 and (link in ('/bookings','/bookings?f=fee','/commission') or dedup like 'fee-left:%')`, [t0])
  if (feeCond) await db.query('delete from portal.conditions where id=$1', [feeCond])
  await db.query(`delete from portal.conditions where project_id=$1 and status='draft' and created_at >= $2`, [BR, t0])
  if (jonas0) await db.query('update portal.clients set kyc_status=$2, stage=$3 where id=$1', [JONAS, jonas0.kyc_status, jonas0.stage])
  await db.end()
})

test('пакет: вторая бронь к активной брони того же клиента получает общий group_id; к чужой или снятой — ошибка', { skip: SKIP }, async () => {
  const a = await book(UNITS[0]); assert.ok(a.b, 'первая бронь')
  const b = await book(UNITS[1], a.b.id); assert.ok(b.b, 'бронь пакетом')
  assert.equal((await bk(a.b.id)).group_id, a.b.id); assert.equal((await bk(b.b.id)).group_id, a.b.id)
  // основа — бронь другого клиента
  const other = (await db.query(`select id from portal.bookings where client_id <> $1 and status in ('requested','confirmed') limit 1`, [JONAS])).rows[0]?.id
  if (other) assert.equal((await book(UNITS[2], other)).b, undefined, 'пакет с бронью чужого клиента')
  await db.query(`update portal.bookings set status='cancelled' where id=$1`, [b.b.id])
  assert.equal((await book(UNITS[2], b.b.id)).b, undefined, 'пакет со снятой бронью')
  await cancelAll()
})

test('партнёр в форме брони видит в «Пакетом с бронью» только брони своих клиентов', { skip: SKIP }, async () => {
  const a = await book(UNITS[0])
  const others = (await db.query(`select id from portal.bookings where agent_id <> $1 and status in ('requested','confirmed')`, [SOPHIE])).rows.map((r) => r.id)
  const h = (await page(await login(U.agent), `/units/${UNITS[1]}/book`)).html
  assert.ok(h.includes(a.b.id), 'своя бронь в списке пакета')
  for (const id of others) assert.ok(!h.includes(id), `чужая бронь ${id} видна партнёру`)
  await cancelAll()
})

test('договор по пакету: confirmed → по сделке на квартиру с group_id и актом, requested остаётся; потом дооформляется в ту же группу', { skip: SKIP }, async () => {
  const a = await book(UNITS[0]), b = await book(UNITS[1], a.b.id), c = await book(UNITS[2], a.b.id)
  for (const x of [a, b]) { await act(U.office, x.b.id, 'confirm'); assert.equal((await bk(x.b.id)).status, 'confirmed') }
  // две вкладки одновременно
  await Promise.all([act(U.owner, a.b.id, 'contract'), act(U.owner, b.b.id, 'contract')])
  const ds = (await db.query(`select id, booking_id, group_id, agent_amount::float from portal.deals where booking_id = any($1) and stage <> 'cancelled'`, [[a.b.id, b.b.id, c.b.id]])).rows
  assert.equal(ds.length, 2, `сделок: ${ds.length}`)
  assert.ok(ds.every((d) => d.group_id === a.b.id))
  assert.equal((await bk(c.b.id)).status, 'requested')
  assert.equal((await db.query(`select count(*)::int n from portal.commission_acts where deal_id = any($1)`, [ds.map((d) => d.id)])).rows[0].n, 2, 'акт по каждой сделке')
  await act(U.office, c.b.id, 'confirm'); await act(U.owner, c.b.id, 'contract')
  const d3 = (await db.query(`select group_id from portal.deals where booking_id=$1`, [c.b.id])).rows[0]
  assert.equal(d3?.group_id, a.b.id, 'третья квартира пакета не в той же группе')
  assert.equal((await db.query('select stage from portal.clients where id=$1', [JONAS])).rows[0].stage, 'contract')
})

test('стадия клиента только вперёд: новая бронь не возвращает из «Оплаты» в «Бронь»', { skip: SKIP }, async () => {
  await db.query(`update portal.clients set stage='payments' where id=$1`, [JONAS])
  // прошлые сделки теста отменяем, чтобы освободить лимиты и квартиры
  await db.query(`update portal.deals set stage='cancelled' where client_id=$1 and created_at >= $2`, [JONAS, t0])
  const a = await book(UNITS[0]); assert.ok(a.b, 'бронь')
  assert.equal((await db.query('select stage from portal.clients where id=$1', [JONAS])).rows[0].stage, 'payments')
  await cancelAll()
})

test('платная бронь: взнос в AZN → $, офис не подтверждает до взноса; взнос отмечают только owner/office/finance; при договоре — засчитан', { skip: SKIP }, async () => {
  const cur = (await db.query(`select * from portal.conditions where project_id=$1 and status='published' order by valid_from desc, version desc limit 1`, [BR])).rows[0]
  const v = (await db.query('select coalesce(max(version),0)+1 v from portal.conditions where project_id=$1', [BR])).rows[0].v
  const cols = Object.keys(cur).filter((k) => !['id', 'version', 'status', 'valid_from', 'created_at', 'booking_fee', 'booking_fee_currency'].includes(k))
  feeCond = (await db.query(`insert into portal.conditions (${cols.join(', ')}, version, status, valid_from, booking_fee, booking_fee_currency)
    select ${cols.join(', ')}, $2, 'published', current_date, 170, 'AZN' from portal.conditions where id=$1 returning id`, [cur.id, v])).rows[0].id
  const a = await book(UNITS[0]); assert.ok(a.b, 'бронь')
  assert.deepEqual([a.b.fee_status, Number(a.b.fee_amount), a.b.fee_currency, Number(a.b.fee_usd)], ['due', 170, 'AZN', 100])
  const office = await userId(U.office)
  assert.ok((await db.query(`select 1 from portal.notifications where user_id=$1 and created_at >= $2 and text like '%взнос%'`, [office, t0])).rows.length, 'офису не ушло «ждём взнос»')
  await act(U.office, a.b.id, 'confirm'); assert.equal((await bk(a.b.id)).status, 'requested', 'подтверждена без взноса')
  for (const who of [U.agent, U.seller, U.head]) { await act(who, a.b.id, 'fee_paid'); assert.equal((await bk(a.b.id)).fee_status, 'due', who) }
  await act(U.finance, a.b.id, 'fee_paid'); assert.equal((await bk(a.b.id)).fee_status, 'paid')
  await act(U.office, a.b.id, 'confirm'); assert.equal((await bk(a.b.id)).status, 'confirmed')
  await act(U.owner, a.b.id, 'contract')
  assert.deepEqual([(await bk(a.b.id)).status, (await bk(a.b.id)).fee_status], ['converted', 'credited'])
})

test('снятая оплаченная бронь: финансы и владелец уведомлены; вернуть/удержать — только owner/finance и только у снятой', { skip: SKIP }, async () => {
  assert.ok(feeCond, 'нужна версия условий со взносом (предыдущий тест)')
  await db.query(`update portal.deals set stage='cancelled' where client_id=$1 and created_at >= $2`, [JONAS, t0])
  const a = await book(UNITS[1]); assert.ok(a.b)
  await act(U.office, a.b.id, 'fee_paid')
  await act(U.owner, a.b.id, 'fee_refund'); assert.equal((await bk(a.b.id)).fee_status, 'paid', 'возврат взноса по активной брони')
  const t1 = new Date()
  await act(U.agent, a.b.id, 'cancel'); assert.equal((await bk(a.b.id)).status, 'cancelled')
  const fin = await userId(U.finance), own = await userId(U.owner)
  const nn = (await db.query(`select user_id from portal.notifications where created_at >= $1 and link='/bookings?f=fee'`, [t1])).rows.map((r) => r.user_id)
  assert.ok(nn.includes(fin) && nn.includes(own), 'финансы и владелец не уведомлены')
  await act(U.office, a.b.id, 'fee_keep'); assert.equal((await bk(a.b.id)).fee_status, 'paid', 'офис удержал взнос')
  await act(U.finance, a.b.id, 'fee_keep'); assert.equal((await bk(a.b.id)).fee_status, 'kept')
  await act(U.finance, a.b.id, 'fee_refund'); assert.equal((await bk(a.b.id)).fee_status, 'kept', 'после решения статус поменялся ещё раз')
})

test('tick: истёкшая оплаченная бронь — одно уведомление финансам и владельцу, повтор tick без дублей', { skip: SKIP }, async () => {
  assert.ok(feeCond)
  const a = await book(UNITS[2]); assert.ok(a.b)
  await act(U.office, a.b.id, 'fee_paid')
  await db.query(`update portal.bookings set ends_at = now() - interval '1 hour' where id=$1`, [a.b.id])
  execFileSync('node', ['scripts/tick.mjs']); execFileSync('node', ['scripts/tick.mjs'])
  assert.equal((await bk(a.b.id)).status, 'expired')
  const n = (await db.query(`select user_id, count(*)::int n from portal.notifications where dedup like $1 group by user_id`, [`fee-left:${a.b.id}:%`])).rows
  const fin = await userId(U.finance), own = await userId(U.owner)
  assert.deepEqual(n.filter((x) => [fin, own].includes(x.user_id)).map((x) => x.n), [1, 1])
})

test('условия: взнос в черновике — отрицательный и не число отклоняются; дата вступления сохраняется и видна в форме', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const path = `/admin/conditions?p=brabus-island-baku`
  const f = forms((await page(o, path)).html).find((x) => x.fields.some(([k]) => k === 'booking_fee'))
  assert.ok(f, 'форма условий со взносом')
  const base = { ...f!, fields: f!.fields.filter(([k]) => k !== 'publish') }
  const drafts = async () => (await db.query(`select valid_from::text, booking_fee::float, booking_fee_currency from portal.conditions where project_id=$1 and status='draft'`, [BR])).rows
  for (const bad of ['-5', 'abc']) {
    await submit(o, path, base, { booking_fee: bad, booking_fee_currency: 'USD', valid_from: '2027-01-15' })
    assert.ok(!(await drafts()).some((d) => d.valid_from === '2027-01-15'), `взнос «${bad}» сохранён`)
  }
  await submit(o, path, base, { booking_fee: '50', booking_fee_currency: 'EUR', valid_from: '2027-01-15' })
  assert.deepEqual(await drafts(), [{ valid_from: '2027-01-15', booking_fee: 50, booking_fee_currency: 'EUR' }])
  assert.ok((await page(o, path)).html.includes('value="2027-01-15"'), 'дата черновика не видна в форме')
})
