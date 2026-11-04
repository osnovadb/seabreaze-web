// Общий фильтр каталога и сохранённых поисков (lib/unitMatch.mjs) и разбор меток окружения (lib/surround.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normFilter, matchUnit } from '../../lib/unitMatch.mjs'
import { cleanMarks, nearMarks } from '../../lib/surround'

const U = (o: Record<string, unknown> = {}) => ({ project_id: 'p', building_id: 'b', unit_type: '2br', rooms: 3, usd: 300000, area: 80, floor: 5, view_side: 'sea', plot_area: 0, ext_area: 12, is_corner: false, promo: false, ...o })

test('старый сохранённый поиск {rooms: число, max: тыс. $, outdoor} читается', () => {
  const nf = normFilter({ project: 'p', rooms: 3, max: 350, outdoor: 't' })
  assert.deepEqual([nf.rooms, nf.pmax, nf.outdoor], [[3], 350000, 't'])
  assert.ok(matchUnit(U(), nf))
  assert.ok(!matchUnit(U({ usd: 351000 }), nf))
  assert.ok(!matchUnit(U({ ext_area: 0 }), nf))
  assert.deepEqual(normFilter({ project: 'p', rooms: null, max: null, outdoor: null }).rooms, [])
})

test('4 = 4 комнаты и больше; повтор через запятую и массивом одинаков', () => {
  const nf = normFilter({ rooms: '1,4' })
  assert.ok(matchUnit(U({ rooms: 1 }), nf) && matchUnit(U({ rooms: 4 }), nf) && matchUnit(U({ rooms: 7 }), nf))
  assert.ok(!matchUnit(U({ rooms: 3 }), nf) && !matchUnit(U({ rooms: null }), nf))
  assert.deepEqual(normFilter({ rooms: ['1', '4'], types: ['2br', '3br'] }), normFilter({ rooms: '1,4', types: '2br,3br' }))
})

test('цена: без цены не проходит ни «от», ни «до»; мусор в полях игнорируется', () => {
  assert.ok(!matchUnit(U({ usd: null }), normFilter({ pmax: 500000 })))
  assert.ok(!matchUnit(U({ usd: null }), normFilter({ pmin: 1 })))
  const nf = normFilter({ pmin: 'abc', amin: '', fmax: 'x', outdoor: 'z', rooms: '0,10,abc' })
  assert.deepEqual([nf.pmin, nf.amin, nf.fmax, nf.outdoor, nf.rooms], [null, null, null, null, []])
  assert.ok(matchUnit(U({ usd: null }), nf))
})

test('диапазоны включают границы; угловая и акция', () => {
  const nf = normFilter({ pmin: 300000, pmax: 300000, amin: 80, amax: 80, fmin: 5, fmax: 5 })
  assert.ok(matchUnit(U(), nf))
  assert.ok(!matchUnit(U(), normFilter({ corner: true })) && matchUnit(U({ is_corner: true }), normFilter({ corner: true })))
  assert.ok(!matchUnit(U(), normFilter({ promo: true })) && matchUnit(U({ promo: true }), normFilter({ promo: true })))
})

test('cleanMarks: только известные виды, координаты 0..1, не больше 60, подпись до 40', () => {
  const m = cleanMarks([{ kind: 'sea', x: 0, y: 1 }, { kind: 'zzz', x: 0.5, y: 0.5 }, { kind: 'sea', x: 1.01, y: 0 }, { kind: 'sea', x: NaN, y: 0 }, { kind: 'pool', x: 0.123456, y: 0.5, label: ' ' + 'a'.repeat(50) }, null])
  assert.deepEqual(m, [{ kind: 'sea', x: 0, y: 1 }, { kind: 'pool', x: 0.1235, y: 0.5, label: 'a'.repeat(40) }])
  assert.equal(cleanMarks(Array.from({ length: 80 }, () => ({ kind: 'sea', x: 0.5, y: 0.5 }))).length, 60)
  assert.deepEqual(cleanMarks('x'), [])
})

test('cleanMarks не принимает имена из прототипа объекта', () => {
  assert.deepEqual(cleanMarks([{ kind: 'constructor', x: 0.5, y: 0.5 }, { kind: 'toString', x: 0.5, y: 0.5 }, { kind: '__proto__', x: 0.5, y: 0.5 }]), [])
})

test('nearMarks: ближе 0,28, ближние первыми, не больше трёх', () => {
  const ms = [{ kind: 'sea', x: 0.5, y: 0.9 }, { kind: 'pool', x: 0.5, y: 0.6 }, { kind: 'road', x: 0.5, y: 0.77 }, { kind: 'park', x: 0.58, y: 0.5 }, { kind: 'gym', x: 0.45, y: 0.5 }]
  assert.deepEqual(nearMarks(ms, [0.5, 0.5]).map((m) => m.kind), ['gym', 'park', 'pool'])
  assert.deepEqual(nearMarks(ms, [0.5, 0.5], 10).map((m) => m.kind), ['gym', 'park', 'pool', 'road'])
  assert.deepEqual(nearMarks(ms, null), [])
})
