// QA 2.2 · 21 Находки ревью 10.11 («Да, конечно чини», 11.11): Б9 клиент вкладки Bitrix24 — из адреса; Б10 роль нового пользователя;
// Б12 обезличенный клиент — карточка закрыта
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, register, q, one, close, act, cookie, BASE, uniq, freeUnit, lastBooking } from './h.mjs'

after(close)
const get = async (u, path, extra = '') => {
  const r = await fetch(BASE + path, { headers: { host: 'portal.pdna.pro', cookie: `ge_s=${await cookie(u)}${extra}` }, redirect: 'manual' })
  return { status: r.status, html: r.status === 200 ? await r.text() : '' }
}
test('Б9: клиент вкладки Bitrix24 — из адреса (?cl=), без него — без клиента; общей cookie больше нет', async () => {
  const S = await user('seller')
  const cl = (await register(S)).result.id
  const name = (await one('select name from portal.clients where id = $1', [cl])).name
  const withCl = await get(S, `/catalog?cl=${cl}`, '; ge_embed=1')
  assert.equal(withCl.status, 200); assert.ok(withCl.html.includes(`/b24/units/${cl}`) && withCl.html.includes(name), 'в вкладке с ?cl= нет полосы клиента') // М3 (обход 11.11): в полосе — имя и «← Units», без «выйти из клиента»
  const without = await get(S, '/catalog', `; ge_embed=1; ge_client=${cl}`)
  assert.ok(!without.html.includes(`/b24/units/${cl}`), 'клиент взялся из старой общей cookie — залипает между окнами')
  const card = await get(S, `/b24/units/${cl}`, '; ge_embed=1')
  assert.ok(card.html.includes(name) && !card.html.includes('class="banner"'), 'в Units клиента — повтор полосы клиента (М3: там свои вкладки)')
})
test('Б10: новый пользователь — без роли не создаётся', async () => {
  const OW = await user('owner', { market: null })
  const r = await act(OW, 'createUser', { name: 'QA no role', email: `${uniq('norole')}@qa.test`, role: '', market: 'DE', locale: 'de' })
  assert.match(JSON.stringify(r.result || r), /Выберите роль/)
})
test('Б12: обезличенный клиент — нет в списке, карточка закрыта, правки не проходят', async () => {
  const S = await user('seller')
  const cl = (await register(S)).result.id
  await q(`update portal.clients set anonymized_at = now(), name = 'Deleted · QA' where id = $1`, [cl])
  assert.ok(!(await get(S, '/clients')).html.includes(`/clients/${cl}`), 'обезличенный клиент в рабочем списке')
  assert.ok((await get(S, `/clients/${cl}`)).html.includes('Карточка закрыта'), 'карточка обезличенного клиента открыта для работы')
  const r = await act(S, 'saveQualification', { client: cl, goal: 'invest', budget: '200-300k', timeline: '3m', country: 'DE', language: 'de' })
  assert.ok(r.thrown, 'квалификация обезличенного клиента сохранилась')
})
test('292: карточка клиента со сделкой по плану оплаты открывается и показывает платежи клиента', async () => {
  const OW = await user('owner', { market: null })
  const S = await user('seller')
  const { freeUnit } = await import('./h.mjs')
  const cl = (await register(S)).result.id
  const u = await freeUnit()
  const plan = await one(`select id from public.payment_plans where project_id = $1 and down_payment_pct < 100 order by sort limit 1`, [u.project_id])
  await act(S, 'createBooking', { unit: u.id, client: cl, discount: '0', plan: plan?.id || '' })
  const b = await one('select id from portal.bookings where client_id = $1 order by created_at desc limit 1', [cl])
  const OF = await user('office')
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-292' })
  await q(`update portal.clients set kyc_status = 'passed' where id = $1`, [cl])
  await act(OF, 'bookingAction', { id: b.id, act: 'contract' })
  const p = await get(OW, `/clients/${cl}`)
  assert.equal(p.status, 200, 'карточка клиента со сделкой упала')
  assert.ok(p.html.includes('Платежи клиента'), 'нет блока платежей клиента')
  await q(`update portal.deals set stage = 'cancelled' where client_id = $1`, [cl])
})

