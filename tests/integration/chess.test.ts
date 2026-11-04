// Импорт шахматки и копирование этажа (9620214): выгрузка = шаблон импорта, повторная загрузка того же файла — «без изменений»,
// ошибки с номером строки Excel, права только у владельца. Пишем только в «Тест · Marina Village» и всё возвращаем; на BRABUS
// и Premium Residence — только режим «Проверить». Копию этажа BRABUS удаляем.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, forms } from './_portal'

const MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f', BR = '00000000-0000-0000-0000-0000000000a1', PR = '00000000-0000-0000-0000-0000000000a2'
const BR_A = '00000000-0000-0000-0000-0000000000b1'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-chess-'))
let db: pg.Client, marina0: Record<string, unknown>[] = []
const t0 = new Date()

const xlsx = (rows: unknown[][]) => { const f = path.join(TMP, `f${Math.random().toString(36).slice(2)}.xlsx`); execFileSync('python3', ['tests/integration/json2xlsx.py', f], { input: JSON.stringify({ rows, title: 'Шахматка' }) }); return fs.readFileSync(f) }
const toRows = (buf: Buffer) => { const f = path.join(TMP, `r${Math.random().toString(36).slice(2)}.xlsx`); fs.writeFileSync(f, buf); return JSON.parse(execFileSync('python3', ['tests/integration/xlsx2json.py', f], { encoding: 'utf8' })) as unknown[][] }
const exportOf = async (c: string, pid: string) => fetch(`${URL0}/admin/objects/${pid}/export`, { headers: { cookie: c } })
// Отправить файл формой импорта; вернуть отчёт {create, update, same, errors}
async function imp(c: string, pid: string, file: Buffer, mode: 'check' | 'apply', name = 'chess.xlsx') {
  const f = forms((await page(c, `/admin/objects/${pid}?tab=units`)).html).find((x) => x.html.includes('name="file"') && x.html.includes('value="apply"'))
  assert.ok(f, 'форма импорта шахматки')
  const fd = new FormData()
  for (const [k, v] of f!.fields) if (k !== 'file' && k !== 'mode') fd.append(k, v)
  fd.append('mode', mode); fd.append('file', new Blob([file]), name)
  const txt = await (await fetch(`${URL0}/admin/objects/${pid}?tab=units`, { method: 'POST', body: fd, headers: { cookie: c } })).text()
  const m = txt.match(/"report":(\{[^}]*\})/)
  return { report: m ? JSON.parse(m[1]) : null, error: txt.match(/"error":"([^"]+)"/)?.[1] || null, txt }
}
const snap = async (pid: string) => (await db.query(`select id, number, floor, unit_type, bedrooms, area_total_m2, price_list, price_currency, status, view_side, is_corner, layout_id from units where project_id=$1 order by id`, [pid])).rows

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  marina0 = await snap(MARINA)
})
after(async () => {
  if (SKIP) return
  // вернуть Marina: удалить созданные квартиры, вернуть поля изменённых
  const ids = marina0.map((u) => u.id)
  await db.query(`delete from units where project_id=$1 and not (id = any($2))`, [MARINA, ids])
  for (const u of marina0) await db.query(`update units set floor=$2, unit_type=$3, bedrooms=$4, area_total_m2=$5, price_list=$6, price_currency=$7, status=$8, view_side=$9, is_corner=$10, layout_id=$11 where id=$1`,
    [u.id, u.floor, u.unit_type, u.bedrooms, u.area_total_m2, u.price_list, u.price_currency, u.status, u.view_side, u.is_corner, u.layout_id])
  // копии этажа в BRABUS (номера без префикса, созданные тестом)
  await db.query(`delete from units where project_id=$1 and source_id='manual' and id in (select unit_id from portal.unit_events where kind='created' and at >= $2)`, [BR, t0])
  await db.query(`delete from portal.unit_events where at >= $1 and unit_id not in (select id from units)`, [t0])
  fs.rmSync(TMP, { recursive: true, force: true })
  await db.end()
})

test('выгрузка и импорт — только владелец: офис, руководитель рынка, партнёр получают 403 / ничего не меняют', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const r = await exportOf(o, MARINA); assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') || '', /spreadsheetml/)
  for (const who of [U.office, U.head, U.agent]) assert.equal((await exportOf(await login(who), MARINA)).status, 403, who)
  const file = xlsx([['Корпус', 'Номер', 'Цена'], ['A', '101', 999999]])
  for (const who of [U.office, U.head, U.agent]) await imp(await login(who), MARINA, file, 'apply').catch(() => null)
  assert.deepEqual(await snap(MARINA), marina0, 'чужой импорт изменил квартиры')
})

test('повторная загрузка выгрузки — «без изменений» (Marina, Premium Residence, BRABUS)', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  for (const pid of [MARINA, PR, BR]) {
    const buf = Buffer.from(await (await exportOf(o, pid)).arrayBuffer())
    const n = (await db.query('select count(*)::int n from units where project_id=$1', [pid])).rows[0].n
    const { report, error } = await imp(o, pid, buf, 'check')
    assert.equal(error, null, `${pid}: ${error}`)
    assert.deepEqual([report.create, report.update, report.errorsTotal, report.same], [0, 0, 0, n], `${pid}: ${JSON.stringify(report)}`)
  }
})

