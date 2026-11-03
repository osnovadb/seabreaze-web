// М10: план и факт. Тест заводит свои сделки в 3-м квартале 2026 (там нет других) и свои планы на 2026-Q3/2026-07, потом удаляет.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type pg from 'pg'
import { SKIP, URL0, U, dbConnect, login, page, formWith, submit } from './_portal'

const DIRK = '1a047999-ee3f-4693-bb34-af813e95c076', NOA = '98c5ca2f-9a17-4fb4-bce3-cbec84f423e7'
const MARTIN = '689c9cac-e756-4409-ac56-636c517d1acd', NOAM = '77a726f1-0fef-4144-a11d-c8cd4c01a91a', SOPHIE = '430537a7-4a4b-4724-b9fb-ef4f85a1d5ed'
let db: pg.Client, ids: string[] = []
async function deal(client: string, seller: string, agent: string | null, at: string, price: number, our: number, stage = 'contract') {
  const u = (await db.query(`select id, project_id from units where status='available' limit 1`)).rows[0]
  const r = await db.query(`insert into portal.deals (client_id, unit_id, project_id, agent_id, seller_id, final_price, our_amount, stage, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [client, u.id, u.project_id, agent, seller, price, our, stage, at])
  ids.push(r.rows[0].id)
}
async function xlsx(cookie: string, qs: string) {
  const r = await fetch(`${URL0}/reports/plan/xlsx?${qs}`, { headers: { cookie } })
  if (r.status !== 200) return { status: r.status }
  const f = path.join(os.tmpdir(), `qa-plan-${Date.now()}.xlsx`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()))
  const j = JSON.parse(execFileSync('python3', ['tests/integration/xlsx2json.py', f], { encoding: 'utf8' })); fs.rmSync(f)
  return { status: 200, ...j } as { status: number; sheets: Record<string, any[][]>; warnings: string[] }
}
// строка листа «рынки»: [имя, план шт, факт шт, план м², факт м², план объём, факт объём, ...]
const row = (sheet: any[][], name: string) => sheet.find((r) => r[0] === name)

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  assert.equal((await db.query(`select count(*)::int n from portal.deals where created_at >= '2026-07-01' and created_at < '2026-10-01'`)).rows[0].n, 0, 'в Q3 2026 уже есть сделки — тест не изолирован')
  await deal(DIRK, MARTIN, SOPHIE, '2026-07-15T10:00:00Z', 100000, 5000)
  await deal(DIRK, MARTIN, null, '2026-08-10T10:00:00Z', 200000, 8000, 'payments')
  await deal(DIRK, MARTIN, null, '2026-08-12T10:00:00Z', 999999, 99999, 'cancelled')
  await deal(NOA, NOAM, null, '2026-09-20T10:00:00Z', 300000, 9000)
})
after(async () => {
  if (SKIP) return
  await db.query('delete from portal.deals where id = any($1)', [ids])
  await db.query(`delete from portal.sales_plans where period_start in ('2026-07-01') `)
  await db.end()
})

test('факт: расторгнутая сделка не считается; квартал = сумма трёх месяцев', { skip: SKIP }, async () => {
  const own = await login(U.owner)
  const q = await xlsx(own, 'kind=quarter&p=2026-Q3'); assert.equal(q.status, 200)
  const months = await Promise.all(['2026-07', '2026-08', '2026-09'].map((m) => xlsx(own, 'kind=month&p=' + m)))
  const sheet = Object.keys(q.sheets)[0]
  const de = row(q.sheets[sheet], 'DE'), il = row(q.sheets[sheet], 'IL')
  assert.equal(de[2], 2, 'DE штук за квартал (без расторгнутой)'); assert.equal(de[6], 300000, 'DE объём')
  assert.equal(il[2], 1); assert.equal(il[6], 300000)
  for (const m of ['DE', 'IL']) {
    const sum = months.reduce((a, x) => a + Number(row(x.sheets[sheet], m)[6] || 0), 0)
    assert.equal(sum, row(q.sheets[sheet], m)[6], `${m}: квартал ≠ сумма месяцев`)
  }
})
test('xlsx открывается без предупреждений, 4 листа, кириллица и иврит целы', { skip: SKIP }, async () => {
  const x = await xlsx(await login(U.owner), 'kind=quarter&p=2026-Q3')
  assert.deepEqual(x.warnings, [])
  assert.equal(Object.keys(x.sheets).length, 4)
  const all = JSON.stringify(x.sheets)
  assert.ok(/[А-Яа-я]/.test(all), 'кириллица (имена менеджеров)')
  // иврит: временно ставим владельцу язык he (заголовки листов и колонок — на языке пользователя)
  const loc = (await db.query(`select locale from portal.users where email=$1`, [U.owner])).rows[0].locale
  await db.query(`update portal.users set locale='he' where email=$1`, [U.owner])
  try {
    const he = await xlsx(await login(U.owner), 'kind=quarter&p=2026-Q3')
    assert.deepEqual(he.warnings, [])
    assert.ok(/[\u0590-\u05FF]/.test(JSON.stringify(he.sheets)) || Object.keys(he.sheets).some((n) => /[\u0590-\u05FF]/.test(n)), 'иврит в листах')
    fs.writeFileSync('/tmp/qa-plan-he.json', JSON.stringify(Object.keys(he.sheets)))
  } finally { await db.query(`update portal.users set locale=$2 where email=$1`, [U.owner, loc]) }
})
test('доступ: seller и agent — редирект с /reports/plan, xlsx 403; finance видит', { skip: SKIP }, async () => {
  for (const who of [U.seller, U.agent]) {
    const c = await login(who)
    assert.notEqual((await page(c, '/reports/plan')).status, 200, who)
    assert.equal((await xlsx(c, 'kind=month')).status, 403, who)
  }
  assert.equal((await page(await login('irina.finance@demo.getsestate'), '/reports/plan')).status, 200)
})
test('market_head DE: в xlsx нет строки IL; план IL прямым POST не сохраняется', { skip: SKIP }, async () => {
  const head = await login(U.head)
  const x = await xlsx(head, 'kind=quarter&p=2026-Q3')
  const sheet = Object.values(x.sheets)[0]
  assert.ok(row(sheet, 'DE') && !row(sheet, 'IL') && !row(sheet, 'GLOBAL'))
  const f = formWith((await page(head, '/reports/plan?kind=month&p=2026-07')).html, 'kind', 'key')!
  await submit(head, '/reports/plan?kind=month&p=2026-07', f, { kind: 'month', key: '2026-07', 'market:IL:units': '7', 'market:DE:units': '3' })
  const plans = (await db.query(`select scope_id, units from portal.sales_plans where period_kind='month' and period_start='2026-07-01' and scope='market'`)).rows
  assert.ok(!plans.some((p) => p.scope_id === 'IL'), 'план IL не должен сохраниться')
  assert.equal(plans.find((p) => p.scope_id === 'DE')?.units, 3, 'свой рынок сохраняется')
})
test('план: отрицательное число — ошибка и ничего не сохраняется; пусто — план удаляется; finance не правит', { skip: SKIP }, async () => {
  const own = await login(U.owner)
  const f = formWith((await page(own, '/reports/plan?kind=month&p=2026-07')).html, 'kind', 'key')!
  const get = async (m: string) => (await db.query(`select units from portal.sales_plans where period_kind='month' and period_start='2026-07-01' and scope='market' and scope_id=$1`, [m])).rows[0]?.units
  // DE хорошая строка идёт раньше плохой IL — частичного сохранения быть не должно
  await submit(own, '/reports/plan?kind=month&p=2026-07', f, { kind: 'month', key: '2026-07', 'market:DE:units': '9', 'market:IL:units': '-1' })
  assert.equal(await get('IL'), undefined)
  assert.notEqual(await get('DE'), 9, 'при ошибке не должно сохраняться ничего (сейчас сохраняются строки до ошибочной)')
  await submit(own, '/reports/plan?kind=month&p=2026-07', f, { kind: 'month', key: '2026-07', 'market:DE:units': '', 'market:DE:area': '', 'market:DE:revenue': '', 'market:DE:commission': '' })
  assert.equal(await get('DE'), undefined, 'пустая строка удаляет план')
  const fin = await login('irina.finance@demo.getsestate')
  await submit(fin, '/reports/plan?kind=month&p=2026-07', f, { kind: 'month', key: '2026-07', 'market:GLOBAL:units': '4' })
  assert.equal(await get('GLOBAL'), undefined, 'finance только читает')
})
test('процент выполнения при пустом плане — «—»', { skip: SKIP }, async () => {
  const h = (await page(await login(U.owner), '/reports/plan?kind=quarter&p=2026-Q3')).html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
  const i = h.indexOf('|IL|'); assert.ok(i >= 0)
  assert.ok(h.slice(i, i + 80).includes('—'), h.slice(i, i + 80))
})
