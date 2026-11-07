// QA 2.2 · 07 Согласия и удаление (§15, решение 250)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, q, one, close, act, client, page, tick, freeUnit, lastBooking } from './h.mjs'

after(close)
let S, P, OF, OW
test('setup', async () => {
  // QA-база: лимит одновременных броней не должен мешать сценариям денег и KYC (лимит проверяет 04_bookings)
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
  S = await user('seller'); P = await user('agent'); OF = await user('office'); OW = await user('owner', { market: null }) })
test('клиент даёт согласие по ссылке: данные + реклама → журнал, статус given', async () => {
  const cl = (await register(P)).result.id
  const tok = (await client(cl)).consent_token
  assert.equal((await page(null, `/c/${tok}`)).status, 200)
  const r = await act(null, 'answerConsent', { token: tok, act: 'give', data: 'on', marketing: 'on', lang: 'de' })
  assert.equal(r.result?.ok, 'saved', JSON.stringify(r))
  const c = await client(cl)
  assert.equal(c.consent_status, 'given'); assert.ok(c.consent_at); assert.ok(c.marketing_consent_at)
  const log = await q(`select kind, granted, source from portal.consents where client_id = $1 and source = 'consent_link'`, [cl])
  assert.equal(log.length, 2)
})
test('без обязательной галочки — ошибка; отзыв рекламы — пишется в журнал', async () => {
  const cl = (await register(P)).result.id
  const tok = (await client(cl)).consent_token
  const r = await act(null, 'answerConsent', { token: tok, act: 'give', marketing: 'on' })
  assert.ok(r.result?.error)
  await act(null, 'answerConsent', { token: tok, act: 'give', data: 'on', marketing: 'on' })
  await act(null, 'answerConsent', { token: tok, act: 'marketing_off' })
  assert.equal((await client(cl)).marketing_consent_at, null)
  assert.ok(await one(`select 1 from portal.consents where client_id = $1 and kind = 'marketing' and not granted and source = 'withdraw'`, [cl]))
})
test('отказ: Do not contact и задача бэк-офису', async () => {
  const cl = (await register(P)).result.id
  const tok = (await client(cl)).consent_token
  await act(null, 'answerConsent', { token: tok, act: 'decline' })
  const c = await client(cl)
  assert.equal(c.consent_status, 'declined'); assert.equal(c.do_not_contact, true)
})
const CE = `qa-consent-${Date.now()}@qa.test`
test('напоминания: 3 дня → письмо клиенту и уведомление; 14 дней → Do not contact (tick)', async () => {
  const cl = (await register(S, { email: CE })).result.id
  await q(`update portal.clients set consent_requested_at = now() - interval '4 days', consent_reminders = 0 where id = $1`, [cl])
  await tick()
  assert.equal((await client(cl)).consent_reminders, 1, 'напоминание на 3-й день не ушло')
  // первое письмо со ссылкой + напоминание на языке клиента (DE: «Erinnerung…»)
  assert.ok((await one(`select count(*)::int n from portal.outbox_messages where to_addr = $1 and kind = 'consent'`, [CE])).n >= 2, 'письмо-напоминание не в очереди')
  assert.ok(await one(`select 1 from portal.outbox_messages where to_addr = $1 and kind = 'consent' and subject like 'Erinnerung%'`, [CE]), 'напоминание не на языке клиента')
  await q(`update portal.clients set consent_requested_at = now() - interval '15 days' where id = $1`, [cl])
  await tick()
  assert.equal((await client(cl)).do_not_contact, true, 'через 14 дней не Do not contact')
})
test('форма сайта с галочками — согласие сразу given; ссылка партнёра — given', async () => {
  const L = await user('agent')
  const pr = await one(`select id from projects where slug = 'premium-residence'`)
  await act(L, 'saveLink', { project: [pr.id], lang: 'de', price_mode: 'from', title: 'QA' })
  const code = (await one('select code from portal.partner_links where user_id = $1', [L.id])).code
  const r = await act(null, 'linkLead', { code, name: 'QA Link Lead', phone: '+49 151 ' + Math.floor(Math.random() * 1e8), consent: 'on', lang: 'de' })
  assert.ok(r.result?.ok)
  const c = await one(`select * from portal.clients where owner_id = $1 order by created_at desc limit 1`, [L.id])
  assert.equal(c.consent_status, 'given'); assert.equal(c.attach_status, 'candidate'); assert.equal(c.marketing_consent_at, null, 'реклама без второй галочки')
})
test('удаление по запросу: без сделки — данные удалены, клиент обезличен; повтор того же человека снова регистрируется', async () => {
  const r = await register(S)
  const cl = r.result.id
  await act(OF, 'createPrivacyRequest', { client: (await client(cl)).reg_no, channel: 'email' })
  const req = await one(`select id from portal.privacy_requests where client_id = $1`, [cl])
  assert.ok(req, 'запрос не создан')
  assert.equal((await client(cl)).do_not_contact, true, 'до исполнения — Do not contact')
  await act(OF, 'executePrivacyRequest', { id: req.id })
  const c = await client(cl)
  assert.ok(c.anonymized_at); assert.equal(c.phone, null); assert.equal(c.email, null); assert.match(c.name, /^Deleted · R-/)
  assert.equal((await one(`select status from portal.privacy_requests where id = $1`, [req.id])).status, 'done')
  assert.equal((await page(null, `/c/${c.consent_token || 'x'}`)).status, 404, 'ссылка согласия жива после удаления')
})
test('удаление при сделке: договор и KYC сохраняются', async () => {
  const cl = (await register(S)).result.id
  await act(S, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA' })
  await q(`update portal.clients set kyc_status = 'passed', kyc_citizenship = 'DE' where id = $1`, [cl])
  await act(OF, 'bookingAction', { id: b.id, act: 'contract' })
  await act(OF, 'createPrivacyRequest', { client: (await client(cl)).reg_no })
  const req = await one(`select id from portal.privacy_requests where client_id = $1`, [cl])
  await act(OF, 'executePrivacyRequest', { id: req.id })
  const c = await client(cl)
  assert.equal(c.kyc_citizenship, 'DE', 'KYC стёрт при сделке'); assert.ok(await one('select 1 from portal.deals where client_id = $1', [cl]), 'сделка удалена')
})
test('сейлз не может выполнять удаление', async () => {
  const r = await act(S, 'createPrivacyRequest', { client: 'R-0' })
  assert.ok(r.thrown)
})
