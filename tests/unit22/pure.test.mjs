// QA 2.2 · юнит-тесты чистых функций (Node 22 снимает типы сам): node --test tests/unit22/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { split } from '../../lib/money.ts'
import { partnerCol, stageBlock, PARTNER_STAGES } from '../../lib/stages.ts'
import { kycMissing } from '../../lib/kyc.ts'

const C = { fix_pct: 5, pool_pct: 20, agent_fix_pct: 2, agent_pool_pct: 10, agent_our_pool_share: 0, seller_share_pct: 15 }
test('split: пример модели от 24.10 (прайс 100 000, пул 20%, часть агента 10%, фикс агента 2%)', () => {
  for (const [disc, agentIncomeFromList] of [[0, 12000], [6, 6000], [10, 2000]]) {
    const s = split(C, 100000, disc, true)
    // в системе фикс — от итоговой цены: 2% от (100 000 − скидка)
    const expect = (100000 * (1 - disc / 100)) * 0.02 + Math.max(0, 10 - disc) * 1000
    assert.ok(Math.abs(s.agent - expect) < 0.01, `скидка ${disc}%: ${s.agent} ≠ ${expect}`)
    assert.ok(Math.abs(agentIncomeFromList - (2000 + Math.max(0, 10 - disc) * 1000)) < 0.01)
  }
})
test('split: всё распределено — агент + мы = фикс + остаток пула', () => {
  for (const disc of [0, 3, 10, 15, 20]) for (const withAgent of [true, false]) {
    const s = split(C, 250000, disc, withAgent)
    const total = s.final * 0.05 + Math.max(0, 20 - disc) * 2500
    assert.ok(Math.abs(s.agent + s.ours - total) < 0.01, `disc ${disc} agent ${withAgent}`)
    assert.ok(s.agent >= 0 && s.ours >= 0)
  }
})
test('split: без агента вся комиссия наша, бонус сейлза = 15% от нашей', () => {
  const s = split(C, 100000, 0, false)
  assert.equal(s.agent, 0); assert.ok(Math.abs(s.seller - s.ours * 0.15) < 0.01)
})
test('split: скидка больше пула не уводит в минус', () => {
  const s = split(C, 100000, 25, true)
  assert.ok(s.ours >= 0 && s.agent >= 0, JSON.stringify(s))
})
test('partnerCol: стадия Bitrix24 главнее фактов портала', () => {
  assert.equal(partnerCol({ b24_stage: 'Reserved', attach_status: 'candidate' }), 'reserved')
  assert.equal(partnerCol({ b24_stage: 'SPA approval' }), 'spa')
  assert.equal(partnerCol({ attach_status: 'candidate' }), 'candidate')
  assert.equal(partnerCol({ booking: 'queued' }), 'request')
  assert.equal(partnerCol({ paid: true, booking: 'converted' }), 'won')
  assert.equal(partnerCol({ regs_sent: true }), 'registration')
  assert.equal(partnerCol({}), 'selection')
  assert.equal(PARTNER_STAGES.length, 8)
})
test('stageBlock: партнёр двигает только Selection, пауза и отказ разрешены', () => {
  const ctx = { stage: 'selection', paused: false, hasBooking: false, hasDeal: false, qualified: true }
  for (const [, , target] of PARTNER_STAGES.filter(([k]) => !['selection', 'request'].includes(k))) assert.ok(stageBlock('agent', ctx, target), target)
  assert.equal(stageBlock('agent', ctx, 'selection'), null)
  assert.equal(stageBlock('agent', ctx, 'pause'), null); assert.equal(stageBlock('agent', ctx, 'lost'), null)
  assert.ok(stageBlock('agent', ctx, 'booking'), 'бронь — только на квартиру')
  assert.ok(stageBlock('finance', ctx, 'selection'), 'финансы не двигают стадии')
})
test('stageBlock: без квалификации дальше Selection нельзя', () => {
  assert.ok(stageBlock('agent', { stage: 'lead', paused: false, hasBooking: false, hasDeal: false, qualified: false }, 'selection'))
})
test('kycMissing: минимум 251 — паспорт и адрес главного; созаёмщик и компания — свои документы', () => {
  const base = { kyc_citizenship: 'DE', kyc_tax_residence: 'DE', kyc_pep: false }
  assert.deepEqual(kycMissing(['passport', 'address'], base), [])
  assert.ok(kycMissing(['passport'], base).length === 1)
  const buyers = [{ id: 'b1', kind: 'person', name: 'Co', citizenship: 'DE', tax_residence: null, pep: false, reg_no: null, ubo: null }, { id: 'b2', kind: 'company', name: 'Co GmbH', citizenship: null, tax_residence: null, pep: null, reg_no: 'HRB', ubo: 'X' }]
  const docs = [{ kind: 'passport', buyer_id: null }, { kind: 'address', buyer_id: null }]
  assert.equal(kycMissing(docs, base, buyers).length, 5)
  const all = [...docs, { kind: 'passport', buyer_id: 'b1' }, { kind: 'address', buyer_id: 'b1' }, { kind: 'registry', buyer_id: 'b2' }, { kind: 'ubo', buyer_id: 'b2' }, { kind: 'director', buyer_id: 'b2' }]
  assert.deepEqual(kycMissing(all, base, buyers), [])
  assert.ok(kycMissing(all, { ...base, kyc_pep: null }, buyers).includes('ответ про PEP'))
})
