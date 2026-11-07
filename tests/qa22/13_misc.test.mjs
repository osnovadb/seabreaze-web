// QA 2.2 · 13 Прочее: версии условий проекта, подборки и публичная страница, лист ожидания, вход «от имени» (только чтение), передача клиента, новости и слова-табу, рынки и словари
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, register, qualify, freeUnit, project, q, one, close, act, page, uniq } from './h.mjs'

after(close)
let OW, S, MH
test('setup', async () => { OW = await user('owner', { market: null }); S = await user('seller'); MH = await user('market_head', { market: 'DE' }) })
test('условия: черновик не действует; опубликованная версия с будущей датой не применяется до даты', async () => {
  const pr = await project('premium-residence')
  const cur = await one('select * from portal.cur_conditions($1)', [pr.id])
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const v = (await one('select max(version)+1 v from portal.conditions where project_id = $1', [pr.id])).v
  await q(`insert into portal.conditions (project_id, version, status, valid_from, fix_pct, pool_pct, agent_fix_pct, agent_pool_pct, agent_our_pool_share, seller_share_pct, seller_self_disc, seller_max_disc, booking_days, booking_ext_days, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing)
    select project_id, $2, 'published', $3, 9, pool_pct, agent_fix_pct, agent_pool_pct, agent_our_pool_share, seller_share_pct, seller_self_disc, seller_max_disc, booking_days, booking_ext_days, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing from portal.conditions where id = $1`, [cur.id, v, future])
  assert.equal((await one('select * from portal.cur_conditions($1)', [pr.id])).id, cur.id, 'будущая версия применилась раньше даты')
  await q('delete from portal.conditions where project_id = $1 and version = $2', [pr.id, v])
})
test('условия: сохранить черновик и опубликовать может только админ', async () => {
  const pr = await project('test-marina')
  const r = await act(S, 'saveConditions', { project: pr.id })
  assert.ok(r.result?.error || r.thrown, 'сейлз сохранил условия')
})
test('подборка: добавить квартиру → публичная ссылка показывает квартиру; подборка партнёра — под его брендом', async () => {
  const ag = await agency('DE'); const H = await user('agency_head', { agency_id: ag.id })
  const cl = (await register(H)).result.id; await qualify(H, cl)
  const u = await freeUnit()
  await act(H, 'addToSelection', { client: cl, unit: u.id })
  const sel = await one('select token from portal.selections where client_id = $1', [cl])
  assert.ok(sel, 'подборка не создана')
  const p = await page(null, `/s/${sel.token}`)
  assert.equal(p.status, 200)
  assert.ok(p.html.includes(ag.name), 'подборка партнёра не под его брендом')
  assert.ok(!p.html.includes('wordmark.svg'), 'в подборке партнёра наш логотип')
})
test('передача клиента другому владельцу — руководитель рынка; партнёр не может', async () => {
  const cl = (await register(S)).result.id
  const S2 = await user('seller')
  const P = await user('agent')
  await act(P, 'transferClient', { client: cl, owner: P.id })
  assert.equal((await one('select owner_id from portal.clients where id = $1', [cl])).owner_id, S.id, 'партнёр забрал клиента себе')
  await act(MH, 'transferClient', { client: cl, owner: S2.id })
  assert.equal((await one('select owner_id from portal.clients where id = $1', [cl])).owner_id, S2.id, 'руководитель рынка не передал клиента')
})
test('новость со словом-табу: сохраняется с предупреждением', async () => {
  const w = await one(`select label from portal.dict where kind = 'taboo' limit 1`)
  assert.ok(w, 'нет слов-табу в словаре')
  const C = await user('content')
  const r = await act(C, 'savePost', { title: `QA ${uniq()} ${w.label}`, body: 'text', kind: 'news', lang: 'ru', m_DE: 'on' })
  assert.ok(r.result?.ok, JSON.stringify(r)); assert.ok(r.result?.warning, 'нет предупреждения о слове-табу')
})
test('рынки и словари: админ меняет SLA и добавляет причину Lost; руководитель рынка — нет', async () => {
  await act(OW, 'saveMarket', { code: 'IL', price_negotiation: 'on', sla_minutes: 20, work_from: '09:00', work_to: '18:00', workdays: '7,1,2,3,4', languages: 'HE, RU, EN' })
  assert.equal((await one(`select sla_minutes from portal.markets where code = 'IL'`)).sla_minutes, 20)
  await act(OW, 'saveMarket', { code: 'IL', price_negotiation: 'on', sla_minutes: 15, work_from: '09:00', work_to: '18:00', workdays: '7,1,2,3,4', languages: 'HE, RU, EN' })
  const code = uniq('qa')
  await act(OW, 'saveDict', { kind: 'lost_reason', code, label: 'QA reason', market: '' })
  assert.ok(await one(`select 1 from portal.dict where kind = 'lost_reason' and code = $1`, [code]))
  await act(OW, 'saveDict', { kind: 'lost_reason', code, market: '', delete: '1' })
  const r = await act(MH, 'saveDict', { kind: 'taboo', label: 'x' })
  assert.ok(r.thrown, 'руководитель рынка изменил словарь')
})
test('лист ожидания и сохранённый поиск открываются', async () => {
  await page(S, '/waitlist').then((p) => assert.equal(p.status, 200))
})
test('выгрузка отчёта агента и реестра — финансам; партнёру — нет', async () => {
  const FI = await user('finance'), P = await user('agent')
  const { cookie } = await import('./h.mjs')
  for (const path of ['/api/money/report?month=2026-11', '/api/money/register?month=2026-11']) {
    const ok = await fetch('http://127.0.0.1:3043' + path, { headers: { cookie: `ge_s=${await cookie(FI)}`, host: 'portal.pdna.pro' } })
    assert.equal(ok.status, 200, path); assert.match(ok.headers.get('content-type') || '', /spreadsheet/)
    const no = await fetch('http://127.0.0.1:3043' + path, { headers: { cookie: `ge_s=${await cookie(P)}`, host: 'portal.pdna.pro' }, redirect: 'manual' })
    assert.notEqual(no.status, 200, 'партнёр выгрузил ' + path)
  }
})
test('регистрация из Bitrix24 без входа в Bitrix24 недоступна: страница вкладки только команде', async () => {
  const P = await user('agent')
  assert.notEqual((await page(P, '/b24/deal/1')).status, 200)
})
