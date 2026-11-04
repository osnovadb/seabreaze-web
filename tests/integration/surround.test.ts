// Окружение на планах и обложка проекта (1b0e03f): метки плана этажа и генплана, стороны схемы этажа, обложка в «Проектах».
// Пишет только владелец; cleanMarks отбрасывает неизвестные виды и координаты вне 0..1. Тест возвращает метки, стороны и обложку как были.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, forms, submit, type Form } from './_portal'

const MARINA = 'c531e4dd-e500-47cf-b000-febd86a6fc7f', FP = '7915bdca-e644-4217-acaa-e014ad04009b'
const PR = '00000000-0000-0000-0000-0000000000a2', POSITANO = '00000000-0000-0000-0000-0000000002b1'
let db: pg.Client, marks0: unknown, gmarks0: unknown, sides0: unknown, cover0: string | null = null
const files: string[] = []

const marksForm = async (c: string, path: string) => forms((await page(c, path)).html).find((f) => f.fields.some(([k]) => k === 'marks'))
const sidesForm = async (c: string, bid: string) => forms((await page(c, `/admin/objects/${PR}?tab=markup`)).html).find((f) => f.fields.some(([k, v]) => k === 'building' && v === bid) && f.fields.some(([k]) => k === 'k_top'))
const fpMarks = async () => (await db.query('select marks from portal.floor_plans where id=$1', [FP])).rows[0].marks
const sides = async () => (await db.query('select sides from portal.building_sides where building_id=$1', [POSITANO])).rows[0]?.sides

before(async () => {
  if (SKIP) return
  db = await dbConnect()
  marks0 = await fpMarks()
  gmarks0 = (await db.query('select marks from portal.genplans where project_id=$1', [PR])).rows[0]?.marks
  sides0 = await sides()
  cover0 = (await db.query('select cover_file_id from portal.project_settings where project_id=$1', [PR])).rows[0]?.cover_file_id ?? null
})
after(async () => {
  if (SKIP) return
  await db.query('update portal.floor_plans set marks=$2 where id=$1', [FP, JSON.stringify(marks0)])
  if (gmarks0 !== undefined) await db.query('update portal.genplans set marks=$2 where project_id=$1', [PR, JSON.stringify(gmarks0)])
  if (sides0) await db.query('update portal.building_sides set sides=$2 where building_id=$1', [POSITANO, sides0])
  await db.query('update portal.project_settings set cover_file_id=$2 where project_id=$1', [PR, cover0])
  await db.query('delete from portal.files where id = any($1)', [files])
  await db.end()
})

test('метки и стороны пишет только владелец: продавец, руководитель рынка, офис, партнёр — нет', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const mf = await marksForm(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`); assert.ok(mf, 'форма меток плана этажа')
  const sf = await sidesForm(o, POSITANO); assert.ok(sf, 'форма сторон у Block A · Positano')
  const m0 = JSON.stringify(await fpMarks()), s0 = JSON.stringify(await sides())
  for (const who of [U.seller, U.head, U.office, U.agent]) {
    const c = await login(who)
    await submit(c, `/admin/objects/${MARINA}/floor/${FP}?m=marks`, mf!, { marks: JSON.stringify([{ kind: 'sea', x: 0.1, y: 0.1 }]) })
    await submit(c, `/admin/objects/${PR}?tab=markup`, sf!, { k_top: 'park', l_top: 'QA ' + who })
    assert.equal(JSON.stringify(await fpMarks()), m0, `${who} изменил метки`)
    assert.equal(JSON.stringify(await sides()), s0, `${who} изменил стороны`)
  }
})

test('cleanMarks: неизвестный вид, координаты вне 0..1, не числа — отбрасываются; подпись обрезается до 40', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const mf = (await marksForm(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`))!
  const long = 'Д'.repeat(60)
  await submit(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`, mf, { marks: JSON.stringify([
    { kind: 'sea', x: 0.25, y: 0.5, label: '  ' + long + '  ' }, { kind: 'pool', x: 0, y: 1 },
    { kind: 'volcano', x: 0.5, y: 0.5 }, { kind: 'sea', x: 1.5, y: 0.5 }, { kind: 'sea', x: -0.01, y: 0.5 }, { kind: 'sea', x: '0.5', y: 0.5 }, { kind: 'sea', x: null, y: 0.5 },
  ]) })
  const m = await fpMarks()
  assert.deepEqual(m.map((x: { kind: string }) => x.kind), ['sea', 'pool'])
  assert.equal(m[0].label, long.slice(0, 40))
})

test('cleanMarks и стороны не принимают имена из прототипа объекта (constructor, toString, __proto__)', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const mf = (await marksForm(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`))!
  await submit(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`, mf, { marks: JSON.stringify([{ kind: 'constructor', x: 0.5, y: 0.5 }, { kind: 'toString', x: 0.2, y: 0.2 }, { kind: 'hasOwnProperty', x: 0.3, y: 0.3 }]) })
  assert.deepEqual((await fpMarks()).map((x: { kind: string }) => x.kind), [], 'сохранены метки неизвестного вида')
  const sf = (await sidesForm(o, POSITANO))!
  await submit(o, `/admin/objects/${PR}?tab=markup`, sf, { k_top: 'constructor', k_left: 'toString' })
  const s = await sides()
  assert.ok(!s.top && !s.left, `стороны с неизвестным видом: ${JSON.stringify(s)}`)
  // экран «Этаж» с такими данными у партнёра всё равно открывается
  assert.equal((await page(await login(U.agent), `/projects/premium-residence/floor?b=${POSITANO}`)).status, 200)
})

test('стороны схемы видны партнёру на экране «Этаж»; метки плана — команде', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const sf = (await sidesForm(o, POSITANO))!
  await submit(o, `/admin/objects/${PR}?tab=markup`, sf, { k_top: 'sea', l_top: 'QA Каспий', k_right: '', k_bottom: 'road', l_bottom: '', k_left: '' })
  assert.deepEqual(await sides(), { top: { kind: 'sea', label: 'QA Каспий' }, bottom: { kind: 'road' } })
  const h = (await page(await login(U.agent), `/projects/premium-residence/floor?b=${POSITANO}`)).html
  assert.ok(h.includes('QA Каспий'), 'сторона «сверху» не видна партнёру')
  const mf = (await marksForm(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`))!
  await submit(o, `/admin/objects/${MARINA}/floor/${FP}?m=marks`, mf, { marks: JSON.stringify([{ kind: 'beach', x: 0.4, y: 0.4, label: 'QA пляж' }]) })
  for (const f of [1, 2, 3]) {
    const r = await page(o, `/projects/test-marina/floor?b=513a2883-8014-41e6-8eb3-312747a263c0&f=${f}`)
    assert.equal(r.status, 200); assert.ok(r.html.includes('QA пляж'), `этаж ${f}: метка плана не видна`)
  }
})

