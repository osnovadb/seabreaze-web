// Синхронизация с Profitbase (8e82dba) на заглушке стенда: tick шаг 10 локально, заглушка — ams 127.0.0.1:3099 через туннель
// (ssh -L 3099:127.0.0.1:3099 ams), ключ заглушки — из окружения (PB_KEY_MOCK, scratchpad pb.env; в отчёты не попадает).
// Фикстуру /opt/ge-portal2/pb-mock.json правим по ssh и возвращаем; квартиры Marina, замки, брони и очередь — тоже.
// Таймер стенда (раз в 15 минут) работает с той же фикстурой — результаты от него не зависят.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import path from 'node:path'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, formWith, submit } from './_portal'

const MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f', JONAS = 'f1b6864b-caa0-4de0-a319-583b1c29b664'
const FIX = '/opt/ge-portal2/pb-mock.json'
const skip = SKIP || (!process.env.PB_KEY_MOCK ? 'нужен PB_KEY_MOCK и туннель 3099' : false)
let db: pg.Client, fix0 = '', units0: Record<string, unknown>[] = [], sales0 = '', kyc0 = '', stage0 = ''
const t0 = new Date()

const ssh = (cmd: string, input?: string) => execFileSync('ssh', ['ams', cmd], { encoding: 'utf8', input })
// Правка фикстуры: py — выражение над d (dict); P(n) — квартира по номеру
const fx = (py: string) => ssh(`python3 -c "
import json,sys
f='${FIX}';d=json.load(open(f))
P=lambda n:[x for x in d['properties'] if x['number']==n][0]
${py.replace(/"/g, '\\"')}
json.dump(d,open(f,'w'),indent=1)"`)
const prop = (n: string) => JSON.parse(ssh(`python3 -c "import json;d=json.load(open('${FIX}'));print(json.dumps([x for x in d['properties'] if x['number']=='${n}'][0]))"`))
const tick = () => JSON.parse(execFileSync('node', ['scripts/tick.mjs'], { encoding: 'utf8', env: process.env }).trim().split(' ').slice(1).join(' '))
const unit = async (n: string) => (await db.query(`select id, status, price_list::float p, locked_fields, raw, external_id from units where project_id=$1 and number=$2`, [MARINA, n])).rows[0]
const aid = (file: string, name: string) => crypto.createHash('sha1').update(`${path.resolve(file)}:${name}`).digest('hex')
async function call(who: string, file: string, name: string, fields: [string, string][], at = '/bookings') {
  const fd = new FormData(); fd.append('$ACTION_ID_' + aid(file, name), '')
  for (const [k, v] of fields) fd.append(k, v)
  return (await fetch(URL0 + at, { method: 'POST', body: fd, headers: { cookie: await login(who) }, redirect: 'manual' })).status
}
async function book(unitId: string) {
  const ag = await login(U.agent)
  const f = formWith((await page(ag, `/units/${unitId}/book`)).html, 'discount', 'client', 'unit')
  assert.ok(f, 'форма брони Marina')
  const t = new Date()
  await submit(ag, `/units/${unitId}/book`, { ...f!, fields: f!.fields.filter(([k]) => k !== 'package') }, { discount: '0', client: JONAS })
  return (await db.query(`select id from portal.bookings where unit_id=$1 and created_at >= $2`, [unitId, t])).rows[0]?.id as string
}
const act = (who: string, id: string, a: string) => call(who, 'lib/actions.ts', 'bookingAction', [['id', id], ['act', a]])

