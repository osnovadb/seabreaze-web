// Доступы (50a4e22): приглашение и сброс по одноразовой ссылке, «Забыли пароль?», защита входа от подбора, права выдачи ссылок.
// Пароли и PIN — сгенерированные тестовые значения на локальном портале; в отчёты не попадают. Тестовых пользователей «QA Access …» удаляем.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login, page, forms, formWith, submit } from './_portal'

let db: pg.Client
const run = crypto.randomBytes(3).toString('hex')
const mail = (k: string) => `qa-access-${run}-${k}@example.test`
const PW = 'Qa-' + crypto.randomBytes(9).toString('base64url'), PW2 = 'Qa-' + crypto.randomBytes(9).toString('base64url')
const PIN = String(crypto.randomInt(1000, 10000))
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const tokenOf = (text: string) => text.match(/set-password\/([A-Za-z0-9_-]{20,})/)?.[1]

// Новый пользователь через /admin/users (владелец); вернуть id и сырой токен из ответа
async function createUser(cookie: string, k: string, role = 'agent', market = 'DE') {
  const f = formWith((await page(cookie, '/admin/users')).html, 'email', 'role', 'name')
  assert.ok(f, 'форма нового пользователя')
  const r = await submit(cookie, '/admin/users', { ...f!, fields: f!.fields.filter(([n]) => n !== 'agency') }, { name: `QA Access ${k}`, email: mail(k), role, market, locale: 'de' })
  const id = (await db.query('select id from portal.users where email=$1', [mail(k)])).rows[0]?.id
  return { id, raw: tokenOf(r.text), text: r.text }
}
async function setPw(raw: string, values: Record<string, string>) {
  const f = forms((await page('', `/set-password/${raw}`)).html).find((x) => x.fields.some(([k]) => k === 'password2'))
  if (!f) return { status: 0, text: '', cookie: '' }
  const fd = new FormData()
  for (const [k, v] of f.fields) if (!(k in values)) fd.append(k, v)
  for (const [k, v] of Object.entries(values)) fd.append(k, v)
  const r = await fetch(`${URL0}/set-password/${raw}`, { method: 'POST', body: fd, redirect: 'manual' })
  return { status: r.status, text: await r.text(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
}
async function doLogin(email: string, password: string, ip = '203.0.113.7') {
  const f = forms((await page('', '/login')).html).find((x) => x.fields.some(([k]) => k === 'password'))!
  const fd = new FormData()
  for (const [k, v] of f.fields) if (!['email', 'password'].includes(k)) fd.append(k, v)
  fd.append('email', email); fd.append('password', password)
  const r = await fetch(`${URL0}/login`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  return { ok: (r.headers.get('set-cookie') || '').startsWith('ge_s='), text: await r.text() }
}
async function forgot(email: string) {
  const f = forms((await page('', '/forgot')).html).find((x) => x.fields.some(([k]) => k === 'email'))!
  const fd = new FormData()
  for (const [k, v] of f.fields) if (k !== 'email') fd.append(k, v)
  fd.append('email', email)
  const r = await fetch(`${URL0}/forgot`, { method: 'POST', body: fd, redirect: 'manual' })
  return { status: r.status, text: await r.text() }
}
const tokens = async (uid: string) => (await db.query(`select kind, used_at is not null used, extract(epoch from expires_at - created_at)/3600 hours from portal.auth_tokens where user_id=$1 order by created_at`, [uid])).rows

before(async () => { if (!SKIP) db = await dbConnect() })
after(async () => {
  if (SKIP) return
  const ids = (await db.query(`select id from portal.users where email like $1`, [`qa-access-${run}-%`])).rows.map((r) => r.id)
  await db.query('delete from portal.auth_tokens where user_id = any($1)', [ids])
  await db.query('delete from portal.outbox_messages where user_id = any($1)', [ids])
  await db.query(`delete from portal.notifications where kind='access' and link = any($1)`, [ids.map((i) => `/admin/users/${i}`)])
  await db.query(`delete from portal.login_attempts where email like $1 or ip like '203.0.113.%'`, [`qa-access-${run}-%`])
  await db.query('delete from portal.users where id = any($1)', [ids]).catch(() => db.query('update portal.users set active=false where id = any($1)', [ids]))
  await db.end()
})

test('приглашение: пароль не создаётся, ссылка на 7 дней, без входа открывается; письмо в очереди на языке пользователя', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const u = await createUser(o, 'inv')
  assert.ok(u.id && u.raw, 'ссылка в ответе')
  assert.equal((await db.query('select password_set from portal.users where id=$1', [u.id])).rows[0].password_set, false)
  assert.ok(!/"password":"/.test(u.text), 'в ответе есть пароль')
  const tk = await tokens(u.id)
  assert.deepEqual(tk.map((x) => [x.kind, x.used, Math.round(x.hours)]), [['invite', false, 168]])
  assert.equal((await page('', `/set-password/${u.raw}`)).status, 200)
  const m = (await db.query(`select subject, body from portal.outbox_messages where user_id=$1 and kind='invite'`, [u.id])).rows
  assert.equal(m.length, 1); assert.ok(m[0].body.includes(u.raw!), 'ссылка в письме')
  assert.doesNotMatch(m[0].subject, /[А-Яа-я]/, 'письмо немецкому пользователю на русском')
  // до установки пароля войти нельзя
  assert.equal((await doLogin(mail('inv'), PW)).ok, false)
})

test('задать пароль: короткий, разные, без PIN — ошибки; потом вход; ссылка одноразовая', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const u = await createUser(o, 'set')
  for (const v of [{ password: 'short', password2: 'short', pin: PIN }, { password: PW, password2: PW + 'x', pin: PIN }, { password: PW, password2: PW, pin: '' }, { password: PW, password2: PW, pin: '12a4' }]) {
    const r = await setPw(u.raw!, v)
    assert.equal(r.cookie, '', 'принят неверный ввод')
  }
  assert.equal((await db.query('select password_set from portal.users where id=$1', [u.id])).rows[0].password_set, false)
  const ok = await setPw(u.raw!, { password: PW, password2: PW, pin: PIN })
  assert.ok(ok.cookie.startsWith('ge_s='), 'пароль не задан')
  assert.equal((await doLogin(mail('set'), PW)).ok, true, 'вход с новым паролем')
  const again = await setPw(u.raw!, { password: PW2, password2: PW2, pin: PIN })
  assert.equal(again.cookie, '', 'ссылка сработала второй раз')
  assert.equal((await page('', `/set-password/${u.raw}`)).html.includes('password2'), false, 'форма показана по использованной ссылке')
})

test('две вкладки: одновременная установка пароля по одной ссылке — срабатывает одна', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const u = await createUser(o, 'race')
  const rs = await Promise.all([setPw(u.raw!, { password: PW, password2: PW, pin: PIN }), setPw(u.raw!, { password: PW2, password2: PW2, pin: PIN })])
  assert.equal(rs.filter((r) => r.cookie.startsWith('ge_s=')).length, 1)
  const okPw = rs[0].cookie ? PW : PW2, badPw = rs[0].cookie ? PW2 : PW
  assert.equal((await doLogin(mail('race'), okPw)).ok, true)
  assert.equal((await doLogin(mail('race'), badPw)).ok, false)
})

test('сроки ссылок: приглашение 7 дней, сброс из админки 48 ч, самостоятельный 2 ч; просроченная не работает; новая гасит прежнюю', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const u = await createUser(o, 'exp')
  await setPw(u.raw!, { password: PW, password2: PW, pin: PIN })
  // сброс из админки
  const f = forms((await page(o, `/admin/users/${u.id}`)).html).find((x) => x.html.includes('$ACTION') && /Ссылка|link|Link/i.test(x.html) && x.fields.some(([k, v]) => k === 'id' && v === u.id))
  assert.ok(f, 'форма «Ссылка на новый пароль»')
  const r1 = await submit(o, `/admin/users/${u.id}`, f!, {})
  const raw1 = tokenOf(r1.text); assert.ok(raw1)
  await forgot(mail('exp'))
  const tk = await tokens(u.id)
  assert.deepEqual(tk.map((x) => [x.kind, Math.round(x.hours)]), [['invite', 168], ['reset', 48], ['reset', 2]])
  assert.equal(tk[1].used, true, 'самостоятельный сброс не погасил ссылку из админки')
  // погашенная (самостоятельным сбросом) ссылка из админки не работает
  assert.equal((await setPw(raw1!, { password: PW2, password2: PW2, pin: '' })).cookie, '', 'погашенная ссылка из админки сработала')
  // просроченная: новая ссылка из админки, срок сдвинут в прошлое
  const raw2 = tokenOf((await submit(o, `/admin/users/${u.id}`, f!, {})).text)!
  await db.query(`update portal.auth_tokens set expires_at = now() - interval '1 minute' where token_hash=$1`, [sha(raw2)])
  assert.equal((await setPw(raw2, { password: PW2, password2: PW2, pin: '' })).cookie, '', 'просроченная ссылка сработала')
})

