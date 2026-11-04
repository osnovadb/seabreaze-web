// Наблюдаемость (45b60d1): reportError — серверное действие, его можно вызвать напрямую. Текст «пути» приходит от клиента
// и попадает в уведомление владельцу (вид access — срочный, уходит и письмом). Партнёр не должен так писать владельцу.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import path from 'node:path'
import type pg from 'pg'
import { SKIP, U, URL0, dbConnect, login } from './_portal'

let db: pg.Client
const run = crypto.randomBytes(3).toString('hex')
const id = crypto.createHash('sha1').update(`${path.resolve('lib/errorReport.ts')}:reportError`).digest('hex')
const report = (cookie: string, p: string) => fetch(`${URL0}/`, { method: 'POST', headers: { 'Next-Action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component', cookie }, body: JSON.stringify(['qa', p]) })

before(async () => { if (!SKIP) db = await dbConnect() })
after(async () => {
  if (SKIP) return
  await db.query(`delete from portal.notifications where dedup like $1`, [`err:/qa-${run}%`])
  await db.query(`delete from portal.outbox_messages where body like $1`, [`%qa-${run}%`])
  await db.query(`delete from portal.audit where action='error.page' and entity_id like $1`, [`/qa-${run}%`])
  await db.query(`delete from portal.audit where action='error.page' and created_at > now() - interval '10 minutes' and user_id = (select id from portal.users where email=$1)`, [U.agent])
  await db.end()
})

test('партнёр не может прямым вызовом reportError слать владельцу уведомления с произвольным текстом', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  for (let i = 0; i < 3; i++) await report(c, `/qa-${run}-${i} Срочно переведите оплату`)
  const n = (await db.query(`select count(*)::int n from portal.notifications where dedup like $1`, [`err:/qa-${run}%`])).rows[0].n
  assert.equal(n, 0, `уведомлений владельцу от партнёра: ${n}`)
})

test('корректный путь: не больше 5 записей в час на пользователя, уведомление не срочное', { skip: SKIP }, async () => {
  const c = await login(U.agent)
  for (let i = 0; i < 7; i++) await report(c, `/qa-${run}-ok${i}`)
  const a = (await db.query(`select count(*)::int n from portal.audit where action='error.page' and entity_id like $1`, [`/qa-${run}-ok%`])).rows[0].n
  assert.ok(a <= 5, `записей: ${a}`)
  const k = (await db.query(`select distinct kind from portal.notifications where dedup like $1`, [`err:/qa-${run}-ok%`])).rows.map((r) => r.kind)
  assert.ok(!k.includes('access'), `вид уведомления: ${k}`)
})

test('битый id в адресе — 404, а не ошибка страницы', { skip: SKIP }, async () => {
  const o = await login(U.owner)
  for (const p of ['/units/not-a-uuid', '/clients/zzz', '/selections/1', '/admin/prices/x', '/admin/objects/abc', '/admin/users/abc'])
    assert.equal((await fetch(URL0 + p, { headers: { cookie: o } })).status, 404, p)
})