before(async () => {
  if (skip) return
  db = await dbConnect()
  fix0 = ssh(`cat ${FIX}`)
  units0 = (await db.query(`select id, status, price_list, locked_fields, raw from units where project_id=$1`, [MARINA])).rows
  sales0 = (await db.query(`select sales_status from portal.project_settings where project_id=$1`, [MARINA])).rows[0]?.sales_status
  const j = (await db.query(`select kyc_status, stage from portal.clients where id=$1`, [JONAS])).rows[0]; kyc0 = j.kyc_status; stage0 = j.stage
  tick() // исходная синхронизация
})
after(async () => {
  if (skip) return
  ssh(`cat > ${FIX}`, fix0)
  const bs = (await db.query(`select id from portal.bookings where created_at >= $1 and unit_id in (select id from units where project_id=$2)`, [t0, MARINA])).rows.map((r) => r.id)
  const ds = (await db.query(`select id from portal.deals where booking_id = any($1)`, [bs])).rows.map((r) => r.id)
  await db.query('delete from portal.commission_acts where deal_id = any($1)', [ds])
  await db.query('delete from portal.deals where id = any($1)', [ds])
  await db.query('delete from portal.pb_outbox where created_at >= $1', [t0])
  await db.query('delete from portal.bookings where id = any($1)', [bs])
  await db.query(`delete from portal.tasks where created_at >= $1 and title like 'Profitbase%'`, [t0]).catch(() => {})
  for (const u of units0) await db.query(`update units set status=$2, price_list=$3, locked_fields=$4, raw=$5 where id=$1`, [u.id, u.status, u.price_list, JSON.stringify(u.locked_fields), u.raw])
  await db.query(`update units set locked_fields='[]' where project_id=$1`, [MARINA])
  if (sales0) await db.query(`update portal.project_settings set sales_status=$2 where project_id=$1`, [MARINA, sales0])
  await db.query(`update portal.clients set kyc_status=$2, stage=$3 where id=$1`, [JONAS, kyc0, stage0])
  await db.end()
})

test('сопоставление: все 11 квартир Marina связаны с Profitbase; цена из фикстуры приходит с журналом sync:pb:mock', { skip }, async () => {
  const n = (await db.query(`select count(*)::int n from units where project_id=$1 and external_id is not null and source_id='pb:mock'`, [MARINA])).rows[0].n
  assert.equal(n, 11)
  fx(`P('201')['price']['value']=150500`)
  tick()
  const u = await unit('201')
  assert.equal(u.p, 150500)
  const e = (await db.query(`select source from portal.unit_events where unit_id=$1 and kind='price' order by id desc limit 1`, [u.id])).rows[0]
  assert.equal(e.source, 'sync:pb:mock')
  assert.deepEqual(u.locked_fields, [], 'синхронизация поставила замок')
})

test('ручная правка цены ставит замок — синхронизация цену не перетирает, статус — да', { skip }, async () => {
  const u = await unit('202')
  await db.query(`update units set price_list = 151111 where id=$1`, [u.id]) // как ручная правка (без app.sync_source)
  assert.deepEqual((await unit('202')).locked_fields, ['price_list'])
  fx(`P('202')['price']['value']=152222; P('202')['status']='BOOKED'`)
  tick()
  const v = await unit('202')
  assert.equal(v.p, 151111); assert.equal(v.status, 'reserved')
})

test('ручная смена статуса (массово или быстрая правка) не должна навсегда отрезать «продано» от застройщика', { skip }, async () => {
  const u = await unit('301')
  await call(U.office, 'lib/objects.ts', 'bulkStatus', [['project', MARINA], ['status', 'unavailable'], ['units', u.id]], `/projects/test-marina/chess`)
  assert.equal((await unit('301')).status, 'unavailable')
  fx(`P('301')['status']='SOLD'`)
  tick()
  assert.equal((await unit('301')).status, 'sold', `застройщик продал, у нас ${(await unit('301')).status}; замок ${JSON.stringify((await unit('301')).locked_fields)}`)
})

