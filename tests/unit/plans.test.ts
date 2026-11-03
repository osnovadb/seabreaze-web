// Юнит-тесты графика платежей (М7): node --test --import tsx tests/unit/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paymentRows, isFull, termUnknown, planBase, type Plan } from '../../lib/plans'

const plan = (x: Partial<Plan>): Plan => ({ id: 'p', project_id: 'pr', building_id: null, name: 'p', down_payment_pct: null, months: null,
  full_payment_discount_pct: null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: null, ...x })
const sum = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0)
const D = (s: string) => new Date(s + 'T00:00:00Z')

test('сумма строк = Math.round(price) на любых ценах и планах', () => {
  const plans = [plan({ down_payment_pct: 100 }), plan({ down_payment_pct: 30, months: 24 }), plan({ down_payment_pct: 15 }),
    plan({ down_payment_pct: 20, months: 7 }), plan({ down_payment_pct: 10, schedule: [{ pct: 30, after_months: 6 }, { pct: 60, after_months: 12 }] })]
  for (const p of plans) for (const price of [0, 1, 99.5, 108120, 246600.4, 2494117.65, 1_000_003])
    assert.equal(sum(paymentRows(p, price, D('2026-11-04'))), Math.round(price), `${JSON.stringify(p)} @ ${price}`)
})

test('100% → одна строка «full» на всю сумму', () => {
  const r = paymentRows(plan({ down_payment_pct: 100 }), 200000, D('2026-11-04'))
  assert.deepEqual(r, [{ n: 1, kind: 'full', due: '2026-11-04', amount: 200000 }])
})

test('взнос без срока (BRABUS 15%) — не полная оплата: «down» + «rest» без даты', () => {
  const p = plan({ down_payment_pct: 15 })
  assert.equal(isFull(p), false)
  assert.equal(termUnknown(p), true)
  assert.equal(planBase(p, 1000), 1000, 'скидка за 100% не применяется')
  const r = paymentRows(p, 1000, D('2026-11-04'))
  assert.deepEqual(r.map((x) => [x.kind, x.amount, x.due]), [['down', 150, '2026-11-04'], ['rest', 850, null]])
})

test('months N → N+1 строк, ежемесячно, остаток — в последний', () => {
  const r = paymentRows(plan({ down_payment_pct: 30, months: 7 }), 100000, D('2026-11-04'))
  assert.equal(r.length, 8)
  assert.equal(r[0].amount, 30000)
  assert.deepEqual(r.slice(1, 7).map((x) => x.amount), Array(6).fill(10000))
  assert.equal(r[7].amount, 10000)
  assert.deepEqual(r.map((x) => x.due), ['2026-11-04', '2026-12-04', '2027-01-04', '2027-02-04', '2027-03-04', '2027-04-04', '2027-05-04', '2027-06-04'])
  const odd = paymentRows(plan({ down_payment_pct: 30, months: 3 }), 100001, D('2026-11-04'))
  assert.deepEqual(odd.map((x) => x.amount), [30000, 23333, 23333, 23335])
})

test('конец месяца прижимается: 31.01 → 28/29.02, 31.03, 30.04', () => {
  const r = paymentRows(plan({ down_payment_pct: 10, months: 3 }), 1000, D('2027-01-31'))
  assert.deepEqual(r.map((x) => x.due), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  const leap = paymentRows(plan({ down_payment_pct: 10, months: 1 }), 1000, D('2028-01-31'))
  assert.equal(leap[1].due, '2028-02-29')
})

test('переход через год', () => {
  const r = paymentRows(plan({ down_payment_pct: 50, months: 2 }), 1000, D('2026-12-15'))
  assert.deepEqual(r.map((x) => x.due), ['2026-12-15', '2027-01-15', '2027-02-15'])
})

test('свой график застройщика (schedule): строки «step» с датами по after_months', () => {
  const p = plan({ down_payment_pct: 20, schedule: [{ label: 'Каркас', pct: 30, after_months: 6 }, { label: 'Ключи', pct: 50, after_months: 18 }] })
  const r = paymentRows(p, 100000, D('2026-11-04'))
  assert.deepEqual(r.map((x) => [x.kind, x.label, x.due, x.amount]), [['down', undefined, '2026-11-04', 20000], ['step', 'Каркас', '2027-05-04', 30000], ['step', 'Ключи', '2028-05-04', 50000]])
})

test('schedule важнее months', () => {
  const r = paymentRows(plan({ down_payment_pct: 20, months: 12, schedule: [{ pct: 80, after_months: 3 }] }), 1000, D('2026-11-04'))
  assert.deepEqual(r.map((x) => x.kind), ['down', 'step'])
})

// ── Пограничные случаи: ожидания по смыслу графика (могут падать — это находки) ──
test('этапы графика идут по датам, даже если в базе записаны не по порядку', () => {
  const r = paymentRows(plan({ down_payment_pct: 20, schedule: [{ label: 'B', pct: 50, after_months: 18 }, { label: 'A', pct: 30, after_months: 6 }] }), 1000, D('2026-11-04'))
  const dues = r.map((x) => x.due as string)
  assert.deepEqual(dues, [...dues].sort(), 'даты должны идти по возрастанию')
})

test('доли графика с перебором (>100%) не дают отрицательный платёж', () => {
  const r = paymentRows(plan({ down_payment_pct: 30, schedule: [{ pct: 90, after_months: 6 }, { pct: 10, after_months: 12 }] }), 1000, D('2026-11-04'))
  assert.ok(r.every((x) => x.amount >= 0), JSON.stringify(r.map((x) => x.amount)))
})

test('нулевой первый взнос не даёт строку на 0', () => {
  const r = paymentRows(plan({ down_payment_pct: 0, months: 4 }), 1000, D('2026-11-04'))
  assert.ok(r.every((x) => x.amount > 0), JSON.stringify(r.map((x) => [x.kind, x.amount])))
})
