// Интеграция KYC: прямые запросы к server actions локального портала + проверка состояния в базе.
// Запуск: PORTAL_URL=http://localhost:3042 node --test --import tsx tests/integration/kyc.test.ts
// Нужны: локальный `next dev` (NODE_ENV≠production, работает /dev/login) и DATABASE_URL на seabreeze_v2 (туннель 5433).
// Тест сам возвращает статусы клиентов, которые трогал. Только для seabreeze_v2 — не запускать на базе теста v1 и боя.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

const URL0 = process.env.PORTAL_URL
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const DB = process.env.DATABASE_URL || env.DATABASE_URL
const skip = !URL0 || !DB || !/seabreeze_v2/.test(DB) ? 'нужны PORTAL_URL и DATABASE_URL на seabreeze_v2' : false

const U = { office: 'leyla.baku@demo.getsestate', owner: 'denis@demo.getsestate', head: 'anna.becker@demo.getsestate', seller: 'martin.schulz@demo.getsestate', agent: 'sophie.lang@demo.getsestate' }
const C = { dirk: '1a047999-ee3f-4693-bb34-af813e95c076', michael: '62ccf16d-10ce-4b6a-b07a-e85f618a7309', jonas: 'f1b6864b-caa0-4de0-a319-583b1c29b664' }
let db: pg.Client, saved: any[] = []
const A: Record<string, string> = {}

async function login(email: string) {
  const r = await fetch(`${URL0}/dev/login?as=${encodeURIComponent(email)}`, { redirect: 'manual' })
  const c = (r.headers.get('set-cookie') || '').split(';')[0]
  assert.ok(c.startsWith('ge_s='), 'нет cookie сессии от /dev/login')
  return c
}
async function html(cookie: string, path: string) { return (await fetch(URL0 + path, { headers: { cookie } })).text() }
// id server action из формы, где есть поле name (по старому образцу «$ACTION_ID_<id>»)
function actionId(page: string, field: string) {
  for (const f of page.split('<form').slice(1)) if (f.includes(`name="${field}"`)) { const m = f.match(/name="\$ACTION_ID_([0-9a-f]+)"/); if (m) return m[1] }
  return ''
}
async function post(cookie: string, path: string, id: string, fields: Record<string, string>) {
  const fd = new FormData(); fd.append('$ACTION_ID_' + id, ''); for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return (await fetch(URL0 + path, { method: 'POST', body: fd, headers: { cookie }, redirect: 'manual' })).status
}
const kyc = async (id: string) => (await db.query('select kyc_status, kyc_citizenship, kyc_tax_residence, kyc_pep from portal.clients where id = $1', [id])).rows[0]

before(async () => {
  if (skip) return
  db = new pg.Client({ connectionString: DB }); await db.connect()
  saved = (await db.query('select id, kyc_status, kyc_citizenship, kyc_tax_residence, kyc_pep, kyc_note from portal.clients where id = any($1)', [Object.values(C)])).rows
  const off = await login(U.office); const p = await html(off, `/clients/${C.dirk}`)
  A.review = actionId(p, 'decision'); A.save = actionId(p, 'citizenship')
  assert.ok(A.review && A.save, 'не нашёл формы KYC у офиса (Dirk Lange должен быть passed)')
})
after(async () => {
  if (skip) return
  for (const s of saved) await db.query('update portal.clients set kyc_status=$2, kyc_citizenship=$3, kyc_tax_residence=$4, kyc_pep=$5, kyc_note=$6 where id=$1', [s.id, s.kyc_status, s.kyc_citizenship, s.kyc_tax_residence, s.kyc_pep, s.kyc_note])
  await db.end()
})

