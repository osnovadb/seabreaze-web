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
test('выгрузка xlsx (09.11): файл застройщику без партнёров и внутренних сроков, полный список, права, журнал', async () => {
  const { agency, cookie, BASE } = await import('./h.mjs')
  const PizZip = (await import('pizzip')).default
  const ag = await agency('DE'); const secret = 'QA Partner Secret ' + Date.now().toString(36)
  const H = await user('agency_head', { agency_id: ag.id, name: secret })
  // полная квалификация прямо в форме — клиент закрепляется сразу и встаёт в очередь регистраций
  const pc = (await register(H, { fields: { goal: 'invest', budget: '200-300k', timeline: '3m' } })).result?.id
  assert.equal((await one('select attach_status from portal.clients where id = $1', [pc])).attach_status, 'protected', 'полная квалификация в форме не закрепила клиента')
  const ids = (await q(`select id from portal.registrations where client_id = any($1::uuid[])`, [[cl, pc]])).map((r) => r.id)
  assert.ok(ids.length >= 2, 'нет регистраций для выгрузки')
  const get = async (u, qs) => { const r = await fetch(`${BASE}/api/registrations/export?${qs}`, { headers: { host: 'portal.pdna.pro', cookie: `ge_s=${await cookie(u)}` } }); return { status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) } }
  const text = (buf) => { const z = new PizZip(buf); return Object.keys(z.files).filter((n) => n.startsWith('xl/worksheets/')).map((n) => z.file(n).asText()).join('\n') }
  const dev = await get(OF, `f=all&kind=dev&lang=ru&ids=${ids.join(',')}`)
  assert.equal(dev.status, 200); assert.match(dev.type, /spreadsheetml/)
  const dx = text(dev.buf)
  assert.ok(dx.includes('Рег. номер GetsEstate'), 'нет шапки файла застройщику')
  assert.ok(!dx.includes(secret), 'в файле застройщику — имя партнёра')
  assert.ok(!/Передать до|Ответ до|Источник/.test(dx), 'в файле застройщику — внутренние колонки')
  const az = text((await get(OF, `f=all&kind=dev&lang=az&ids=${ids.join(',')}`)).buf)
  assert.ok(az.includes('Müştəri'), 'файл на азербайджанском без шапки на AZ')
  const full = text((await get(OF, `f=all&kind=full&ids=${ids.join(',')}`)).buf)
  assert.ok(full.includes(secret), 'в полном списке нет партнёра')
  // фильтр по поиску: только клиент партнёра
  const name = (await one('select name from portal.clients where id = $1', [pc])).name
  const only = text((await get(OF, `f=all&kind=dev&s=${encodeURIComponent(name)}`)).buf)
  assert.ok(only.includes(name) && !only.includes((await one('select name from portal.clients where id = $1', [cl])).name), 'поиск в выгрузке не сработал')
  assert.equal((await get(S, `f=all&kind=dev`)).status, 403, 'сейлз выгрузил регистрации')
  assert.ok(await one(`select 1 from portal.audit where action = 'registration.export' and user_id = $1`, [OF.id]), 'выгрузка не записана в журнал')
})