test('исчезнувшая квартира → «не в продаже» с gone_at; вернулась — снова в работе; исчезла второй раз — снова отмечена', { skip }, async () => {
  fx(`d['properties']=[x for x in d['properties'] if x['number']!='601']`)
  tick()
  let u = await unit('601')
  assert.equal(u.status, 'unavailable'); assert.ok(u.raw?.pb?.gone_at, 'нет gone_at')
  ssh(`python3 -c "import json;a=json.loads(open('/dev/stdin').read());f='${FIX}';d=json.load(open(f));d['properties'].append([x for x in a['properties'] if x['number']=='601'][0]);json.dump(d,open(f,'w'),indent=1)"`, fix0)
  tick()
  u = await unit('601')
  assert.equal(u.status, 'available', 'вернувшаяся квартира не вернулась в продажу')
  fx(`d['properties']=[x for x in d['properties'] if x['number']!='601']`)
  await db.query(`update units set status='available' where id=$1`, [u.id]).catch(() => {})
  await db.query(`update units set locked_fields='[]' where id=$1`, [u.id])
  tick()
  assert.equal((await unit('601')).status, 'unavailable', 'исчезла второй раз — осталась в продаже (gone_at от первого раза)')
})

test('неизвестный пользовательский статус застройщика → «не в продаже»', { skip }, async () => {
  fx(`P('302')['customStatusId']=999; P('302')['status']='AVAILABLE'`)
  tick()
  assert.equal((await unit('302')).status, 'unavailable', `статус ${(await unit('302')).status}`)
})

test('запись в Profitbase: подтверждение → ge_booking, снятие → AVAILABLE, договор → ge_sold', { skip }, async () => {
  await db.query(`update portal.project_settings set sales_status='sales' where project_id=$1`, [MARINA])
  await db.query(`update portal.clients set kyc_status='passed' where id=$1`, [JONAS])
  const u5 = await unit('501'), u6 = await unit('502')
  const b1 = await book(u5.id); assert.ok(b1, 'бронь 501')
  await act(U.office, b1, 'confirm'); tick()
  assert.equal(prop('501').customStatusId, 501, 'ge_booking не записан в Profitbase')
  await act(U.agent, b1, 'cancel'); tick()
  assert.equal(prop('501').status, 'AVAILABLE', 'снятие не записано')
  const b2 = await book(u6.id); assert.ok(b2, 'бронь 502')
  await act(U.office, b2, 'confirm'); await act(U.owner, b2, 'contract'); tick()
  assert.equal(prop('502').customStatusId, 502, 'ge_sold не записан')
  assert.equal((await unit('502')).status, 'sold', 'после синхронизации квартира не продана')
  const errs = (await db.query(`select count(*)::int n from portal.pb_outbox where created_at >= $1 and state <> 'sent'`, [t0])).rows[0].n
  assert.equal(errs, 0)
})

test('ошибка записи: на третьей неудаче — одна задача офису', { skip }, async () => {
  const u = await unit('401')
  const ext = u.external_id
  await db.query(`update units set external_id='999999' where id=$1`, [u.id]) // нет в Profitbase → 404
  try {
    await db.query(`insert into portal.pb_outbox (source_id, unit_id, op, status_alias) values ('pb:mock',$1,'reserve','ge_booking')`, [u.id])
    for (let i = 0; i < 4; i++) tick()
    const j = (await db.query(`select state, attempts from portal.pb_outbox where unit_id=$1 and created_at >= $2`, [u.id, t0])).rows[0]
    assert.equal(j.state, 'error'); assert.ok(j.attempts >= 3)
    const n = (await db.query(`select count(*)::int n from portal.tasks where created_at >= $1 and title like 'Profitbase%'`, [t0])).rows[0].n
    const office = (await db.query(`select count(*)::int n from portal.users where role='office' and active`)).rows[0].n
    assert.equal(n, office, `задач: ${n}`)
  } finally {
    await db.query(`update units set external_id=$2 where id=$1`, [u.id, ext])
  }
})

test('/sources: владелец и офис открывают; «Запустить сейчас» — owner и office; остальные — нет', { skip }, async () => {
  for (const who of [U.owner, U.office]) assert.equal((await page(await login(who), '/sources')).status, 200, who)
  for (const who of [U.agent, U.seller, U.head, U.finance]) assert.notEqual((await page(await login(who), '/sources')).status, 200, who)
})
