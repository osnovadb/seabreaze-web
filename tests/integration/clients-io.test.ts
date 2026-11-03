// М13 (хвосты): импорт клиентов из xlsx, выгрузка в xlsx, страница статуса заявки партнёра по токену.
// Файлы делаем openpyxl (как настоящий Excel), импорт шлём как браузер — multipart в серверное действие формы.
// Тест удаляет своих клиентов (по номеру прогона в имени и телефоне) и свою заявку партнёра.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, forms } from './_portal'

const run = String(Math.floor(Math.random() * 9e5) + 1e5)
const ph = (i: number) => `+49 152 ${run}${String(i).padStart(2, '0')}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-xlsx-'))
let db: pg.Client, appId = ''

function xlsx(name: string, rows: unknown[][], opts: Record<string, string> = {}) {
  const p = path.join(tmp, name)
  execFileSync('python3', [path.join(__dirname, 'json2xlsx.py'), p], { input: JSON.stringify({ rows, ...opts }) })
  return p
}
// импорт как из браузера: поля формы ImportExport + файл; ответ серверного действия — RSC-поток, результат смотрим в базе и в тексте
const unlimit = () => db.query(`delete from portal.audit where action='client.import' and created_at > now() - interval '15 minutes' and user_id = (select id from portal.users where email=$1)`, [U.agent])
async function upload(cookie: string, file: string, keepLimit = false) {
  if (!keepLimit) await unlimit()
  const html = (await page(cookie, '/clients')).html
  const f = forms(html).find((x) => x.html.includes('name="file"'))
  assert.ok(f, 'на /clients нет формы импорта')
  const fd = new FormData()
  for (const [k, v] of f!.fields) if (k !== 'file') fd.append(k, v)
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), path.basename(file))
  const r = await fetch(URL0 + '/clients', { method: 'POST', body: fd, headers: { cookie }, redirect: 'manual' })
  return await r.text()
}
const mine = async () => (await db.query(`select name, phone, owner_id, language from portal.clients where name like $1 order by name`, [`QA Импорт ${run}%`])).rows
const LIMIT = /Höchstens 500|Не больше 500|500 clients/
const H = ['Имя', 'Телефон', 'E-mail', 'Страна', 'Язык', 'Источник', 'Согласие']

before(async () => { if (!SKIP) db = await dbConnect() })
after(async () => {
  fs.rmSync(tmp, { recursive: true, force: true })
  if (SKIP) return
  await db.query(`delete from portal.notifications where text like 'Импорт клиентов у {u}%' and created_at > now() - interval '15 minutes'`)
  await db.query(`delete from portal.clients where name like $1 or phone_norm like $2`, [`QA Импорт ${run}%`, `%152${run}%`])
  await unlimit()
  if (appId) await db.query(`delete from portal.agent_applications where id=$1`, [appId])
  await db.end()
})

test('импорт: дубль внутри файла и чужой клиент → «уже есть», без согласия — пропуск, клиенты закреплены за загрузившим', { skip: SKIP }, async () => {
  const dirk = (await db.query(`select phone from portal.clients where id='1a047999-ee3f-4693-bb34-af813e95c076'`)).rows[0].phone
  const f = xlsx('dups.xlsx', [H,
    [`QA Импорт ${run} A`, ph(1), '', 'DE', 'de', 'expo', 'да'],
    [`QA Импорт ${run} B`, `0152 ${run}01`, '', 'DE', 'de', 'expo', 'Yes'],   // тот же телефон, другой формат
    [`QA Импорт ${run} C`, ph(3), '', 'DE', 'de', 'expo', ''],               // нет согласия
    [`QA Импорт ${run} D`, dirk, '', 'DE', 'de', 'expo', 'x'],                // клиент продавца Martin
    [`QA Импорт ${run} E`, ph(5), `qa${run}@import.example`, 'DE', 'de', 'expo', 'ja'],
  ])
  const sophie = (await db.query(`select id from portal.users where email=$1`, [U.agent])).rows[0].id
  const text = await upload(await login(U.agent), f)
  const got = await mine()
  assert.deepEqual(got.map((c) => c.name), [`QA Импорт ${run} A`, `QA Импорт ${run} E`], 'добавлены только A и E')
  assert.ok(got.every((c) => c.owner_id === sophie), 'закреплены за загрузившим')
  for (const n of [3, 4, 5]) assert.match(text, new RegExp(`(строка|Zeile|row|שורה) ${n}:`), `в ответе нет пропуска строки ${n}`)  // агент DE — по-немецки
})

test('импорт: 501 строка → ошибка; нет колонки «Имя» → ошибка; не .xlsx → ошибка; ничего не создано', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  const big = xlsx('big.xlsx', [H, ...Array.from({ length: 501 }, (_, i) => [`QA Импорт ${run} big${i}`, `+49 152 ${run}${String(i).padStart(3, '0')}`, '', '', '', '', 'да'])])
  assert.match(await upload(c, big), LIMIT, '501 строка — нет ошибки «не больше 500»')
  const noname = xlsx('noname.xlsx', [['Телефон', 'Согласие'], [ph(20), 'да']])
  assert.ok(/Имя|Name|Name»/.test(await upload(c, noname)), 'нет колонки «Имя» — нет ошибки')
  const csv = path.join(tmp, 'c.csv'); fs.writeFileSync(csv, 'Имя,Телефон\nx,1')
  assert.ok((await upload(c, csv)).includes('xlsx'), 'не xlsx — нет ошибки')
  assert.equal((await mine()).filter((x) => x.name.includes('big')).length, 0)
})

// Файл, где клиенты на втором листе, а первым стоит пустой/служебный: readXlsx берёт sheet1.xml по имени файла,
// а не первую вкладку по workbook.xml. Здесь вкладки в обычном порядке — проверяем базовое чтение и язык.
test('импорт: язык клиента — код из списка, а не «Deutsch»', { skip: SKIP }, async () => {
  const f = xlsx('lang.xlsx', [H, [`QA Импорт ${run} L`, ph(30), '', 'Germany', 'Deutsch', '', 'да']])
  await upload(await login(U.agent), f)
  const l = (await mine()).find((x) => x.name.endsWith(' L'))
  assert.ok(l, 'строка не импортирована')
  assert.equal(l!.language, 'de', `язык сохранён как «${l!.language}»`)
})

test('выгрузка: агент — только свои клиенты; office, finance, content — 403', { skip: SKIP }, async () => {
  const r = await fetch(URL0 + '/clients/export', { headers: { cookie: await login(U.agent) } })
  assert.equal(r.status, 200)
  const p = path.join(tmp, 'export.xlsx'); fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()))
  const rows: string[][] = Object.values(JSON.parse(execFileSync('python3', [path.join(__dirname, 'xlsx2json.py'), p]).toString()).sheets)[0] as any
  const regs = rows.slice(1).map((x) => x[0])
  const sophie = (await db.query(`select id, agency_id from portal.users where email=$1`, [U.agent])).rows[0]
  const allowed = (await db.query(`select reg_no from portal.clients where owner_id=$1`, [sophie.id])).rows.map((x) => x.reg_no)
  assert.ok(regs.length > 0)
  assert.deepEqual(regs.filter((x) => !allowed.includes(x)), [], 'в выгрузке агента чужие клиенты')
  assert.ok(!rows.some((x) => x.includes('Dirk Lange')))
  for (const who of [U.office, U.finance, 'olga.content@demo.getsestate']) {
    assert.equal((await fetch(URL0 + '/clients/export', { headers: { cookie: await login(who) }, redirect: 'manual' })).status, 403, who)
  }
})

test('статус заявки партнёра: без входа по токену, неверный токен 404, отказ — нейтрально, язык по Accept-Language', { skip: SKIP }, async () => {
  const token = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')
  appId = (await db.query(`insert into portal.agent_applications (kind, name, email, phone, market, status_token) values ('agent',$1,$2,$3,'IL',$4) returning id`,
    [`QA Заявка ${run}`, `qa${run}@apply.example`, ph(40), token])).rows[0].id
  const get = (t: string, h: Record<string, string> = {}) => fetch(`${URL0}/apply/status/${t}`, { headers: h, redirect: 'manual' })
  const r = await get(token, { 'accept-language': 'en-US,en;q=0.9' }); assert.equal(r.status, 200)
  const html = await r.text(); assert.ok(html.includes(`QA Заявка ${run}`)); assert.ok(!html.includes('dir="rtl"'))
  assert.ok((await (await get(token, { 'accept-language': 'he-IL' })).text()).includes('dir="rtl"'), 'he → rtl')
  assert.equal((await get('0'.repeat(24))).status, 404)
  assert.equal((await get('zz')).status, 404)
  await db.query(`update portal.agent_applications set status='rejected', note='внутренний комментарий QA' where id=$1`, [appId])
  const rej = await (await get(token)).text()
  assert.ok(!rej.includes('внутренний комментарий QA'), 'внутренний комментарий проверяющего виден заявителю')
  assert.ok(/noindex/.test(rej), 'страница статуса без noindex — ссылку с именем заявителя может проиндексировать поисковик')
})

// Блок импорта вложен в форму поиска (<form> в <form>): в браузере гидратация /clients падает, а кнопка «Загрузить клиентов»
// не отправляет запрос (проверено руками в браузере). Ловим вложенность по HTML сервера.
test('/clients: форма импорта не вложена в другую форму', { skip: SKIP }, async () => {
  const html = (await page(await login(U.agent), '/clients')).html
  let depth = 0, max = 0
  for (const m of html.matchAll(/<(\/?)form\b/g)) { depth += m[1] ? -1 : 1; max = Math.max(max, depth) }
  assert.equal(max, 1, 'на /clients <form> внутри <form>')
})

test('импорт: заголовки DE и HE, согласие «כן», пустые строки не считаются в лимит 500', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  await upload(c, xlsx('de.xlsx', [['Name', 'Telefon', 'Sprache', 'Einwilligung'], [`QA Импорт ${run} DE`, ph(50), 'Deutsch', 'ja']]))
  await upload(c, xlsx('he.xlsx', [['שם', 'טלפון', 'שפה', 'הסכמה'], [`QA Импорт ${run} HE`, ph(51), 'עברית', 'כן']]))
  const got = await mine()
  assert.equal(got.find((x) => x.name.endsWith(' DE'))?.language, 'de')
  assert.equal(got.find((x) => x.name.endsWith(' HE'))?.language, 'he')
  // 500 клиентов + пустые строки между ними — не «больше 500»
  const rows: unknown[][] = [H]
  for (let i = 0; i < 500; i++) { rows.push([`QA Импорт ${run} p${i}`, `+49 152 ${run}${String(i).padStart(3, '0')}9`, '', '', '', '', 'нет']); if (i % 100 === 0) rows.push(['', '', '', '', '', '', '']) }
  assert.doesNotMatch(await upload(c, xlsx('blank.xlsx', rows)), LIMIT, '500 строк с пустыми между ними — ошибка лимита')
})

test('импорт: номер строки в пропусках — как в Excel, даже если выше есть пустые строки', { skip: SKIP }, async () => {
  const t = await upload(await login(U.agent), xlsx('gap.xlsx', [H, ['', '', '', '', '', '', ''], [`QA Импорт ${run} G`, ph(60), '', '', '', '', '']]))
  const n = t.match(/(?:строка|Zeile|row|שורה) (\d+):/)?.[1]
  assert.equal(n, '3', `клиент без согласия в строке 3 Excel, а в ответе «строка ${n}» (readXlsx не учитывает r="3" у <row>, пустые строки сдвигают нумерацию)`)
})

test('импорт: не чаще раза в 10 минут; при 20+ совпадениях — уведомление руководителю рынка', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  const dirk = (await db.query(`select phone from portal.clients where id='1a047999-ee3f-4693-bb34-af813e95c076'`)).rows[0].phone
  const head = (await db.query(`select id from portal.users where email=$1`, [U.head])).rows[0].id
  const n0 = (await db.query(`select count(*)::int n from portal.notifications where user_id=$1 and text like 'Импорт клиентов у {u}%'`, [head])).rows[0].n
  await upload(c, xlsx('many.xlsx', [H, ...Array.from({ length: 21 }, (_, i) => [`QA Импорт ${run} d${i}`, dirk, '', '', '', '', 'да'])]))
  const n1 = (await db.query(`select count(*)::int n from portal.notifications where user_id=$1 and text like 'Импорт клиентов у {u}%'`, [head])).rows[0].n
  assert.equal(n1, n0 + 1, 'руководитель рынка DE не уведомлён о 21 совпадении')
  const again = await upload(c, xlsx('again.xlsx', [H, [`QA Импорт ${run} R`, ph(70), '', '', '', '', 'да']]), true)
  assert.ok(/10 min|10 Min|10 минут|10 דקות/.test(again), 'второй импорт сразу — без ошибки лимита')
  assert.ok(!(await mine()).some((x) => x.name.endsWith(' R')))
})

test('импорт: две вкладки одновременно — второй получает лимит 10 минут', { skip: SKIP }, async () => {
  const c = await login(U.agent); await unlimit()
  const [a, b] = await Promise.all([1, 2].map((i) => upload(c, xlsx(`par${i}.xlsx`, [H, [`QA Импорт ${run} P${i}`, ph(80 + i), '', '', '', '', 'да']]), true)))
  const lim = /10 min|10 Min|10 минут|10 דקות/
  assert.equal([a, b].filter((t) => lim.test(t)).length, 1, 'обе параллельные загрузки прошли (или обе упали)')
  assert.equal((await mine()).filter((x) => / P\d$/.test(x.name)).length, 1)
})
