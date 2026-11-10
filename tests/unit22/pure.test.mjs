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

// 10.11 · срок сдачи кварталом и годом
import { parseDelivery, canonDelivery, deliveryFromForm, fmtDelivery, deliveryRange } from '../../lib/delivery.ts'
test('срок сдачи: разбор прежних записей и канон с годом впереди (сайты берут slice(0, 4))', () => {
  const c = (x) => canonDelivery(parseDelivery(x))
  assert.equal(c('IV кв. 2027'), '2027-Q4'); assert.equal(c('II квартал 2028'), '2028-Q2'); assert.equal(c('Q3 2026'), '2026-Q3'); assert.equal(c('4 кв 2029'), '2029-Q4')
  assert.equal(c('2030'), '2030'); assert.equal(c('2027-Q1'), '2027-Q1'); assert.equal(c('сдан'), 'done'); assert.equal(c('2025-done'), '2025-done')
  assert.equal(parseDelivery('уточняется'), null); assert.equal(parseDelivery(''), null)
  for (const v of ['2027-Q4', '2030', '2025-done']) assert.match(v.slice(0, 4), /^\d{4}$/)
})
test('срок сдачи: из формы и вывод на четырёх языках', () => {
  assert.equal(deliveryFromForm('4', '2027'), '2027-Q4'); assert.equal(deliveryFromForm('', '2027'), '2027'); assert.equal(deliveryFromForm('4', ''), null); assert.equal(deliveryFromForm('done', '2025'), '2025-done'); assert.equal(deliveryFromForm('done', ''), null); assert.equal(deliveryFromForm('', ''), null)
  assert.equal(fmtDelivery('ru', '2027-Q4'), 'IV кв. 2027'); assert.equal(fmtDelivery('en', '2027-Q4'), 'Q4 2027'); assert.equal(fmtDelivery('de', '2027-Q4'), 'Q4 2027'); assert.equal(fmtDelivery('he', '2027-Q4'), 'רבעון 4 2027')
  assert.equal(fmtDelivery('ru', '2030'), '2030'); assert.equal(fmtDelivery('de', '2025-done'), 'fertiggestellt · 2025'); assert.equal(fmtDelivery('ru', 'уточняется'), 'уточняется')
  assert.equal(fmtDelivery('ru', 'IV кв. 2027'), 'IV кв. 2027', 'прежняя запись выводится в том же виде')
})
test('срок проекта: свой или диапазон по блокам', () => {
  assert.equal(deliveryRange('en', null, ['2028-Q1', '2027-Q2', null, '2027-Q4']), 'Q2 2027 – Q1 2028')
  assert.equal(deliveryRange('ru', '2029', ['2027-Q2']), '2029')
  assert.equal(deliveryRange('ru', null, ['2030', '2030']), '2030')
  assert.equal(deliveryRange('en', null, []), '')
})