test('seller, agent, market_head не могут принять решение даже прямым POST', { skip }, async () => {
  for (const who of [U.seller, U.agent, U.head]) {
    await post(await login(who), `/clients/${C.dirk}`, A.review, { client: C.dirk, decision: 'none' })
    assert.equal((await kyc(C.dirk)).kyc_status, 'passed', who)
  }
})
test('отклонение без причины (пробелы) не проходит', { skip }, async () => {
  await db.query(`update portal.clients set kyc_status='pending' where id=$1`, [C.dirk])
  await post(await login(U.office), `/clients/${C.dirk}`, A.review, { client: C.dirk, decision: 'rejected', note: '   ' })
  assert.equal((await kyc(C.dirk)).kyc_status, 'pending')
})
test('цикл: отклонён → без PEP не отправить → исправили → pending → passed', { skip }, async () => {
  const off = await login(U.office), sel = await login(U.seller)
  await post(off, `/clients/${C.dirk}`, A.review, { client: C.dirk, decision: 'rejected', note: 'QA: скан нечитаемый' })
  assert.equal((await kyc(C.dirk)).kyc_status, 'rejected')
  const page = await html(sel, `/clients/${C.dirk}`)
  // кнопка «Отправить на проверку KYC» (у продавца интерфейс на RU); в форме загрузки документов тоже есть «KYC» — её не берём
  const sub = page.split('<form').slice(1).find((f) => /<button[^>]*>[^<]*проверку KYC/.test(f))
  const sid = sub?.match(/name="\$ACTION_ID_([0-9a-f]+)"/)?.[1] || ''
  assert.ok(sid, 'нет кнопки «Отправить на проверку KYC» у отклонённого')
  await post(sel, `/clients/${C.dirk}`, A.save, { client: C.dirk, citizenship: 'Deutschland', tax_residence: 'Deutschland', pep: '' })
  await post(sel, `/clients/${C.dirk}`, sid, { client: C.dirk })
  assert.equal((await kyc(C.dirk)).kyc_status, 'rejected', 'без PEP отправка должна быть заблокирована')
  await post(sel, `/clients/${C.dirk}`, A.save, { client: C.dirk, citizenship: 'Deutschland', tax_residence: 'Deutschland', pep: 'no' })
  await post(sel, `/clients/${C.dirk}`, sid, { client: C.dirk })
  assert.equal((await kyc(C.dirk)).kyc_status, 'pending')
  const sent = async () => (await db.query(`select count(*)::int n from portal.activities where client_id=$1 and text='KYC отправлен на проверку'`, [C.dirk])).rows[0].n
  const n0 = await sent()
  await post(sel, `/clients/${C.dirk}`, sid, { client: C.dirk })
  assert.equal(await sent(), n0, 'повторная отправка из pending не должна писать в историю')
  // анкета в pending заблокирована (по ТЗ) — ожидание; сейчас падает, это баг
  await post(sel, `/clients/${C.dirk}`, A.save, { client: C.dirk, citizenship: 'CHANGED', tax_residence: 'Deutschland', pep: 'no' })
  assert.equal((await kyc(C.dirk)).kyc_citizenship, 'Deutschland', 'анкета на проверке не должна меняться')
})
test('офис не может «пройти» KYC клиенту, которого не отправляли на проверку', { skip }, async () => {
  const st0 = (await kyc(C.michael)).kyc_status
  await post(await login(U.office), `/clients/${C.michael}`, A.review, { client: C.michael, decision: 'passed' })
  assert.equal((await kyc(C.michael)).kyc_status, st0, 'passed допустим только из pending')
})
test('«Договор подписан» без пройденного KYC — сервер отказывает', { skip }, async () => {
  const own = await login(U.owner)
  const page = await html(own, '/bookings')
  const ba = actionId(page, 'act')
  const b = (await db.query(`select b.id from portal.bookings b join portal.clients c on c.id=b.client_id where b.status='confirmed' and c.kyc_status<>'passed' limit 1`)).rows[0]
  if (!b) return
  await post(own, '/bookings', ba, { id: b.id, act: 'contract' })
  const st = (await db.query('select status from portal.bookings where id=$1', [b.id])).rows[0].status
  assert.equal(st, 'confirmed')
})