// Обложку загружают в Объекты → Основное; файл отдаётся через /files/<id>
async function saveProjectWith(c: string, f: Form, extra: [string, string | Blob, string?][]) {
  const p = (await db.query('select developer_id, status from projects where id=$1', [PR])).rows[0]
  const fd = new FormData(); const over = new Set(['developer', 'status', ...extra.map((x) => x[0])])
  for (const [k, v] of f.fields) if (!over.has(k)) fd.append(k, v)
  fd.append('developer', p.developer_id); fd.append('status', p.status)
  for (const [k, v, n] of extra) n ? fd.append(k, v as Blob, n) : fd.append(k, v as string)
  const r = await fetch(`${URL0}/admin/objects/${PR}`, { method: 'POST', body: fd, headers: { cookie: c }, redirect: 'manual' })
  return r.text()
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test('обложка проекта: загрузка владельцем, картинка открывается у владельца и партнёра, «убрать» сбрасывает', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const f = forms((await page(o, `/admin/objects/${PR}`)).html).find((x) => x.fields.some(([k]) => k === 'cover'))
  assert.ok(f, 'форма «Основное» с обложкой')
  const name = (await db.query('select name from projects where id=$1', [PR])).rows[0].name
  await saveProjectWith(o, f!, [['cover', new Blob([PNG], { type: 'image/png' }), 'qa-cover.png']])
  const fid = (await db.query('select cover_file_id from portal.project_settings where project_id=$1', [PR])).rows[0].cover_file_id
  assert.ok(fid, 'обложка не сохранилась'); files.push(fid)
  assert.equal((await db.query('select name from projects where id=$1', [PR])).rows[0].name, name)
  assert.ok((await page(o, '/projects')).html.includes(`/files/${fid}`), 'обложка не в списке проектов')
  for (const who of [U.owner, U.agent]) assert.equal((await fetch(`${URL0}/files/${fid}`, { headers: { cookie: await login(who) } })).status, 200, `${who}: /files/<обложка>`)
  // не картинка — понятная ошибка, обложка прежняя
  const txt = await saveProjectWith(o, f!, [['cover', new Blob(['x'], { type: 'text/plain' }), 'a.txt']])
  assert.match(txt, /картинка|image|Bild|תמונה/i)
  // картинка неподдерживаемого формата (gif) — не «Такой адрес проекта уже есть»
  const gif = await saveProjectWith(o, f!, [['cover', new Blob([Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')], { type: 'image/gif' }), 'a.gif']])
  assert.doesNotMatch(gif, /адрес проекта уже есть|address already exists|Adresse/i, 'gif: ошибка про адрес проекта вместо формата')
  assert.equal((await db.query('select cover_file_id from portal.project_settings where project_id=$1', [PR])).rows[0].cover_file_id, fid)
  await saveProjectWith(o, f!, [['cover_drop', '1']])
  assert.equal((await db.query('select cover_file_id from portal.project_settings where project_id=$1', [PR])).rows[0].cover_file_id, null)
})
