// QA 2.2 · 09 Безопасность: внутренние адреса, публичные страницы, чужие токены, обход прав через прямые id
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, one, close, act, page } from './h.mjs'

after(close)
test('внутренние адреса: без подписи и через прокси — 403', async () => {
  for (const a of ['grant', 'clawback', 'shares']) {
    const r = await fetch('http://127.0.0.1:3043/api/internal/b24', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal': 'bad' }, body: JSON.stringify({ action: a }) })
    assert.equal(r.status, 403, a)
  }
  const r = await fetch('http://127.0.0.1:3043/api/internal/qa', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: '{"action":"login"}' })
  assert.equal(r.status, 403)
})
test('робот Bitrix24 без токена приложения — 403', async () => {
  const fd = new FormData(); fd.set('auth[domain]', 'getsestate.bitrix24.ae'); fd.set('auth[access_token]', 'fake'); fd.set('code', 'ge_check_unit')
  const r = await fetch('http://127.0.0.1:3043/api/b24/robot', { method: 'POST', body: fd })
  assert.equal(r.status, 403)
  const fd2 = new FormData(); fd2.set('auth[domain]', 'evil.bitrix24.com'); fd2.set('auth[access_token]', 'x')
  assert.equal((await fetch('http://127.0.0.1:3043/api/b24/robot', { method: 'POST', body: fd2 })).status, 403)
})
test('обработчик приложения Bitrix24: чужой домен и без AUTH_ID — отказ', async () => {
  const fd = new FormData(); fd.set('DOMAIN', 'evil.bitrix24.com'); fd.set('AUTH_ID', 'x')
  const r = await fetch('http://127.0.0.1:3043/b24', { method: 'POST', body: fd, redirect: 'manual' })
  assert.equal(r.status, 403)
})
test('публичные токены: неверные — 404', async () => {
  for (const p of ['/c/nope', '/k/nope', '/r/nope', '/s/nope']) assert.equal((await page(null, p)).status, 404, p)
  assert.equal((await fetch('http://127.0.0.1:3043/api/feed/nope')).status, 404)
})
test('вход по ссылке: неверный токен → «ссылка устарела»', async () => {
  const r = await fetch('http://127.0.0.1:3043/l/nope', { redirect: 'manual', headers: { host: 'portal.pdna.pro' } })
  assert.ok([303, 307].includes(r.status) && /expired/.test(r.headers.get('location') || ''))
})
test('акт чужого партнёра не открывается', async () => {
  const a = await user('agency_head'), b = await user('agency_head')
  const reg = await one(`insert into portal.payout_registers (month) values ('2032-01-01') on conflict (month) do update set month = excluded.month returning id`)
  const l = await one(`insert into portal.payout_lines (register_id, role, user_id, gross, net, act_no) values ($1,'partner',$2,100,100,'A-QA-'||floor(random()*1e6)) returning id`, [reg.id, a.id])
  assert.equal((await page(a, `/commission/act/${l.id}`)).status, 200)
  assert.notEqual((await page(b, `/commission/act/${l.id}`)).status, 200, 'чужой акт открылся')
})
test('партнёр не может изменить чужого клиента прямым id (квалификация, документы, KYC-ссылка)', async () => {
  const s = await user('seller'), p = await user('agent')
  const cl = (await register(s)).result.id
  const r1 = await act(p, 'saveQualification', { client: cl, goal: 'hack', budget: '1', timeline: '1', country: 'DE', language: 'de' })
  assert.ok(r1.thrown, 'партнёр изменил квалификацию чужого клиента')
  const r2 = await act(p, 'kycLink', { client: cl })
  assert.ok(r2.thrown, 'партнёр создал KYC-ссылку чужому клиенту')
  const r3 = await act(p, 'addBuyer', { client: cl, kind: 'person', name: 'x' })
  assert.ok(r3.thrown, 'партнёр добавил покупателя чужому клиенту')
})
test('выход из роли через подделку cookie: неподписанный токен не принимается', async () => {
  const r = await fetch('http://127.0.0.1:3043/', { headers: { cookie: 'ge_s=eyJhbGciOiJub25lIn0.eyJ1aWQiOiJ4In0.', host: 'portal.pdna.pro' }, redirect: 'manual' })
  assert.ok([302, 303, 307].includes(r.status))
})
test('QA-адрес выключен на основном стенде', async () => {
  const r = await fetch('http://127.0.0.1:3042/api/internal/qa', { method: 'POST', body: '{}' })
  assert.equal(r.status, 404)
})
