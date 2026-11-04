// Уведомления вне портала (4bdc4b7): tick шаг 9 (scripts/notify-out.mjs) с SMTP_URL=log, как на стенде.
// Срочное — сразу одним письмом, обычные — одной сводкой в день, повтор tick без дублей, выключенный e-mail, неактивный пользователь,
// язык письма; Telegram — с поддельным токеном (сообщение создаётся, отправка падает с ошибкой, без утечек).
// Пользователи «QA Notify …» создаются и удаляются тестом. Таймер стенда может отработать между шагами — проверки от этого не зависят.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import type pg from 'pg'
import { SKIP, dbConnect } from './_portal'

let db: pg.Client
const run = crypto.randomBytes(3).toString('hex')
const tick = (env: Record<string, string> = {}) => JSON.parse(execFileSync('node', ['scripts/tick.mjs'], { encoding: 'utf8', env: { ...process.env, SMTP_URL: 'log', PUBLIC_URL: 'https://ge-portal2.pdna.pro', ...env } }).trim().split(' ').slice(1).join(' '))
async function user(k: string, o: Record<string, unknown> = {}) {
  return (await db.query(`insert into portal.users (email, name, password_hash, password_set, role, market, locale, active, notify_email, notify_digest, telegram_chat_id)
    values ($1,$2,'x',false,'agent','DE',$3,$4,$5,$6,$7) returning id`, [`qa-notify-${run}-${k}@example.test`, `QA Notify ${k}`, o.locale ?? 'de', o.active ?? true, o.email ?? true, o.digest ?? true, o.chat ?? null])).rows[0].id as string
}
const note = (uid: string, kind: string, text: string) => db.query(`insert into portal.notifications (user_id, kind, text, link) values ($1,$2,$3,'/bookings') returning id`, [uid, kind, text]).then((r) => r.rows[0].id as string)
const mails = async (uid: string, ch = 'email') => (await db.query(`select subject, body, status, last_error from portal.outbox_messages where user_id=$1 and channel=$2 and kind='notify' order by created_at`, [uid, ch])).rows
const fwd = async (id: string) => (await db.query('select forwarded_at is not null f from portal.notifications where id=$1', [id])).rows[0].f as boolean

before(async () => { if (!SKIP) db = await dbConnect() })
after(async () => {
  if (SKIP) return
  const ids = (await db.query(`select id from portal.users where email like $1`, [`qa-notify-${run}-%`])).rows.map((r) => r.id)
  await db.query('delete from portal.outbox_messages where user_id = any($1)', [ids])
  await db.query('delete from portal.notifications where user_id = any($1)', [ids])
  await db.query('delete from portal.users where id = any($1)', [ids])
  await db.end()
})

test('срочное уведомление — одно письмо сразу, на языке пользователя, со ссылкой на стенд; повтор tick без дублей', { skip: SKIP }, async () => {
  const u = await user('urgent')
  const n = await note(u, 'booking', 'Бронь подтверждена у застройщика')
  tick()
  const m = await mails(u)
  assert.equal(m.length, 1, `писем: ${m.length}`)
  assert.equal(m[0].status, 'sent')
  assert.match(m[0].body, /https:\/\/ge-portal2\.pdna\.pro\/bookings/)
  assert.doesNotMatch(m[0].subject + m[0].body, /Бронь подтверждена/, 'немецкому пользователю — по-русски')
  assert.equal(await fwd(n), true)
  tick()
  assert.equal((await mails(u)).length, 1, 'повтор tick прислал ещё письмо')
})

