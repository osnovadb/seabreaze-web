// Правило прайс-листа (lib/priceRule.ts) и разбор шахматки (lib/chessImport.ts) — чистые функции
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normRule, ruleError, matches, newPrice, computeItems } from '../../lib/priceRule'
import { parseChess } from '../../lib/chessImport'

const U = (o: Record<string, unknown> = {}) => ({ id: 'u', building_id: 'b', unit_type: '2br', rooms: 3, layout_id: 'l', number: '305', floor: 3, status: 'available', price: 100000, currency: 'USD', area: 50, ...o })

test('normRule: по умолчанию свободные, округление 100, процент; валюта только из трёх заглавных букв', () => {
  const r = normRule({})
  assert.deepEqual([r.statuses, r.round, r.op, r.currency], [['available'], 100, 'pct', null])
  assert.equal(normRule({ round: 7, op: 'zzz', currency: 'usd' }).round, 100)
  assert.equal(normRule({ op: 'zzz' }).op, 'pct')
  assert.equal(normRule({ currency: 'usd' }).currency, null)
})

test('ruleError: процент от −50 до 50 и не ноль, шаг по этажам ≤ 10 с базовым этажом, сумма — с валютой', () => {
  const e = (o: Record<string, unknown>) => ruleError(normRule(o))
  assert.ok(e({ op: 'pct', value: 0 })); assert.ok(e({ op: 'pct', value: 51 })); assert.equal(e({ op: 'pct', value: -50 }), '')
  assert.ok(e({ op: 'floor_step', value: 1 })); assert.ok(e({ op: 'floor_step', value: 11, base_floor: 1 })); assert.equal(e({ op: 'floor_step', value: 2, base_floor: 1 }), '')
  assert.ok(e({ op: 'add', value: 100 })); assert.equal(e({ op: 'add', value: -100, currency: 'USD' }), '')
  assert.ok(e({ op: 'set', value: -1, currency: 'USD' }))
  assert.ok(e({ op: 'pct', value: 3, floor_from: 5, floor_to: 2 }))
})

test('matches: 4 = 4+ комнат, стояк, этажи, статусы', () => {
  const r = normRule({ rooms: [4], risers: ['05'], floor_from: 3, floor_to: 3 })
  assert.ok(matches(U({ rooms: 5 }), r)); assert.ok(!matches(U({ rooms: 3 }), r))
  assert.ok(!matches(U({ rooms: 5, number: '301' }), r)); assert.ok(!matches(U({ rooms: 5, floor: 4, number: '405' }), r))
  assert.ok(!matches(U({ rooms: 5, status: 'sold' }), r))
})

test('newPrice: сумма и цена — только в своей валюте; без цены процент не считается; цена за м² без площади — нет', () => {
  assert.equal(newPrice(U({ currency: 'AZN' }), normRule({ op: 'add', value: 1000, currency: 'USD' })), null)
  assert.equal(newPrice(U(), normRule({ op: 'add', value: 1000, currency: 'USD', round: 1 })), 101000)
  assert.equal(newPrice(U({ price: null }), normRule({ op: 'pct', value: 5 })), null)
  assert.equal(newPrice(U({ price: null }), normRule({ op: 'set', value: 90000, currency: 'USD', round: 1 })), 90000)
  assert.equal(newPrice(U({ area: 0 }), normRule({ op: 'm2', value: 2000, currency: 'USD' })), null)
  assert.equal(newPrice(U(), normRule({ op: 'm2', value: 2100, currency: 'USD', round: 1000 })), 105000)
  assert.equal(newPrice(U(), normRule({ op: 'pct', value: -50, round: 1 })), 50000)
})

test('шаг по этажам: +1% за этаж выше базового', () => {
  const r = normRule({ op: 'floor_step', value: 1, base_floor: 3, round: 1 })
  assert.equal(newPrice(U({ floor: 5 }), r), 102000)
  assert.equal(newPrice(U({ floor: 3 }), r), null)
  assert.equal(newPrice(U({ floor: 1 }), r), null)
})

test('шаг по этажам: на базовом этаже и ниже «некруглая» цена не округляется', () => {
  const r = normRule({ op: 'floor_step', value: 1, base_floor: 3, round: 1000 })
  assert.equal(newPrice(U({ floor: 3, price: 150499 }), r), null)
  assert.equal(newPrice(U({ floor: 1, price: 150499 }), r), null)
  assert.equal(computeItems([U({ floor: 2, price: 150499 })], r).length, 0)
})

const ctx = { blocks: ['A', 'Block A · Marina', 'B'], layouts: ['A1'] }
test('parseChess: заголовки RU/EN/DE, номер как в файле, bare без префикса; пустая ячейка не меняет поле', () => {
  for (const head of [['Корпус', 'Номер', 'Цена'], ['Building', 'Unit', 'Price'], ['Gebäude', 'Nummer', 'Preis']]) {
    const p = parseChess([head, ['A', 'A-101', '150 000'], ['B', '101', '']], ctx)
    assert.equal(p.error, ''); assert.deepEqual(p.errors, [])
    assert.deepEqual(p.rows.map((r) => [r.block, r.number, (r as { bare?: string }).bare, r.set]), [['A', 'A-101', '101', { price_list: 150000 }], ['B', '101', '101', {}]])
  }
})

test('parseChess: номер строки ошибки — как в Excel, с учётом пустых строк', () => {
  const p = parseChess([['Корпус', 'Номер', 'Тип'], ['A', '1', ''], ['', '', ''], ['A', '2', 'дворец'], ['Z', '3', '']], ctx)
  assert.deepEqual(p.errors.map((e) => e.split(':')[0]), ['4', '5'])
})

test('parseChess: цена и площадь 0 — ошибка', () => {
  const p = parseChess([['Корпус', 'Номер', 'Цена', 'Площадь'], ['A', '1', '0', ''], ['A', '2', '', '0']], ctx)
  assert.equal(p.errors.length, 2, JSON.stringify(p))
})
