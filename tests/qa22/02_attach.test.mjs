// QA 2.2 · 02 Закрепление и дубли (§10): кандидат 14 дней, квалификация (245), соперники, дубли по 9 цифрам и e-mail, клиент из АЗ
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, register, qualify, client, q, one, close, phone, uniq, act } from './h.mjs'

after(close)
let P1, P2, S, OF
test('setup', async () => { P1 = await user('agent'); P2 = await user('agent'); S = await user('seller'); OF = await user('office') })

test('партнёр заводит клиента → кандидат 14 дней без защиты, согласие — ждём клиента, регистраций нет', async () => {
  const r = await register(P1)
  assert.ok(r.result?.ok && r.result.candidate, JSON.stringify(r))
  const c = r.client
  assert.equal(c.attach_status, 'candidate'); assert.equal(c.owner_type, 'partner')
  const days = Math.round((new Date(c.candidate_until) - Date.now()) / 86400000)
  assert.ok(days >= 29 && days <= 30, '362: приоритет кандидата ≈ +30 дней: ' + c.candidate_until)
  assert.equal(c.consent_status, 'pending'); assert.equal(c.consent_at, null, 'партнёр не может дать согласие за клиента')
  assert.ok(c.consent_token, 'ссылка на согласие создана')
  assert.ok(await one(`select 1 from portal.consents where client_id = $1 and kind = 'partner_confirm'`, [c.id]), 'подтверждение партнёра в журнале')
  assert.equal((await one('select count(*)::int n from portal.registrations where client_id = $1', [c.id])).n, 0, 'кандидата не регистрируем у застройщиков')
})
test('без галочки «клиент согласен» регистрация не проходит', async () => {
  const r = await register(P1, { noConsent: true })
  assert.ok(r.result?.error, 'регистрация без подтверждения прошла')
})
test('без телефона и e-mail — ошибка', async () => {
  const r = await register(P1, { phone: '', email: '' })
  assert.ok(r.result?.error)
})
test('квалификация без языка — остаётся кандидатом; со всеми 5 полями — закреплён на 6 месяцев', async () => {
  const r = await register(P1, { language: '' })
  await qualify(P1, r.result.id, { language: '' })
  assert.equal((await client(r.result.id)).attach_status, 'candidate', 'закрепился без языка')
  await qualify(P1, r.result.id)
  const c = await client(r.result.id)
  assert.equal(c.attach_status, 'protected')
  const m = Math.round((new Date(c.protected_until) - Date.now()) / (30.4 * 86400000))
  assert.equal(m, 6, 'защита 6 месяцев: ' + c.protected_until)
  assert.ok((await one('select count(*)::int n from portal.registrations where client_id = $1', [c.id])).n > 0, 'после закрепления — в очереди регистраций')
})
test('два партнёра с одним человеком: оба кандидаты, побеждает первый квалифицировавший, второй — Duplicate', async () => {
  const ph = phone()
  const a = await register(P1, { phone: ph })
  const b = await register(P2, { phone: ph.replace(/\s/g, '') })
  assert.ok(b.result?.ok && b.result.candidate, 'второй партнёр должен получить кандидата: ' + JSON.stringify(b.result))
  assert.equal((await client(b.result.id)).other_claimant_of, a.result.id)
  await qualify(P2, b.result.id)
  assert.equal((await client(b.result.id)).attach_status, 'protected', 'квалифицировавший первым — закреплён')
  const lost = await client(a.result.id)
  assert.equal(lost.attach_status, 'junk'); assert.equal(lost.lost_reason, 'duplicate')
})
test('команда регистрирует уже закреплённого клиента → «дубль», владелец не раскрывается', async () => {
  const ph = phone()
  const a = await register(S, { phone: ph })
  assert.equal(a.client.attach_status, 'protected', 'клиент команды закрепляется сразу')
  const b = await register(P1, { phone: '00' + ph.replace(/\D/g, '') })
  assert.ok(b.result?.duplicate, 'дубль по 9 цифрам не пойман: ' + JSON.stringify(b.result))
  assert.ok(!JSON.stringify(b.result).includes(S.name), 'в ответе раскрыт владелец')
})
test('дубль по e-mail без учёта регистра', async () => {
  const em = `${uniq('dup')}@qa.test`
  await register(S, { email: em, phone: '' })
  const b = await register(P1, { email: em.toUpperCase(), phone: '' })
  assert.ok(b.result?.duplicate, 'дубль по e-mail не пойман')
})
test('клиент из АЗ: регистрации только у проектов с галочкой «можно продавать в АЗ»', async () => {
  const r = await register(S, { country: 'Azerbaijan' })
  const regs = await q(`select k.sells_to_az from portal.registrations r cross join lateral (select * from portal.cur_conditions(r.project_id)) k where r.client_id = $1`, [r.result.id])
  assert.ok(regs.every((x) => x.sells_to_az), 'клиента из АЗ поставили в регистрацию проекту без галочки АЗ')
})
test('спор «чей клиент»: открыть и решить в пользу второго → клиент передан, флаг спора', async () => {
  const ph = phone()
  const a = await register(S, { phone: ph })
  const r = await act(P1, 'requestDispute', { name: 'QA dispute', phone: ph, email: '' })
  assert.ok(r.result?.ok, JSON.stringify(r))
  const d = await one(`select id from portal.disputes where client_id = $1 and status = 'open'`, [a.result.id])
  assert.ok(d, 'спор не открыт')
  const owner = await user('owner', { market: null })
  await act(owner, 'resolveDispute', { id: d.id, act: 'transfer', decision: 'QA' })
  assert.equal((await client(a.result.id)).owner_id, P1.id, 'клиент не передан')
})
test('пауза и отказ партнёром; партнёр не может двигать стадии офиса', async () => {
  const r = await register(P1); await qualify(P1, r.result.id)
  const until = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  const p = await act(P1, 'moveStage', {}, { args: [r.result.id, 'pause', { until }] })
  assert.ok(p.result?.ok, JSON.stringify(p))
  const bad = await act(P1, 'moveStage', {}, { args: [r.result.id, 'p:reserved'] })
  assert.ok(bad.result?.error, 'партнёр перевёл стадию офиса')
})
