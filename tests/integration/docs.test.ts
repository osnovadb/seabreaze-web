// М8: документы из шаблонов на локальном портале (seabreeze_v2). Локально нет LibreOffice — PDF не собирается, проверяем docx и права.
// Тест удаляет свои документы (и их файлы в базе); номера по счётчику при этом расходуются.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import PizZip from 'pizzip'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, formWith, forms, submit } from './_portal'

const MICHAEL = '62ccf16d-10ce-4b6a-b07a-e85f618a7309' // клиент sophie (agent DE), есть бронь
const YOSSI = 'fe8cbb0e-e66c-4a18-aa40-ef7d5d602480'   // клиент david (agent IL), документ OF-2026-0001 с PDF
let db: pg.Client, t0: Date
const docx = (file: string, from: string, to: string) => { const z = new PizZip(fs.readFileSync(file)); z.file('word/document.xml', z.file('word/document.xml')!.asText().split(from).join(to)); return z.generate({ type: 'nodebuffer' }) as Buffer }
const blob = (b: Buffer) => new File([b], 'qa.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
const tplCount = async () => (await db.query('select count(*)::int n from portal.doc_templates')).rows[0].n
const myDocs = async () => (await db.query('select id, number, status, docx_file_id, pdf_file_id, client_id from portal.documents where created_at >= $1 order by number', [t0])).rows

before(async () => { if (SKIP) return; db = await dbConnect(); t0 = new Date((await db.query('select now() n')).rows[0].n) })
after(async () => {
  if (SKIP) return
  const ds = await myDocs()
  const files = ds.flatMap((d) => [d.docx_file_id, d.pdf_file_id]).filter(Boolean)
  await db.query('delete from portal.documents where created_at >= $1', [t0])
  await db.query('delete from portal.client_documents where file_id = any($1)', [files])
  await db.query('delete from portal.files where id = any($1)', [files])
  await db.end()
})

async function uploadForm(cookie: string) { const p = await page(cookie, '/admin/templates'); return { p, f: formWith(p.html, 'file', 'kind', 'lang') } }
async function upload(cookie: string, f: any, kind: string, buf: Buffer) {
  const fd = new FormData(); for (const [k, v] of f.fields) if (!['file', 'kind', 'lang', 'name'].includes(k)) fd.append(k, v)
  fd.append('kind', kind); fd.append('lang', 'en'); fd.append('name', 'QA'); fd.append('file', blob(buf))
  const r = await fetch(process.env.PORTAL_URL + '/admin/templates', { method: 'POST', body: fd, headers: { cookie }, redirect: 'manual' })
  return r.text()
}

test('шаблоны: партнёр и продавец не видят /admin/templates и не загружают прямым POST', { skip: SKIP }, async () => {
  const { f } = await uploadForm(await login(U.owner)); assert.ok(f, 'форма загрузки у владельца')
  for (const who of [U.agent, U.seller]) {
    const c = await login(who)
    assert.notEqual((await page(c, '/admin/templates')).status, 200, who)
    const n0 = await tplCount()
    await upload(c, f, 'booking_offer', fs.readFileSync('db/templates/booking_offer.en.docx'))
    assert.equal(await tplCount(), n0, who)
  }
})
test('шаблоны: опечатка {unit.nmber}, битая скобка, акт фиксации с {booking.final} — отклоняются, версия не создаётся', { skip: SKIP }, async () => {
  const own = await login(U.owner); const { f } = await uploadForm(own)
  const n0 = await tplCount()
  const bad1 = await upload(own, f!, 'booking_offer', docx('db/templates/booking_offer.en.docx', '{unit.number}', '{unit.nmber}'))
  const bad2 = await upload(own, f!, 'booking_offer', docx('db/templates/booking_offer.en.docx', '{unit.number}', '{unit.number'))
  const bad3 = await upload(own, f!, 'fixation_act', docx('db/templates/fixation_act.en.docx', '{client.name}', '{client.name} {booking.final}'))
  assert.equal(await tplCount(), n0, 'версии шаблонов не должны добавиться')
  assert.ok(bad1.includes('unit.nmber'), 'в ошибке должно быть имя переменной')
  assert.ok(bad3.includes('booking.final'), 'в ошибке — неподходящая переменная')
})
test('оферта: партнёр — по своему клиенту можно, по чужому — «Нет прав»', { skip: SKIP }, async () => {
  const ag = await login(U.agent)
  const p = await page(ag, `/clients/${MICHAEL}`)
  const f = formWith(p.html, 'kind', 'booking', 'lang'); assert.ok(f, 'форма документа')
  const booking = (await db.query(`select id from portal.bookings where client_id=$1 limit 1`, [MICHAEL])).rows[0].id
  const n0 = (await myDocs()).length
  const r1 = await submit(ag, `/clients/${MICHAEL}`, f!, { client: MICHAEL, kind: 'booking_offer', lang: 'de', booking })
  assert.equal((await myDocs()).length, n0 + 1, 'своя оферта создаётся: ' + r1.text.slice(0, 200))
  const yb = (await db.query(`select id from portal.bookings where client_id=$1 limit 1`, [YOSSI])).rows[0]?.id || ''
  await submit(ag, `/clients/${MICHAEL}`, f!, { client: YOSSI, kind: 'booking_offer', lang: 'he', booking: yb })
  assert.equal((await myDocs()).length, n0 + 1, 'по чужому клиенту — нет')
  await submit(ag, `/clients/${MICHAEL}`, f!, { client: MICHAEL, kind: 'booking_offer', lang: 'de', booking: yb })
  assert.equal((await myDocs()).length, n0 + 1, 'бронь чужого клиента к своему — нет')
  await submit(ag, `/clients/${MICHAEL}`, f!, { client: MICHAEL, kind: 'commission_act', lang: 'de', booking })
  assert.equal((await myDocs()).length, n0 + 1, 'акт вознаграждения партнёру нельзя')
})
test('номера уникальны при двух быстрых созданиях подряд', { skip: SKIP }, async () => {
  const ag = await login(U.agent)
  const f = formWith((await page(ag, `/clients/${MICHAEL}`)).html, 'kind', 'booking', 'lang')!
  const booking = (await db.query(`select id from portal.bookings where client_id=$1 limit 1`, [MICHAEL])).rows[0].id
  await Promise.all([1, 2, 3].map(() => submit(ag, `/clients/${MICHAEL}`, f, { client: MICHAEL, kind: 'booking_offer', lang: 'en', booking })))
  const nums = (await myDocs()).map((d) => d.number)
  assert.equal(new Set(nums).size, nums.length, nums.join(' '))
  assert.ok(nums.every((n: string) => /^OF-\d{4}-\d{4}$/.test(n)))
})
test('статусы: подписать без файла нельзя, из signed — не аннулировать, sent → только вперёд', { skip: SKIP }, async () => {
  const ag = await login(U.agent)
  const d = (await myDocs()).find((x) => x.client_id === MICHAEL)!; assert.ok(d)
  const p = await page(ag, `/clients/${MICHAEL}`)
  // статус — кнопками name="to" (их значения в поля формы не попадают), форму ищем по скрытому id документа
  const sf = forms(p.html).find((f) => f.fields.some(([k, v]) => k === 'id' && v === d.id))
  assert.ok(sf, 'форма статуса документа')
  const st = async () => (await db.query('select status from portal.documents where id=$1', [d.id])).rows[0].status
  await submit(ag, `/clients/${MICHAEL}`, sf!, { id: d.id, to: 'signed' }); assert.equal(await st(), 'draft', 'из draft сразу в signed нельзя')
  await submit(ag, `/clients/${MICHAEL}`, sf!, { id: d.id, to: 'sent' }); assert.equal(await st(), 'sent')
  await submit(ag, `/clients/${MICHAEL}`, sf!, { id: d.id, to: 'signed' }); assert.equal(await st(), 'sent', 'без подписанной копии не подписывается')
  await submit(ag, `/clients/${MICHAEL}`, sf!, { id: d.id, to: 'draft' }); assert.equal(await st(), 'sent', 'назад в черновик нельзя')
  await db.query(`update portal.documents set status='signed' where id=$1`, [d.id])
  await submit(ag, `/clients/${MICHAEL}`, sf!, { id: d.id, to: 'void' }); assert.equal(await st(), 'signed', 'подписанный не аннулируется')
})
test('PDF чужого клиента партнёр не скачает; свой — скачает', { skip: SKIP }, async () => {
  const of1 = (await db.query(`select pdf_file_id from portal.documents where client_id=$1 and pdf_file_id is not null limit 1`, [YOSSI])).rows[0]
  if (!of1) return
  const r = await fetch(process.env.PORTAL_URL + '/files/' + of1.pdf_file_id, { headers: { cookie: await login(U.agent) }, redirect: 'manual' })
  assert.ok([401, 403, 404].includes(r.status), String(r.status))
  const own = await fetch(process.env.PORTAL_URL + '/files/' + of1.pdf_file_id, { headers: { cookie: await login(U.agentIl) }, redirect: 'manual' })
  assert.notEqual(own.status, 403, 'свой документ david должен видеть (локально файла может не быть — 404 «missing»)')
})
