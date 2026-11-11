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
  assert.equal(withCl.status, 200); assert.ok(withCl.html.includes('data-nocl') && withCl.html.includes(name), 'в вкладке с ?cl= нет полосы клиента')
  const without = await get(S, '/catalog', `; ge_embed=1; ge_client=${cl}`)
  assert.ok(!without.html.includes('data-nocl'), 'клиент взялся из старой общей cookie — залипает между окнами')
  const card = await get(S, `/b24/units/${cl}`, '; ge_embed=1')
  assert.ok(card.html.includes(name) && card.html.includes('data-nocl'), 'в Units клиента нет полосы с «Выйти из клиента»')
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
