// QA 2.2 · 21 Находки ревью 10.11 («Да, конечно чини», 11.11): Б9 клиент вкладки Bitrix24 — из адреса; Б10 роль нового пользователя;
// Б12 обезличенный клиент — карточка закрыта
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, q, one, close, act, cookie, BASE, uniq } from './h.mjs'

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
    await q(`update portal.genplans set title = 'QA основной', views = $2::jsonb where project_id = $1`, [pr.id, JSON.stringify([{ title: 'QA второй ракурс', image: '/brand/favicon.svg', polygons: [] }])])
    const v0 = await get(S, '/projects/test-marina')
    assert.ok(v0.html.includes('?v=1') && v0.html.includes('QA второй ракурс'), 'нет переключателя ракурсов')
    assert.ok(v0.html.includes(g.image), 'по умолчанию не основной вид')
    const v1 = await get(S, '/projects/test-marina?v=1')
    assert.ok(v1.html.includes('/brand/favicon.svg'), 'по ?v=1 не второй ракурс')
    assert.ok(/[0-9]<\/div><div class="small muted">корпус(а|ов)?</.test(v0.html), 'плитка корпусов без числа или слова')
  } finally {
    await q(`update portal.genplans set title = null, views = $2::jsonb where project_id = $1`, [pr.id, JSON.stringify(g.views || [])])
  }
})