// Денис 11.11: ракурсы генплана — переключатель над картинкой (страница проекта и показ), ?v= выбирает вид; О85 — «N корпус/корпуса/корпусов»
test('генплан: второй ракурс по ?v=1, переключатель на странице проекта; склонение «корпусов»', async () => {
  const S = await user('seller')
  const pr = await one(`select p.id from projects p where p.slug = 'test-marina'`)
  const g = await one('select image, views from portal.genplans where project_id = $1', [pr.id])
  assert.ok(g, 'у тестового проекта нет генплана')
  try {
    // ракурс — файлом портала, как в жизни: права на картинку берутся из genplans.views[].file_id (ревью 11.11: второй ракурс BRABUS отдавал 404)
    const f = await one(`select id from portal.files where id = (select file_id from portal.genplans where project_id = $1)`, [pr.id])
    assert.ok(f, 'у основного вида тестового проекта нет файла портала')
    const fid = (await one(`insert into portal.files (filename, mime, size, disk_name) select 'QA ракурс', mime, size, disk_name from portal.files where id = $1 returning id`, [f.id])).id
    await q(`update portal.genplans set title = 'QA основной', views = $2::jsonb where project_id = $1`, [pr.id, JSON.stringify([{ title: 'QA второй ракурс', image: `/files/${fid}`, file_id: fid, polygons: [] }])])
    const v0 = await get(S, '/projects/test-marina')
    assert.ok(v0.html.includes('?v=1') && v0.html.includes('QA второй ракурс'), 'нет переключателя ракурсов')
    assert.ok(v0.html.includes(g.image), 'по умолчанию не основной вид')
    const v1 = await get(S, '/projects/test-marina?v=1')
    assert.ok(v1.html.includes(`/files/${fid}`), 'по ?v=1 не второй ракурс')
    for (const src of [g.image, `/files/${fid}`]) assert.equal((await get(S, src)).status, 200, 'картинка ракурса не отдаётся: ' + src)
    assert.ok(/[0-9]<\/div><div class="small muted">корпус(а|ов)?</.test(v0.html), 'плитка корпусов без числа или слова')
  } finally {
    await q(`update portal.genplans set title = null, views = $2::jsonb where project_id = $1`, [pr.id, JSON.stringify(g.views || [])])
    await q(`delete from portal.files where filename = 'QA ракурс'`)
  }
})

// 383 (Денис 12.11): запрос брони — только после согласия клиента; холд на 24 часа — без согласия
test('383: без согласия клиента бронь не запрашивается, холд ставится; с согласием — бронь уходит', async () => {
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
  const S = await user('seller')
  const cl = (await register(S)).result.id
  assert.notEqual((await one('select consent_status from portal.clients where id = $1', [cl])).consent_status, 'given')
  const u = await freeUnit()
  const r = await act(S, 'createBooking', { unit: u.id, client: cl, discount: 0, __noConsent: '1' })
  assert.match(JSON.stringify(r.result || r), /согласи/, 'бронь без согласия клиента прошла')
  assert.ok(!(await lastBooking(cl)), 'бронь создана без согласия')
  await act(S, 'holdUnit', { unit: u.id, client: cl })
  const h = await lastBooking(cl)
  assert.equal(h?.status, 'hold', 'холд без согласия не поставился')
  await act(S, 'createBooking', { unit: u.id, client: cl, discount: 0 })
  assert.equal((await lastBooking(cl)).status, 'requested', 'с согласием бронь не ушла')
  await act(S, 'bookingAction', { id: (await lastBooking(cl)).id, act: 'cancel' })
})

// 380 (Денис 12.11): без даты и номера договор не отмечается; окно возврата комиссии — от даты договора
test('380: «Договор подписан» — только с датой и номером; дата сохраняется в сделке', async () => {
  const pr = await one(`select p.id from projects p where p.slug = 'premium-residence'`)
  const OF = await user('office'), S = await user('seller')
  const cl = (await register(S)).result.id
  await q(`update portal.clients set kyc_status = 'passed' where id = $1`, [cl])
  const u = await freeUnit()
  await act(S, 'createBooking', { unit: u.id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm' })
  await act(OF, 'bookingAction', { id: b.id, act: 'contract', contract_date: '', contract_no: '' })
  assert.equal((await one('select status from portal.bookings where id = $1', [b.id])).status, 'confirmed', 'договор отмечен без даты и номера')
  await act(OF, 'bookingAction', { id: b.id, act: 'contract', contract_date: '2026-10-01', contract_no: 'SPA-QA-380' })
  const d = await one('select contract_date::text, contract_no from portal.deals where booking_id = $1', [b.id])
  assert.equal(d?.contract_no, 'SPA-QA-380'); assert.equal(d?.contract_date, '2026-10-01')
  // О99: файл договора отдаётся команде клиента, партнёру — нет; ссылка — в карточке клиента
  const src = await one(`select id from portal.files where mime = 'application/pdf' or mime like 'image/%' order by created_at limit 1`)
  if (src) {
    const fid = (await one(`insert into portal.files (filename, mime, size, disk_name) select 'QA договор', mime, size, disk_name from portal.files where id = $1 returning id`, [src.id])).id
    await q('update portal.deals set contract_file_id = $2 where booking_id = $1', [b.id, fid])
    assert.equal((await get(OF, `/files/${fid}`)).status, 200, 'файл договора не отдаётся офису')
    assert.equal((await get(S, `/files/${fid}`)).status, 200, 'файл договора не отдаётся сейлзу клиента')
    const ag = await agency('DE'), P = await user('agency_head', { agency_id: ag.id })
    assert.equal((await get(P, `/files/${fid}`)).status, 404, 'файл договора отдан партнёру')
    assert.ok((await get(S, `/clients/${cl}`)).html.includes(`/files/${fid}`), 'в карточке клиента нет ссылки на файл договора')
  }
  void pr
})