test('«Забыли пароль?»: ответ одинаковый для известного и неизвестного e-mail; не больше 3 ссылок в час', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const u = await createUser(o, 'fg')
  await setPw(u.raw!, { password: PW, password2: PW, pin: PIN })
  const norm = (s: string) => s.replace(/[0-9a-f]{40}/g, '').replace(/"[a-zA-Z0-9_-]{20,}"/g, '').length
  const a = await forgot(mail('fg')), b = await forgot(`nobody-${run}@example.test`)
  assert.equal(a.status, b.status)
  assert.ok(Math.abs(norm(a.text) - norm(b.text)) < 40, `ответы различаются: ${norm(a.text)} vs ${norm(b.text)}`)
  for (let i = 0; i < 4; i++) await forgot(mail('fg'))
  const n = (await db.query(`select count(*)::int n from portal.auth_tokens where user_id=$1 and created_at > now() - interval '1 hour'`, [u.id])).rows[0].n
  assert.ok(n <= 3, `ссылок за час: ${n}`)
  // уведомление руководителям, пока почта не подключена
  const nn = (await db.query(`select count(*)::int n from portal.notifications where kind='access' and link=$1`, [`/admin/users/${u.id}`])).rows[0].n
  assert.ok(nn >= 1 && nn <= 6, `уведомлений о сбросе: ${nn}`)
})