// 10.11 · калькулятор вариантов
import { calcVariant, gridDiscount, activeGrid, fromPlan } from '../../lib/calc.ts'
const PL = (o) => ({ id: o.id || 'p', project_id: 'x', building_id: null, name: o.name || 'p', down_payment_pct: o.down ?? null, months: o.months ?? null, full_payment_discount_pct: o.fpd ?? null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: o.schedule ?? null })
const COND = { fix_pct: 5, pool_pct: 20, agent_fix_pct: 2, agent_pool_pct: 10, agent_our_pool_share: 0, seller_share_pct: 15 }
test('калькулятор: рамки плана — взнос не меньше минимума, срок не длиннее максимума', () => {
  const r = calcVariant({ list: 200000, plans: [PL({ id: 'a', down: 30, months: 24 })], downPct: 10, months: 36, disc: 0, start: '2026-12-01' })
  assert.equal(r.downPct, 30); assert.equal(r.months, 24); assert.equal(r.clamped.length, 2); assert.equal(r.approx, false)
  assert.equal(r.rows.length, 25); assert.equal(r.down, 60000); assert.equal(r.rows.reduce((a, x) => a + x.amount, 0), 200000, 'сумма строк = цене')
  assert.equal(r.last, '2028-12-01')
  const ok = calcVariant({ list: 200000, plans: [PL({ id: 'a', down: 30, months: 24 })], downPct: 50, months: 12, disc: 0 })
  assert.equal(ok.downPct, 50); assert.equal(ok.months, 12); assert.equal(ok.clamped.length, 0)
})
test('калькулятор: без планов — свободный расчёт с пометкой «ориентировочно»', () => {
  const r = calcVariant({ list: 150000, plans: [], downPct: 20, months: 30, disc: 0 })
  assert.equal(r.approx, true); assert.equal(r.downPct, 20); assert.equal(r.months, 30); assert.equal(r.rows.length, 31)
  assert.equal(r.rows.reduce((a, x) => a + x.amount, 0), 150000)
  const full = calcVariant({ list: 150000, plans: [], downPct: 100, months: 12, disc: 0 })
  assert.equal(full.months, 0); assert.equal(full.rows.length, 1)
})
test('калькулятор: сетка скидок за взнос и «скидка за 100 %» плана как частный случай', () => {
  const grid = [{ from_pct: 50, discount_pct: 3 }, { from_pct: 70, discount_pct: 5 }]
  assert.equal(gridDiscount(grid, 49.9), 0); assert.equal(gridDiscount(grid, 50), 3); assert.equal(gridDiscount(grid, 80), 5)
  const r = calcVariant({ list: 100000, plans: [PL({ id: 'r', down: 30, months: 24 }), PL({ id: 'f', down: 100, fpd: 7 })], grid, downPct: 70, months: 12, disc: 0 })
  assert.equal(r.devPct, 5); assert.equal(r.base, 95000)
  const f = calcVariant({ list: 100000, plans: [PL({ id: 'r', down: 30, months: 24 }), PL({ id: 'f', down: 100, fpd: 7 })], grid, planId: 'f', downPct: 100, months: 0, disc: 0 })
  assert.equal(f.devPct, 7); assert.equal(f.total, 93000)
  // сетка по датам и блоку: своя ступень блока главнее общей
  const g2 = [{ from_pct: 50, discount_pct: 2, valid_to: '2026-01-01' }, { from_pct: 50, discount_pct: 4 }, { from_pct: 50, discount_pct: 6, building_id: 'B' }]
  assert.equal(gridDiscount(activeGrid(g2, '2026-11-10'), 60), 4); assert.equal(gridDiscount(activeGrid(g2, '2026-11-10', 'B'), 60), 6)
})
test('калькулятор: скидка из пула — до предела роли; выше порога — «нужно согласование»; доход партнёра', () => {
  const r = calcVariant({ list: 100000, plans: [], downPct: 30, months: 24, disc: 12, cap: 5, ceiling: 10, cond: COND, ext: true })
  assert.equal(r.disc, 10); assert.ok(r.clamped.length); assert.equal(r.needsApproval, true); assert.equal(r.final, 90000)
  assert.ok(Math.abs(r.split.agent - 90000 * 0.02) < 0.01, 'вся часть пула партнёра ушла в скидку — остаётся фикс')
  const ok = calcVariant({ list: 100000, plans: [], downPct: 30, months: 24, disc: 4, cap: 5, ceiling: 10 })
  assert.equal(ok.needsApproval, false)
  assert.deepEqual(fromPlan(PL({ down: 30, months: 24 })), { downPct: 30, months: 24 }); assert.deepEqual(fromPlan(PL({ down: 100 })), { downPct: 100, months: 0 })
})
test('калькулятор (QA 10.11): план выбирается по взносу и сроку; срок до 120; план без срока — ориентировочно', async () => {
  const { pickPlan, startPlan } = await import('../../lib/calc.ts')
  const marina = [PL({ id: 'full', down: 100, fpd: 5 }), PL({ id: 'inst', down: 30, months: 24 })]
  assert.equal(startPlan(marina).id, 'inst', 'старт — с плана рассрочки, а не с «100% сразу»')
  const a = calcVariant({ list: 100000, plans: marina, downPct: 60, months: 12, disc: 0 })
  assert.equal(a.plan.id, 'inst'); assert.equal(a.downPct, 60); assert.equal(a.months, 12); assert.equal(a.clamped.length, 0)
  const f = calcVariant({ list: 100000, plans: marina, downPct: 100, months: 12, disc: 0 })
  assert.equal(f.plan.id, 'full'); assert.equal(f.months, 0); assert.equal(f.total, 95000)
  const lo = calcVariant({ list: 100000, plans: marina, downPct: 10, months: 12, disc: 0 })
  assert.equal(lo.plan.id, 'inst'); assert.equal(lo.downPct, 30, 'взнос ниже минимума подтягивается к рассрочке, не к 100 %')
  const free = calcVariant({ list: 100000, plans: [], downPct: 20, months: 200, disc: 0 })
  assert.equal(free.months, 120); assert.ok(free.clamped.length)
  const brabus = [PL({ id: 'b', down: 15 })]
  assert.equal(calcVariant({ list: 100000, plans: brabus, downPct: 15, months: 0, disc: 0 }).approx, false)
  const b36 = calcVariant({ list: 100000, plans: brabus, downPct: 15, months: 36, disc: 0 })
  assert.equal(b36.approx, true, 'у плана застройщика срок не задан — расчёт с выбранным сроком ориентировочный'); assert.equal(b36.months, 36)
  assert.equal(pickPlan([], 50, 12), null)
})
test('калькулятор: введённая сумма взноса сохраняется как есть', () => {
  const total = 161400, v = 80000
  const r = calcVariant({ list: total, plans: [], downPct: (v / total) * 100, months: 24, disc: 0 })
  assert.equal(r.down, 80000)
})
