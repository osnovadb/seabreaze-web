// KYC: что нужно для отправки и кто принимает решение (v2, коммит 4426b0a)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kycMissing, canReviewKyc, KYC_DOCS } from '../../lib/kyc'

const full = { kyc_citizenship: 'DE', kyc_tax_residence: 'DE', kyc_pep: false }

test('всё собрано → ничего не не хватает (PEP «нет» — это ответ)', () => {
  assert.deepEqual(kycMissing([...KYC_DOCS], full), [])
  assert.deepEqual(kycMissing([...KYC_DOCS, 'other'], { ...full, kyc_pep: true }), [])
})
test('без ответа про PEP (null) — отправлять нельзя', () => {
  assert.ok(kycMissing([...KYC_DOCS], { ...full, kyc_pep: null }).length > 0)
})
test('каждого вида документа не хватает по отдельности', () => {
  for (const k of KYC_DOCS) assert.equal(kycMissing(KYC_DOCS.filter((x) => x !== k), full).length, 1, k)
})
test('пустые поля анкеты', () => {
  assert.equal(kycMissing([...KYC_DOCS], { ...full, kyc_citizenship: '' }).length, 1)
  assert.equal(kycMissing([...KYC_DOCS], { ...full, kyc_tax_residence: null }).length, 1)
})
test('решение по KYC — только office и owner', () => {
  for (const r of ['office', 'owner']) assert.equal(canReviewKyc(r), true, r)
  for (const r of ['market_head', 'seller', 'agent', 'agency_head', 'finance', 'content', '']) assert.equal(canReviewKyc(r), false, r)
})