test('обычные уведомления — одна сводка в день; следующее обычное в тот же день ждёт завтрашней сводки', { skip: SKIP }, async () => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baku', hour: '2-digit', hour12: false }).format(new Date()))
  if (hour < 9) return // до 9:00 по Баку сводка не уходит — проверка утром бессмысленна
  const u = await user('digest')
  const ns = [await note(u, 'search', 'Каталог обновлён'), await note(u, 'news', 'Новая новость'), await note(u, 'selection', 'Клиент открыл подборку')]
  tick()
  const m = await mails(u)
  assert.equal(m.length, 1, `писем: ${m.length}`)
  assert.equal((m[0].body.match(/^• /gm) || []).length, 3, 'в сводке не три пункта')
  for (const id of ns) assert.equal(await fwd(id), true)
  const later = await note(u, 'news', 'Ещё одна новость')
  tick()
  assert.equal((await mails(u)).length, 1, 'вторая сводка в тот же день')
  assert.equal(await fwd(later), false, 'уведомление после сводки помечено пересланным и потеряно')
})

test('выключенный e-mail: писем нет, уведомление остаётся в портале; неактивному пользователю ничего не пересылается', { skip: SKIP }, async () => {
  const off = await user('off', { email: false })
  const n1 = await note(off, 'payout', 'Комиссия выплачена')
  const gone = await user('gone', { active: false })
  const n2 = await note(gone, 'booking', 'Бронь подтверждена у застройщика')
  tick()
  assert.equal((await mails(off)).length, 0)
  assert.equal((await mails(gone)).length, 0)
  assert.equal(await fwd(n2), false, 'уведомление неактивного помечено пересланным')
  void n1
})

test('без сводки (notify_digest = false) обычные уведомления только в портале, срочные — письмом', { skip: SKIP }, async () => {
  const u = await user('nodig', { digest: false })
  const a = await note(u, 'news', 'Новая новость'), b = await note(u, 'kyc', 'KYC пройден')
  tick()
  const m = await mails(u)
  assert.equal(m.length, 1); assert.doesNotMatch(m[0].body, /новость|News/i)
  assert.equal(await fwd(a), true); assert.equal(await fwd(b), true)
})

test('Telegram с поддельным токеном: сообщение в очереди только у привязавших чат, отправка — ошибка без токена в тексте', { skip: SKIP }, async () => {
  const u = await user('tg', { chat: 111222333, email: false })
  const v = await user('notg', { email: false })
  await note(u, 'deal', 'Договор подписан — сделка в работе'); await note(v, 'deal', 'Договор подписан — сделка в работе')
  const out = tick({ TG_BOT_TOKEN: '000:qa-fake-token' })
  const t = await mails(u, 'telegram')
  assert.equal(t.length, 1, `сообщений: ${t.length}`)
  assert.equal(t[0].status, 'error')
  assert.ok(!String(t[0].last_error).includes('qa-fake-token'), 'токен в тексте ошибки')
  assert.ok(!JSON.stringify(out).includes('qa-fake-token'), 'токен в выводе tick')
  assert.equal((await mails(v, 'telegram')).length, 0)
})

test('профиль: галочки уведомлений сохраняются; «Почта и Telegram» в админке — только владельцу', { skip: SKIP }, async () => {
  const { U, login, page, forms, submit } = await import('./_portal')
  const sid = (await db.query('select id, notify_email, notify_telegram, notify_digest from portal.users where email=$1', [U.agent])).rows[0]
  try {
    const c = await login(U.agent)
    const f = forms((await page(c, '/profile')).html).find((x) => x.html.includes('name="digest"'))!
    assert.ok(f, 'форма уведомлений')
    // только «сводка»: e-mail и Telegram выключены
    await submit(c, '/profile', { ...f, fields: f.fields.filter(([k]) => !['email', 'telegram', 'digest'].includes(k)) }, { digest: '1' })
    const r = (await db.query('select notify_email, notify_telegram, notify_digest from portal.users where id=$1', [sid.id])).rows[0]
    assert.deepEqual(r, { notify_email: false, notify_telegram: false, notify_digest: true })
  } finally {
    await db.query('update portal.users set notify_email=$2, notify_telegram=$3, notify_digest=$4 where id=$1', [sid.id, sid.notify_email, sid.notify_telegram, sid.notify_digest])
  }
  assert.equal((await page(await login(U.owner), '/admin/outbox')).status, 200)
  for (const who of [U.head, U.office, U.finance, U.agent]) assert.notEqual((await page(await login(who), '/admin/outbox')).status, 200, who)
})
