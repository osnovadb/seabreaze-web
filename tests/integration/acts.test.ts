// М4: акты вознаграждения и клаубэк. Логику syncAct/payAct гоняем напрямую на seabreeze_v2 (свои сделки агента QA-набора),
// права — через локальный портал. Тест удаляет свои сделки (акты — каскадом).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, DB, U, URL0, dbConnect, login, page, forms, submit } from './_portal'

const SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed', DAVID_EMAIL = U.agentIl
const MICHAEL = '62ccf16d-10ce-4b6a-b07a-e85f618a7309', MARTIN = '689c9cac-e756-4409-ac56-636c517d1acd'
let db: pg.Client, acts: typeof import('../../lib/acts'), mine: string[] = [], docs: string[] = [], saved: { id: string; cl: number; deducted: number; status: string }[] = []
const deal = async (amount: number, stage = 'contract') => {
  const u = (await db.query(`select id, project_id from units where status='available' limit 1`)).rows[0]
  const id = (await db.query(`insert into portal.deals (client_id, unit_id, project_id, agent_id, seller_id, final_price, agent_amount, stage, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8, now() - interval '1 day') returning id`, [MICHAEL, u.id, u.project_id, SOPHIE, MARTIN, amount * 20, amount, stage])).rows[0].id
  mine.push(id); return id
}
const stage = async (id: string, st: string) => { await db.query('update portal.deals set stage=$2 where id=$1', [id, st]); await acts.syncAct(id) }
const act = async (dealId: string) => (await db.query('select status, amount::float, deducted::float, clawback_left::float cl from portal.commission_acts where deal_id=$1', [dealId])).rows[0]

before(async () => {
  if (SKIP) return
  process.env.DATABASE_URL = DB
  db = await dbConnect(); acts = await import('../../lib/acts')
  // чужие акты агента (в т.ч. возврат разработчика) наши выплаты будут гасить — запоминаем и потом возвращаем
  saved = (await db.query(`select id, clawback_left::float cl, deducted::float deducted, status from portal.commission_acts where agent_id=$1`, [SOPHIE])).rows
  await db.query(`update portal.commission_acts set clawback_left=0 where agent_id=$1 and clawback_left > 0`, [SOPHIE])
})
after(async () => {
  if (SKIP) return
  await db.query('delete from portal.notifications where user_id=$1 and created_at > now() - interval \'10 minutes\' and kind=\'payout\'', [SOPHIE])
  await db.query('delete from portal.deals where id = any($1)', [mine])
  // документ акта и его файлы (вместе с записью в документах клиента)
  await db.query(`with d as (delete from portal.documents where id = any($1) returning pdf_file_id, docx_file_id)
    delete from portal.files where id in (select pdf_file_id from d union select docx_file_id from d)`, [docs])
  for (const a of saved) await db.query('update portal.commission_acts set clawback_left=$2, deducted=$3, status=$4 where id=$1', [a.id, a.cl, a.deducted, a.status])
  await db.end(); (await import('../../lib/db')).pool.end()
})

