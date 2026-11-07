// QA 2.2 · 03 Регистрации у застройщиков (§7): пакет, ответ, отказ с причиной, продление, правило молчания, SLA
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, q, one, close, act, tick } from './h.mjs'

after(close)
let S, OF, cl
test('setup: клиент команды в очереди регистрации', async () => {
  S = await user('seller'); OF = await user('office')
  cl = (await register(S)).result.id
  const n = (await one(`select count(*)::int n from portal.registrations where client_id = $1 and status = 'to_send'`, [cl])).n
  assert.ok(n > 0, 'клиент команды не попал в очередь регистраций')
})
test('сейлз не может отправить регистрации', async () => {
  const ids = (await q(`select id from portal.registrations where client_id = $1`, [cl])).map((r) => r.id)
  const r = await act(S, 'sendRegistrations', { id: ids })
  assert.ok(r.thrown, 'сейлз отправил регистрации')
})
test('бэк-офис отправляет пакет → sent, срок ответа по условиям проекта', async () => {
  const ids = (await q(`select id from portal.registrations where client_id = $1`, [cl])).map((r) => r.id)
  await act(OF, 'sendRegistrations', { id: ids })
  const rows = await q(`select r.status, r.answer_due, k.reg_response_days, k.silence_extra_days from portal.registrations r cross join lateral (select * from portal.cur_conditions(r.project_id)) k where r.client_id = $1`, [cl])
  assert.ok(rows.every((r) => r.status === 'sent' && r.answer_due), JSON.stringify(rows))
})
test('подтверждение → защита на срок договора; отказ — с причиной', async () => {
  const [a, b] = await q(`select id from portal.registrations where client_id = $1 order by id`, [cl])
  await act(OF, 'decideRegistration', { id: a.id, verdict: 'confirmed' })
  const r = await one('select status, valid_until from portal.registrations where id = $1', [a.id])
  assert.equal(r.status, 'confirmed'); assert.ok(r.valid_until, 'нет срока защиты')
  if (b) {
    await act(OF, 'decideRegistration', { id: b.id, verdict: 'rejected', reason: 'other_agency' })
    const x = await one('select status, reject_reason from portal.registrations where id = $1', [b.id])
    assert.equal(x.status, 'rejected'); assert.equal(x.reject_reason, 'other_agency')
  }
})
test('продление → снова к отправке', async () => {
  const a = await one(`select id from portal.registrations where client_id = $1 and status = 'confirmed' limit 1`, [cl])
  await act(OF, 'renewRegistration', { id: a.id })
  assert.equal((await one('select status from portal.registrations where id = $1', [a.id])).status, 'to_send')
})
test('правило молчания: срок ответа вышел, по договору молчание = подтверждение → Confirmed by silence (tick)', async () => {
  const c2 = (await register(S)).result.id
  const r = await one(`select r.id, r.project_id from portal.registrations r where r.client_id = $1 limit 1`, [c2])
  await q(`update portal.conditions set silence_rule = 'confirm' where id = (portal.cur_conditions($1)).id`, [r.project_id])
  await q(`update portal.registrations set status = 'sent', sent_at = now() - interval '10 days', answer_due = current_date - 2 where id = $1`, [r.id])
  await tick()
  assert.equal((await one('select status from portal.registrations where id = $1', [r.id])).status, 'confirmed_silence')
})
test('молчание без правила в договоре — только напоминание бэк-офису', async () => {
  const c3 = (await register(S)).result.id
  const r = await one(`select r.id, r.project_id from portal.registrations r where r.client_id = $1 limit 1`, [c3])
  await q(`update portal.conditions set silence_rule = 'remind' where id = (portal.cur_conditions($1)).id`, [r.project_id])
  await q(`update portal.registrations set status = 'sent', sent_at = now() - interval '10 days', answer_due = current_date - 2 where id = $1`, [r.id])
  await tick()
  assert.equal((await one('select status from portal.registrations where id = $1', [r.id])).status, 'sent', 'молчание подтвердило без правила')
  assert.ok(await one(`select 1 from portal.notifications where kind = 'registration' and dedup like $1`, [`reg-quiet:${r.id}:%`]), 'напоминание бэк-офису не пришло')
})
test('регистрация истекла → expired (tick)', async () => {
  const r = await one(`select id from portal.registrations where client_id = $1 limit 1`, [cl])
  await q(`update portal.registrations set status = 'confirmed', valid_until = current_date - 1 where id = $1`, [r.id])
  await tick()
  assert.equal((await one('select status from portal.registrations where id = $1', [r.id])).status, 'expired')
})
