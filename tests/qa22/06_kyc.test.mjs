// QA 2.2 · 06 KYC и KYB (§5 П4, решение 251): минимум документов, созаёмщики и компания, проверяет не тот, кто ведёт, отказ Compliance, загрузка клиентом по ссылке
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, register, freeUnit, q, one, close, act, lastBooking, client, page } from './h.mjs'

after(close)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')
const up = (u, cl, kind, buyer = '') => act(u, 'uploadBuyerDoc', { client: cl, kind, buyer }, { files: [{ field: 'file', name: `${kind}.pdf`, content: PDF, type: 'application/pdf' }] })
let S, OF, OW
test('setup', async () => { S = await user('seller'); OF = await user('office'); OW = await user('owner', { market: null }) })
test('без паспорта и адреса KYC не отправляется; с минимумом — на проверке', async () => {
  const cl = (await register(S)).result.id
  await act(S, 'saveKycData', { client: cl, citizenship: 'DE', tax_residence: 'DE', pep: 'no' })
  await act(S, 'submitKyc', { client: cl })
  assert.equal((await client(cl)).kyc_status, 'none', 'отправлено без документов')
  await up(S, cl, 'passport'); await up(S, cl, 'address')
  await act(S, 'submitKyc', { client: cl })
  assert.equal((await client(cl)).kyc_status, 'pending')
})
test('созаёмщик и компания: без их документов KYC не отправляется', async () => {
  const cl = (await register(S)).result.id
  await act(S, 'saveKycData', { client: cl, citizenship: 'DE', tax_residence: 'DE', pep: 'no' })
  await up(S, cl, 'passport'); await up(S, cl, 'address')
  await act(S, 'addBuyer', { client: cl, kind: 'person', name: 'QA Co-buyer', citizenship: 'DE', pep: 'no' })
  await act(S, 'addBuyer', { client: cl, kind: 'company', name: 'QA GmbH', reg_no: 'HRB QA', ubo: 'QA 100%' })
  await act(S, 'submitKyc', { client: cl })
  assert.equal((await client(cl)).kyc_status, 'none', 'отправлено без документов созаёмщика и компании')
  const [p, co] = await q('select id, kind from portal.buyers where client_id = $1 order by kind desc', [cl])
  await up(S, cl, 'passport', p.id); await up(S, cl, 'address', p.id)
  for (const k of ['registry', 'ubo', 'director']) await up(S, cl, k, co.id)
  await act(S, 'submitKyc', { client: cl })
  assert.equal((await client(cl)).kyc_status, 'pending', 'полный комплект не ушёл на проверку')
})
test('проверяет не тот, кто ведёт; сейлз не может пройти KYC', async () => {
  const cl = (await register(OF)).result?.id
  if (cl) {
    await q(`update portal.clients set kyc_status = 'pending' where id = $1`, [cl])
    await act(OF, 'reviewKyc', { client: cl, decision: 'passed' })
    assert.equal((await client(cl)).kyc_status, 'pending', 'бэк-офис прошёл KYC своему клиенту')
  }
  const c2 = (await register(S)).result.id
  await q(`update portal.clients set kyc_status = 'pending' where id = $1`, [c2])
  await act(S, 'reviewKyc', { client: c2, decision: 'passed' })
  assert.equal((await client(c2)).kyc_status, 'pending', 'сейлз прошёл KYC')
  await act(OF, 'reviewKyc', { client: c2, decision: 'passed' })
  assert.equal((await client(c2)).kyc_status, 'passed')
})
test('отклонение без комментария не проходит', async () => {
  const cl = (await register(S)).result.id
  await q(`update portal.clients set kyc_status = 'pending' where id = $1`, [cl])
  await act(OF, 'reviewKyc', { client: cl, decision: 'rejected', note: '' })
  assert.equal((await client(cl)).kyc_status, 'pending')
})
test('отказ Compliance: брони сняты (подтверждённая — к снятию у застройщика), без рекламы, стадия lost', async () => {
  const cl = (await register(S)).result.id
  await act(S, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  const b = await lastBooking(cl)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-C' })
  await q(`update portal.clients set kyc_status = 'pending', marketing_consent_at = now() where id = $1`, [cl])
  await act(OF, 'reviewKyc', { client: cl, decision: 'compliance', note: 'QA sanctions hit' })
  const c = await client(cl)
  assert.equal(c.kyc_status, 'compliance'); assert.equal(c.marketing_consent_at, null); assert.equal(c.lost_reason, 'Compliance')
  assert.equal((await one('select status from portal.bookings where id = $1', [b.id])).status, 'release_pending')
})
test('загрузка клиентом по ссылке: работает без входа; на проверке — закрыта; плохой токен — 404', async () => {
  const cl = (await register(S)).result.id
  await act(S, 'kycLink', { client: cl })
  const tok = (await client(cl)).kyc_token
  assert.ok(tok)
  assert.equal((await page(null, `/k/${tok}`)).status, 200)
  assert.equal((await page(null, `/k/nope${tok}`)).status, 404)
  const r = await act(null, 'clientKycUpload', { token: tok, kind: 'passport', buyer: '' }, { files: [{ field: 'file', name: 'p.pdf', content: PDF, type: 'application/pdf' }] })
  assert.ok(r.result?.ok, JSON.stringify(r))
  assert.ok(await one(`select 1 from portal.client_documents where client_id = $1 and kind = 'passport' and note like '%клиентом%'`, [cl]))
  await q(`update portal.clients set kyc_status = 'pending' where id = $1`, [cl])
  const r2 = await act(null, 'clientKycUpload', { token: tok, kind: 'address', buyer: '' }, { files: [{ field: 'file', name: 'a.pdf', content: PDF, type: 'application/pdf' }] })
  assert.ok(r2.result?.error, 'загрузка во время проверки прошла')
  const r3 = await act(null, 'clientKycUpload', { token: tok, kind: 'passport', buyer: '' }, { files: [{ field: 'file', name: 'x.exe', content: PDF, type: 'application/x-msdownload' }] })
  assert.ok(r3.result?.error, 'принят .exe')
})