test('стадии: contract → expected, fee_received → due, paid_out → paid; отмена до выплаты — void', { skip: SKIP }, async () => {
  const d = await deal(1000)
  await acts.syncAct(d); assert.equal((await act(d)).status, 'expected')
  await stage(d, 'fee_received'); assert.equal((await act(d)).status, 'due')
  const d2 = await deal(500, 'payments'); await acts.syncAct(d2)
  await stage(d2, 'cancelled'); assert.deepEqual(await act(d2), { status: 'void', amount: 500, deducted: 0, cl: 0 })
  await stage(d, 'cancelled')
})
test('два возврата и выплата меньше их суммы: удержание частичное, остаток сохраняется; повторный paid_out не удерживает второй раз', { skip: SKIP }, async () => {
  const a = await deal(3000), b = await deal(2000)
  for (const x of [a, b]) { await acts.syncAct(x); await stage(x, 'paid_out') }
  await stage(a, 'cancelled'); await stage(b, 'cancelled')
  assert.deepEqual([(await act(a)).cl, (await act(b)).cl], [3000, 2000])
  const c = await deal(1000); await acts.syncAct(c); await stage(c, 'paid_out')
  assert.equal((await act(c)).deducted, 1000, 'удержана вся выплата')
  assert.deepEqual([(await act(a)).cl, (await act(b)).cl], [2000, 2000], 'гасится старший возврат, остаток сохраняется')
  await stage(c, 'paid_out'); await stage(c, 'fee_received')
  assert.equal((await act(c)).deducted, 1000, 'повторная смена стадии — без второго удержания')
  assert.deepEqual([(await act(a)).cl, (await act(b)).cl], [2000, 2000])
  const d = await deal(4500); await acts.syncAct(d); await stage(d, 'paid_out')
  assert.equal((await act(d)).deducted, 4000, 'выплата больше долга: удержан весь остаток')
  assert.deepEqual([(await act(a)).cl, (await act(b)).cl, (await act(a)).status], [0, 0, 'clawback'])
  await stage(c, 'cancelled'); await stage(d, 'cancelled')
})
// Деньги: акт C выплачен с удержанием — его «удержано» погасило долг партнёра. Если C потом расторгнут, вернуть надо всю сумму C:
// партнёр получил её частью деньгами, частью — списанием долга. Сейчас возврат = amount − deducted.
test('расторжение акта, выплаченного с удержанием: возврат = вся сумма акта', { skip: SKIP }, async () => {
  await db.query(`update portal.commission_acts set clawback_left=0 where agent_id=$1`, [SOPHIE]) // остатки прошлых тестов
  const old = await deal(1000); await acts.syncAct(old); await stage(old, 'paid_out'); await stage(old, 'cancelled') // долг 1000
  const c = await deal(6000); await acts.syncAct(c); await stage(c, 'paid_out')                                     // 5000 деньгами + 1000 удержано
  assert.equal((await act(c)).deducted, 1000)
  await stage(c, 'cancelled')
  assert.equal((await act(c)).cl, 6000, 'партнёр получил по акту 6000 (5000 деньгами + 1000 зачётом долга) — вернуть 6000')
})
test('права: seller и agent не выплачивают акт и не создают документ; PDF акта — только своему партнёру', { skip: SKIP }, async () => {
  const d = await deal(700)
  await db.query(`update portal.deals set booking_id = (select id from portal.bookings where client_id=$2 limit 1) where id=$1`, [d, MICHAEL])
  await acts.syncAct(d); await stage(d, 'fee_received')
  const id = (await db.query('select id from portal.commission_acts where deal_id=$1', [d])).rows[0].id
  const fin = await login(U.finance)
  const fp = await page(fin, '/finance'); assert.equal(fp.status, 200)
  const mine = forms(fp.html).filter((f) => f.fields.some(([k, v]) => k === 'id' && v === id))
  const pay = mine.find((f) => f.html.includes('Выплатить')), doc = mine.find((f) => f.html.includes('Создать акт'))
  assert.ok(pay && doc, 'у финансов есть кнопки «Выплатить» и «Создать акт»')
  for (const who of [U.seller, U.agent]) {
    const c = await login(who)
    assert.notEqual((await page(c, '/finance')).status, 200, who + ' открыл /finance')
    await submit(c, '/finance', doc!, {}); await submit(c, '/finance', pay!, {})
    const r = (await db.query('select status, document_id from portal.commission_acts where id=$1', [id])).rows[0]
    assert.deepEqual(r, { status: 'due', document_id: null }, who + ' выплатил акт или создал документ')
  }
  // финансы создают акт → PDF видит свой партнёр, не видят чужой партнёр и продавец
  const made = await submit(fin, '/finance', doc!, {})
  const dd = (await db.query('select document_id from portal.commission_acts where id=$1', [id])).rows[0].document_id; if (dd) docs.push(dd)
  const pdf = (await db.query('select coalesce(doc.pdf_file_id, doc.docx_file_id) f from portal.commission_acts ca join portal.documents doc on doc.id = ca.document_id where ca.id=$1', [id])).rows[0]?.f
  assert.ok(pdf, 'документ акта не создан финансами: ' + (made.text.match(/"error":"([^"]+)/)?.[1] || made.status))
  const get = async (who: string) => (await fetch(URL0 + '/files/' + pdf, { headers: { cookie: await login(who) }, redirect: 'manual' })).status
  assert.equal(await get(U.agent), 200, 'свой партнёр скачивает')
  assert.equal(await get(U.agentIl), 404, 'чужой партнёр скачал PDF')
  const cm = await page(await login(U.agentIl), '/commission')
  assert.ok(!cm.html.includes('Michael Krause'), 'чужой акт виден агенту IL на /commission')
  await submit(fin, '/finance', pay!, {}); assert.equal((await act(d)).status, 'paid', 'финансы выплачивают')
  assert.equal(await get(U.seller), 404, 'продавец скачал PDF акта (акт лёг в документы клиента с internal=false)')
})