test('подбор пароля: 5 неудач — отказ даже с верным паролем; через 15 минут — снова можно; новый пароль гасит старые сеансы', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  const u = await createUser(o, 'lock')
  const first = await setPw(u.raw!, { password: PW, password2: PW, pin: PIN })
  for (let i = 0; i < 5; i++) assert.equal((await doLogin(mail('lock'), 'wrong-' + i)).ok, false)
  assert.equal((await doLogin(mail('lock'), PW)).ok, false, 'вход после 5 неудач')
  assert.equal((await doLogin(mail('lock').toUpperCase(), PW)).ok, false, 'блокировку обходит e-mail в другом регистре')
  await db.query(`update portal.login_attempts set at = at - interval '16 minutes' where email=$1`, [mail('lock')])
  assert.equal((await doLogin(mail('lock'), PW)).ok, true, 'после 15 минут не пускает')
  // сброс из админки и новый пароль: прежний сеанс (cookie после установки) перестаёт работать
  const f = forms((await page(o, `/admin/users/${u.id}`)).html).find((x) => x.html.includes('$ACTION') && /Ссылка|link|Link/i.test(x.html) && x.fields.some(([k, v]) => k === 'id' && v === u.id))!
  const raw = tokenOf((await submit(o, `/admin/users/${u.id}`, f, {})).text)!
  await setPw(raw, { password: PW2, password2: PW2, pin: '' })
  assert.notEqual((await page(first.cookie, '/')).status, 200, 'старый сеанс жив после смены пароля')
})

test('права на ссылки: руководитель рынка — только агентам своего рынка; продавец и офис — никому', { skip: SKIP }, async () => {
  const head = await login(U.head)
  const ids = Object.fromEntries((await db.query(`select email, id from portal.users where email = any($1)`, [[U.agent, U.agentIl, U.seller]])).rows.map((r) => [r.email, r.id]))
  const formFor = async (c: string, id: string) => forms((await page(c, `/admin/users/${id}`)).html).find((x) => x.html.includes('$ACTION') && /Ссылка|link|Link/i.test(x.html) && x.fields.some(([k, v]) => k === 'id' && v === id))
  const ownerForm = (await formFor(await login(U.owner), ids[U.agentIl]))!
  const n0 = (await db.query('select count(*)::int n from portal.auth_tokens')).rows[0].n
  for (const [who, target] of [[U.head, U.agentIl], [U.head, U.seller], [U.seller, U.agent], [U.office, U.agent]] as const) {
    const c = await login(who)
    await submit(c, `/admin/users/${ids[target]}`, { ...ownerForm, fields: ownerForm.fields.map(([k, v]) => [k, k === 'id' ? ids[target] : v] as [string, string]) }, {})
  }
  assert.equal((await db.query('select count(*)::int n from portal.auth_tokens')).rows[0].n, n0, 'ссылка выдана без прав')
  // своему агенту (Sophie, DE) — можно; ссылку тут же гасим, пароль Sophie не меняется
  const r = await submit(head, `/admin/users/${ids[U.agent]}`, { ...ownerForm, fields: ownerForm.fields.map(([k, v]) => [k, k === 'id' ? ids[U.agent] : v] as [string, string]) }, {})
  const raw = tokenOf(r.text)
  assert.ok(raw, 'руководитель рынка не может выдать ссылку своему агенту')
  await db.query(`update portal.auth_tokens set used_at = now() where token_hash=$1`, [sha(raw!)])
  await db.query(`delete from portal.outbox_messages where body like $1`, [`%${raw}%`])
})

test('создать пользователя с несуществующей ролью нельзя', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  await createUser(o, 'role', 'superadmin')
  assert.equal((await db.query('select count(*)::int n from portal.users where email=$1', [mail('role')])).rows[0].n, 0)
})