test('ошибки с номером строки Excel (пустые строки учитываются), файл с ошибками не пишется', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const rows: unknown[][] = [['Корпус', 'Этаж', 'Номер', 'Тип', 'Цена', 'Валюта', 'Статус', 'Вид'],
    ['A', 1, '101', '', 151000, 'USD', 'свободна', ''],    // 2 — ок
    [],                                                    // 3 — пустая
    ['Z', 1, '777', '1br', 1, 'USD', '', ''],              // 4 — нет корпуса
    ['A', 2, '201', 'дворец', '', '', '', ''],              // 5 — тип
    ['A', 2, '202', '', 'дорого', '', '', ''],              // 6 — не число
    ['A', 3, '301', '', '', 'RUB', '', ''],                 // 7 — валюта
    ['A', 3, '302', '', '', '', 'думаем', ''],              // 8 — статус
    [], [],                                                // 9, 10
    ['A', 5, '501', '', '', '', '', 'на луну'],             // 11 — вид
    ['A', 1, 'A-101', '', '', '', '', ''],                  // 12 — дубль 101
    ['A', 6, '601', '', -5, '', '', ''],                    // 13 — минус
  ]
  const { report } = await imp(o, MARINA, xlsx(rows), 'apply')
  const lines = (report.errors as string[]).map((e) => Number(e.split(':')[0]))
  assert.deepEqual(lines, [4, 5, 6, 7, 8, 11, 12, 13], JSON.stringify(report.errors))
  assert.deepEqual(await snap(MARINA), marina0, 'файл с ошибками что-то записал')
})

test('цена 0 и площадь 0 — ошибка, а не «бесплатная» квартира', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const { report } = await imp(o, MARINA, xlsx([['Корпус', 'Номер', 'Цена', 'Площадь'], ['A', '101', 0, ''], ['A', '102', '', 0]]), 'check')
  assert.equal(report.errorsTotal, 2, JSON.stringify(report))
})

test('одинаковые номера в разных корпусах — разные квартиры (Premium Residence, только проверка)', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const r = (await db.query(`select coalesce(b.external_id, b.name) blk, u.number, u.price_list::float p from units u join buildings b on b.id=u.building_id where u.project_id=$1 and u.price_list is not null
    and u.number in (select number from units where project_id=$1 and price_list is not null group by number having count(distinct building_id) > 1 limit 1) order by 1 limit 2`, [PR])).rows
  assert.equal(r.length, 2)
  const { report } = await imp(o, PR, xlsx([['Корпус', 'Номер', 'Цена'], ...r.map((x) => [x.blk, x.number, x.p + 1])]), 'check')
  assert.deepEqual([report.update, report.create, report.errorsTotal], [2, 0, 0], JSON.stringify(report))
})

test('применение: цена обновлена, новая квартира «не в продаже» без цены, журнал с автором; повтор того же файла — без изменений', { skip: SKIP }, async () => {
  const o = await login(U.owner), owner = (await db.query('select id from portal.users where email=$1', [U.owner])).rows[0].id
  const file = xlsx([['Корпус', 'Этаж', 'Номер', 'Тип', 'Площадь', 'Цена'], ['A', 1, 'A-102', '', '', 150500], ['A', 9, '901', '1br', 55, '']])
  const a = await imp(o, MARINA, file, 'apply')
  assert.deepEqual([a.report?.update, a.report?.create], [1, 1], a.error || JSON.stringify(a.report))
  const u102 = (await db.query(`select id, price_list::float p from units where project_id=$1 and number='102'`, [MARINA])).rows[0]
  assert.equal(u102.p, 150500)
  const n = (await db.query(`select status, price_list from units where project_id=$1 and number='901'`, [MARINA])).rows[0]
  assert.deepEqual(n, { status: 'unavailable', price_list: null })
  const e = (await db.query(`select user_id, source from portal.unit_events where unit_id=$1 and kind='price' order by id desc limit 1`, [u102.id])).rows[0]
  assert.deepEqual(e, { user_id: owner, source: 'portal' })
  const b = await imp(o, MARINA, file, 'check')
  assert.deepEqual([b.report.update, b.report.create, b.report.same], [0, 0, 2], JSON.stringify(b.report))
})

test('импорт: только .xlsx, без колонок «Корпус»/«Номер» — понятная ошибка', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  assert.ok((await imp(o, MARINA, Buffer.from('a;b'), 'check', 'x.csv')).error)
  assert.ok((await imp(o, MARINA, xlsx([['Этаж', 'Цена'], [1, 1]]), 'check')).error)
})

test('копия этажа BRABUS (номера «A-0301»): существующие квартиры не дублируются', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const f = forms((await page(o, `/admin/objects/${BR}?tab=units&b=${BR_A}&fl=3`)).html).find((x) => x.fields.some(([k]) => k === 'source') && x.fields.some(([k]) => k === 'floor_from'))
  assert.ok(f, 'форма «Копировать этаж»')
  const fd = new FormData()
  for (const [k, v] of f!.fields) if (!['source', 'floor_from', 'floor_to', 'building', 'prices'].includes(k)) fd.append(k, v)
  // этаж 3 (A-0301, A-0305) → этаж 4, где уже есть A-0405
  fd.append('building', BR_A); fd.append('source', '3'); fd.append('floor_from', '4'); fd.append('floor_to', '4')
  await fetch(`${URL0}/admin/objects/${BR}?tab=units`, { method: 'POST', body: fd, headers: { cookie: o } })
  const fl4 = (await db.query(`select number from units where building_id=$1 and floor=4 order by number`, [BR_A])).rows.map((r) => r.number)
  assert.ok(!fl4.includes('405'), `на этаже 4 рядом с A-0405 появилась копия «405»: ${fl4.join(', ')}`)
  assert.ok(fl4.every((n) => /^A-04\d\d$/.test(n)), `номера копии не в формате корпуса: ${fl4.join(', ')}`)
  assert.deepEqual(fl4, ['A-0401', 'A-0405'], 'копия A-0301 → A-0401, A-0405 пропущена')
})
