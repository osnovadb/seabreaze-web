// М10: период отчёта — месяц 'YYYY-MM' / квартал 'YYYY-Qn' → [start, end)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { period, periodKeys, canEditPlan, canSeePlanFact } from '../../lib/planfact'

test('месяц', () => {
  assert.deepEqual(period('month', '2026-11'), { kind: 'month', start: '2026-11-01', end: '2026-12-01', key: '2026-11' })
  assert.deepEqual(period('month', '2026-12'), { kind: 'month', start: '2026-12-01', end: '2027-01-01', key: '2026-12' })
  assert.equal(period('month', '2028-02').end, '2028-03-01')
})
test('квартал', () => {
  assert.deepEqual(period('quarter', '2026-Q4'), { kind: 'quarter', start: '2026-10-01', end: '2027-01-01', key: '2026-Q4' })
  assert.deepEqual(period('quarter', '2027-Q1'), { kind: 'quarter', start: '2027-01-01', end: '2027-04-01', key: '2027-Q1' })
})
test('квартал = три его месяца встык', () => {
  for (const q of [1, 2, 3, 4]) {
    const Q = period('quarter', `2026-Q${q}`), m1 = period('month', `2026-${String(q * 3 - 2).padStart(2, '0')}`), m3 = period('month', `2026-${String(q * 3).padStart(2, '0')}`)
    assert.equal(Q.start, m1.start); assert.equal(Q.end, m3.end)
  }
})
test('кривой ключ — текущий период, ключ на выходе правильный', () => {
  for (const k of [undefined, '', '2026-13', '2026-Q5', 'abc']) {
    const p = period(k?.includes('Q') ? 'quarter' : 'month', k)
    assert.match(p.key, /^\d{4}-(\d{2}|Q[1-4])$/)
  }
})
test('список периодов без повторов, свежие сверху', () => {
  for (const k of ['month', 'quarter'] as const) { const ks = periodKeys(k); assert.equal(new Set(ks).size, ks.length); assert.deepEqual([...ks].sort().reverse(), ks) }
})
test('права: смотрят owner, market_head, finance; правят owner и market_head только свой рынок', () => {
  for (const r of ['owner', 'market_head', 'finance']) assert.ok(canSeePlanFact(r))
  for (const r of ['seller', 'agent', 'agency_head', 'office', 'content']) assert.ok(!canSeePlanFact(r), r)
  assert.ok(canEditPlan({ role: 'owner', market: 'GLOBAL' }, 'market', 'IL'))
  assert.ok(canEditPlan({ role: 'market_head', market: 'DE' }, 'market', 'DE'))
  assert.ok(!canEditPlan({ role: 'market_head', market: 'DE' }, 'market', 'IL'))
  assert.ok(!canEditPlan({ role: 'market_head', market: 'DE' }, 'user', null))
  assert.ok(!canEditPlan({ role: 'finance', market: 'GLOBAL' }, 'market', 'DE'))
})
