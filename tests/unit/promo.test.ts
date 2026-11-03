// М6: правило сложения скидок (priceChain) и выбор акции на квартиру (promoOf)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceChain, type Plan, type PromoView } from '../../lib/plans'
import { promoOf } from '../../lib/promo'

const plan = (x: Partial<Plan>): Plan => ({ id: 'p', project_id: 'pr', building_id: null, name: 'p', down_payment_pct: null, months: null,
  full_payment_discount_pct: null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: null, ...x })
const full5 = plan({ down_payment_pct: 100, full_payment_discount_pct: 5 })
const inst = plan({ down_payment_pct: 30, months: 24 })
const pct10: PromoView = { id: 'a', name: 'A', badge: null, kind: 'pct', pct: 10, usd: 10000, ends_on: null }
const fixed = (usd: number): PromoView => ({ id: 'f', name: 'F', badge: null, kind: 'fixed', pct: 0, usd, ends_on: null })
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)

test('без акции: 100% даёт скидку застройщика, рассрочка — нет', () => {
  near(priceChain(100000, full5, null).base, 95000)
  near(priceChain(100000, inst, null).base, 100000)
  assert.equal(priceChain(100000, inst, null).poolAllowed, true)
})
test('chain: акция от остатка после скидки за 100%', () => {
  const r = priceChain(100000, full5, pct10, 'chain')
  near(r.planAmt, 5000); near(r.promoAmt, 9500); near(r.base, 85500); assert.equal(r.poolAllowed, true)
})
test('sum: обе скидки от прайса', () => {
  const r = priceChain(100000, full5, pct10, 'sum')
  near(r.planAmt, 5000); near(r.promoAmt, 10000); near(r.base, 85000)
})
test('best: бо́льшая из двух, другая = 0', () => {
  const a = priceChain(100000, full5, pct10, 'best'); near(a.planAmt, 0); near(a.promoAmt, 10000); near(a.base, 90000)
  const b = priceChain(100000, full5, { ...pct10, pct: 3 }, 'best'); near(b.planAmt, 5000); near(b.promoAmt, 0); assert.equal(b.promoApplied, false)
})
test('exclusive: как chain, но при акции пул закрыт', () => {
  const r = priceChain(100000, full5, pct10, 'exclusive'); near(r.base, 85500); assert.equal(r.poolAllowed, false)
  assert.equal(priceChain(100000, full5, null, 'exclusive').poolAllowed, true, 'без акции пул открыт')
})
test('на рассрочке акция работает во всех режимах одинаково (скидки за 100% нет)', () => {
  for (const m of ['chain', 'sum', 'best', 'exclusive'] as const) near(priceChain(100000, inst, pct10, m).base, 90000)
})
test('fixed-акция не больше остатка цены', () => {
  const r = priceChain(100000, full5, fixed(200000), 'chain'); near(r.promoAmt, 95000); near(r.base, 0)
})
test('цена не уходит в минус ни в одном режиме', () => {
  for (const m of ['chain', 'sum', 'best', 'exclusive'] as const) for (const p of [pct10, fixed(99000), fixed(1e6)])
    assert.ok(priceChain(100000, full5, p, m).base >= 0, m)
})
// пограничный: в sum фиксированная акция может превысить остаток — сумма строк «скидка за 100%» + «акция» больше прайса
test('sum: показанные скидки в сумме не больше прайса', () => {
  const r = priceChain(100000, full5, fixed(99000), 'sum')
  assert.ok(r.planAmt + r.promoAmt <= r.list, `скидки ${r.planAmt + r.promoAmt} > прайс ${r.list}`)
})

// ── promoOf ──
const offer = (x: any) => ({ id: 'o', building_id: null, name: 'o', badge: null, kind: 'pct', value: 5, currency: null, unit_ids: null, ends_on: null, ...x })
const unit = { id: 'u1', building_id: 'bA', usd: 200000, price: 340000, currency: 'AZN' }
test('акция на другой блок не задевает квартиру', () => {
  assert.equal(promoOf(unit, [offer({ building_id: 'bB' })]), null)
  assert.ok(promoOf(unit, [offer({ building_id: 'bA' })]))
})
test('акция на список квартир — только для них', () => {
  assert.equal(promoOf(unit, [offer({ unit_ids: ['u2'] })]), null)
  assert.ok(promoOf(unit, [offer({ unit_ids: ['u1', 'u2'] })]))
})
test('из нескольких — самая выгодная в деньгах (7% от $200k = $14k > fixed $10k)', () => {
  const p = promoOf(unit, [offer({ id: 'a', value: 3 }), offer({ id: 'b', value: 7 }), offer({ id: 'c', kind: 'fixed', value: 10000, currency: 'USD' })])
  assert.equal(p?.id, 'b'); near(p!.usd, 14000)
  assert.equal(promoOf(unit, [offer({ id: 'a', value: 3 }), offer({ id: 'c', kind: 'fixed', value: 10000, currency: 'USD' })])?.id, 'c')
})
test('fixed в валюте квартиры переводится в USD по курсу квартиры', () => {
  const p = promoOf(unit, [offer({ kind: 'fixed', value: 17000, currency: 'AZN' })])
  near(p!.usd, 10000); near(p!.pct, 5)
})
test('квартира без цены — акции нет', () => {
  assert.equal(promoOf({ ...unit, usd: null as any }, [offer({})]), null)
})
// пограничный: fixed в чужой валюте (EUR на квартиру в AZN) молча пропадает — ожидаем, что админка такое не сохранит (проверяется отдельно)
test('fixed в чужой валюте — не применяется (это должно ловиться при сохранении)', () => {
  assert.equal(promoOf(unit, [offer({ kind: 'fixed', value: 5000, currency: 'EUR' })]), null)
})
