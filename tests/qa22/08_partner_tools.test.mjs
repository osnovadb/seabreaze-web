// QA 2.2 · 08 Инструменты партнёра и заявки: личная ссылка и фид (П8), рекомендатель (П9), заявка агентства → кабинет, сотрудники агентства (248)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, q, one, close, act, page, phone, uniq, formTok } from './h.mjs'

after(close)
let P, OW, MH
test('setup', async () => { P = await user('agent'); OW = await user('owner', { market: null }); MH = await user('market_head', { market: 'DE' }) })
test('личная ссылка: страница, фид без точных цен, заявка → кандидат партнёра; повтор человека — без нового клиента', async () => {
  const pr = await one(`select id from projects where slug = 'premium-residence'`)
  await act(P, 'saveLink', { project: [pr.id], lang: 'de', price_mode: 'from' })
  const code = (await one('select code from portal.partner_links where user_id = $1', [P.id])).code
  const pg = await page(null, `/r/${code}`); assert.equal(pg.status, 200)
  const feed = await fetch(`http://127.0.0.1:3043/api/feed/${code}`).then((r) => r.json())
  assert.ok(feed.projects?.length === 1)
  assert.ok(feed.projects.every((x) => x.price_from === null || x.price_from % 1000 === 0), 'в фиде точная цена')
  const ph = phone()
  await act(null, 'linkLead', { code, name: 'QA LL', phone: ph, consent: 'on' })
  await act(null, 'linkLead', { code, name: 'QA LL again', phone: ph, consent: 'on' })
  assert.equal((await one(`select count(*)::int n from portal.clients where right(phone_norm, 9) = right($1, 9)`, [ph.replace(/\D/g, '')])).n, 1, 'повтор создал второго клиента')
})
test('ловушка для ботов и выключенная ссылка', async () => {
  const code = (await one('select code, id from portal.partner_links where user_id = $1', [P.id]))
  const before = (await one('select count(*)::int n from portal.clients where owner_id = $1', [P.id])).n
  await act(null, 'linkLead', { code: code.code, name: 'bot', phone: phone(), consent: 'on', website: 'http://spam' })
  assert.equal((await one('select count(*)::int n from portal.clients where owner_id = $1', [P.id])).n, before, 'бот прошёл через ловушку')
  await act(P, 'toggleLink', { id: code.id })
  const r = await act(null, 'linkLead', { code: code.code, name: 'QA off', phone: phone(), consent: 'on' })
  assert.ok(r.result?.error, 'выключенная ссылка принимает заявки')
  assert.equal((await page(null, `/r/${code.code}`)).status, 404)
})
test('партнёр не может включить в ссылку проект, которого не видит', async () => {
  await act(P, 'saveLink', { project: ['00000000-0000-0000-0000-000000000000'], lang: 'de' })
  const l = await one('select project_ids from portal.partner_links where user_id = $1 order by created_at desc limit 1', [P.id])
  assert.equal(l.project_ids.length, 0)
})
test('рекомендатель: заявка → доступ сразу, ссылка входа; рекомендация → клиент команды с Referrer; повтор отклонён', async () => {
  const email = `${uniq('ref')}@qa.test`
  const r = await act(null, 'applyAgent', { ft: formTok(), kind: 'referrer', name: 'QA Referrer', email, phone: phone(), market: 'DE', consent: 'on' })
  assert.ok(r.result?.ok && r.result.referrer, JSON.stringify(r))
  const R = await one(`select * from portal.users where email = $1`, [email])
  assert.equal(R.role, 'referrer')
  assert.ok(await one(`select 1 from portal.auth_tokens where user_id = $1 and kind = 'login'`, [R.id]), 'нет ссылки входа')
  const ph = phone()
  const a = await act(R, 'referClient', { name: 'QA Referred', phone: ph, consent: 'on' })
  assert.ok(a.result?.ok, JSON.stringify(a))
  const c = await one(`select * from portal.clients where referrer_id = $1`, [R.id])
  assert.equal(c.owner_type, 'referrer'); assert.equal(c.attach_status, 'protected')
  const b = await act(R, 'referClient', { name: 'QA again', phone: ph, consent: 'on' })
  assert.ok(b.result?.error, 'повторная рекомендация засчитана')
  const noC = await act(R, 'referClient', { name: 'QA no consent', phone: phone() })
  assert.ok(noC.result?.error, 'рекомендация без согласия человека прошла')
})
test('заявка агентства → менеджер открывает доступ → агентство и руководитель; повторно нельзя', async () => {
  const email = `${uniq('ag')}@qa.test`
  await act(null, 'applyAgent', { ft: formTok(), kind: 'agency', name: 'QA Head', company: 'QA Immobilien', email, phone: phone(), market: 'DE', consent: 'on' })
  const app = await one(`select id from portal.agent_applications where email = $1`, [email])
  const g = await act(MH, 'createFromApplication', { id: app.id })
  assert.ok(g.result?.ok, JSON.stringify(g))
  const u = await one(`select role, agency_id from portal.users where email = $1`, [email])
  assert.equal(u.role, 'agency_head'); assert.ok(u.agency_id)
  const g2 = await act(MH, 'createFromApplication', { id: app.id })
  assert.ok(g2.result?.error, 'доступ создан дважды')
})
test('заявка без согласия и без e-mail — ошибка', async () => {
  const r = await act(null, 'applyAgent', { ft: formTok(), kind: 'agent', name: 'QA', email: `${uniq()}@qa.test`, market: 'DE' })
  assert.ok(r.result?.error)
  const r2 = await act(null, 'applyAgent', { ft: formTok(), kind: 'agent', name: 'QA', email: '', market: 'DE', consent: 'on' })
  assert.ok(r2.result?.error)
})
test('руководитель агентства приглашает сотрудника → доступ сразу, руководителю рынка уведомление (248)', async () => {
  const ag = await agency('DE'); const H = await user('agency_head', { agency_id: ag.id })
  const email = `${uniq('emp')}@qa.test`
  const r = await act(H, 'createAgencyAgent', { name: 'QA Employee', email, locale: 'de' })
  assert.ok(r.result?.ok, JSON.stringify(r))
  assert.equal((await one(`select agency_id from portal.users where email = $1`, [email])).agency_id, ag.id)
  assert.ok(await one(`select 1 from portal.notifications where user_id = $1 and text like 'Агентство {a} пригласило%'`, [MH.id]), 'нет уведомления руководителю рынка')
})
test('Inactive через 6 месяцев без квалифицированных клиентов (tick), доступ остаётся', async () => {
  const { tick } = await import('./h.mjs')
  const old = await user('agent', { created_at: new Date(Date.now() - 200 * 86400000).toISOString() })
  await tick()
  const u = await one('select partner_status, active from portal.users where id = $1', [old.id])
  assert.equal(u.partner_status, 'inactive'); assert.equal(u.active, true)
})
test('358: форма заявки — без метки времени, слишком быстро или с заполненной ловушкой не принимается', async () => {
  const base = { kind: 'agent', name: 'QA Bot', email: `${uniq()}@qa.test`, phone: phone(), market: 'DE', consent: 'on' }
  for (const extra of [{}, { ft: formTok(), website: 'http://spam' }, { ft: String(Date.now()) + '.000000000000000000000000' }]) {
    const r = await act(null, 'applyAgent', { ...base, ...extra })
    assert.match(JSON.stringify(r.result || r), /обновите страницу/, 'бот прошёл: ' + JSON.stringify(extra))
  }
  assert.equal((await one('select count(*)::int n from portal.agent_applications where email = $1', [base.email])).n, 0)
})
test('284: смена банковских реквизитов — письмо на адрес партнёра и уведомление финансам', async () => {
  const P = await user('agent'), FI = await user('finance')
  await act(P, 'savePayoutProfile', { partner_form: 'individual', bank_iban: 'QA00TEST0000000001', bank_holder: 'QA' })
  assert.equal((await one(`select count(*)::int n from portal.outbox_messages where user_id = $1 and kind = 'bank_change'`, [P.id])).n, 0, 'письмо при первом заполнении')
  await act(P, 'savePayoutProfile', { partner_form: 'individual', bank_iban: 'QA00TEST0000000002', bank_holder: 'QA' })
  const m = await one(`select to_addr, body from portal.outbox_messages where user_id = $1 and kind = 'bank_change'`, [P.id])
  assert.ok(m && m.to_addr === P.email && m.body.includes('0001') && m.body.includes('0002'), 'нет письма на прежний адрес со старым и новым IBAN')
  assert.ok(await one(`select 1 from portal.notifications where user_id = $1 and text like 'Партнёр % сменил банковские реквизиты%'`, [FI.id]), 'финансам не пришло уведомление')
  assert.ok((await one('select bank_changed_at from portal.users where id = $1', [P.id])).bank_changed_at, 'нет отметки смены — выплата не придержится на 3 дня')
})
