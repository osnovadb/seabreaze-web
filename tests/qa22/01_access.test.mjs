// QA 2.2 · 01 Роли и доступы: кто что открывает (§14), изоляция клиентов, рекомендатель — только свой кабинет
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, page, ok200, denied, register, close, act } from './h.mjs'

after(close)
const ROLES = ['owner', 'market_head', 'seller', 'office', 'finance', 'content', 'agency_head', 'agent', 'referrer']
const U = {}
test('setup: пользователи всех ролей', async () => {
  const ag = await agency('DE')
  for (const r of ROLES) U[r] = await user(r, { market: r === 'owner' ? null : 'DE', agency_id: r === 'agency_head' ? ag.id : null })
  U.agent2 = await user('agent', { market: 'DE' })
  U.headIL = await user('market_head', { market: 'IL' })
})

// [путь, роли, которым можно]
const MATRIX = [
  ['/', ['owner', 'market_head', 'seller', 'office', 'finance', 'content', 'agency_head', 'agent']],
  ['/catalog', ['owner', 'market_head', 'seller', 'office', 'finance', 'content', 'agency_head', 'agent']],
  ['/clients', ['owner', 'market_head', 'seller', 'office', 'finance', 'agency_head', 'agent']], // 364: финансы — с правами бэк-офиса
  ['/registrations', ['owner', 'office', 'finance', 'market_head']],
  ['/finance', ['owner', 'market_head', 'finance']],
  ['/commission', ['agency_head', 'agent']],
  ['/links', ['agency_head', 'agent']],
  ['/refer', ['referrer']],
  ['/admin/markets', ['owner', 'market_head']],
  ['/admin/privacy', ['owner', 'office', 'finance']],
  ['/admin/b24', ['owner']],
  ['/admin/developers', ['owner', 'market_head', 'office', 'finance']],
]
for (const [path, allowed] of MATRIX) {
  test(`доступ ${path}`, async () => {
    for (const r of ROLES) {
      const p = await page(U[r], path)
      const open = p.status === 200 && !/Нет доступа|Kein Zugang|No access/.test(p.html.slice(0, 3000))
      if (allowed.includes(r)) assert.ok(open, `${r} должен открыть ${path}, получил ${p.status} ${p.location}`)
      else assert.ok(!open || (path === '/' && r === 'referrer'), `${r} не должен открыть ${path} (200)`)
    }
  })
}
test('без входа — на /login', async () => {
  for (const path of ['/', '/clients', '/finance', '/admin']) { const p = await page(null, path); assert.ok([302, 303, 307].includes(p.status) && /login/.test(p.location), path) }
})
test('рекомендатель: любая страница кроме кабинета → /refer', async () => {
  for (const path of ['/catalog', '/clients', '/projects', '/bookings']) {
    const p = await page(U.referrer, path)
    assert.ok([302, 303, 307].includes(p.status) && /\/refer/.test(p.location), `${path} → ${p.status} ${p.location}`)
  }
})
test('партнёр не видит чужого клиента (404), а свой — видит', async () => {
  const mine = await register(U.agent)
  assert.ok(mine.result?.ok, JSON.stringify(mine))
  await ok200(U.agent, `/clients/${mine.result.id}`)
  const other = await page(U.agent2, `/clients/${mine.result.id}`)
  assert.notEqual(other.status, 200, 'чужой партнёр открыл карточку клиента')
})
test('руководитель рынка IL не видит клиента рынка DE в списке', async () => {
  const c = await register(U.seller)
  assert.ok(c.result?.ok)
  const p = await page(U.headIL, '/clients?v=list')
  assert.ok(!p.html.includes(c.input.name), 'клиент DE виден руководителю IL')
})
test('карточка Units открывается команде, партнёру — нет', async () => {
  const c = await register(U.seller)
  await ok200(U.seller, `/b24/units/${c.result.id}`)
  const p = await page(U.agent, `/b24/units/${c.result.id}`)
  assert.ok(p.status !== 200 || !p.html.includes(c.input.name), 'партнёр открыл Units чужого клиента команды')
})
test('выключенный пользователь не входит', async () => {
  const u = await user('seller')
  const { q } = await import('./h.mjs')
  await q('update portal.users set active = false where id = $1', [u.id])
  const p = await page(u, '/')
  assert.ok(p.status !== 200, 'выключенный пользователь открыл портал')
})
test('серверное действие без прав: партнёр не может отправлять регистрации и собирать реестр', async () => {
  const r1 = await act(U.agent, 'sendRegistrations', { id: [] })
  assert.ok(r1.thrown || r1.redirect, 'sendRegistrations от партнёра прошёл без ошибки')
  const r2 = await act(U.agent, 'registerCollect', { month: '2026-12' })
  assert.ok(r2.thrown, 'registerCollect от партнёра прошёл')
  const r3 = await act(U.seller, 'saveMarket', { code: 'DE' })
  assert.ok(r3.thrown, 'saveMarket от сейлза прошёл')
})
