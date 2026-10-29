// Ориентация квартир Premium Residence по поэтажным планам Profitbase (прочитаны 29.10.2026).
// Запуск: DATABASE_URL=… node scripts/premium-orient.mjs [--apply]. Без --apply только проверка и сводка.
// Вид пишется в units.view_side (каталог, сайты), стояки типового этажа — в portal.riser_info.
import pg from 'pg'
const APPLY = process.argv.includes('--apply')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()

const riser = (n) => { const m = n.match(/^(\d+)(.*)$/); return m && m[1].length >= 3 ? m[1].slice(-2) + m[2] : n }
const norm = (r) => r.replace(/^(\d\d)[a-d]/, '$1x')          // 17d, 17c, 03a, 01b → 17x / 03x / 01x
const R = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, '0'))

// Сторона по раскладке этажа: top / bottom — длинные фасады, L/R — торцы (L = море, R = улица)
const LAYOUT = {
  CD_typ: { top: [...R(17, 20), '17x', '19x', ...R(1, 5)], bottom: [...R(8, 14), '08x'], TL: ['16'], BL: ['15'], TR: ['06'], BR: ['07'] },
  CD_low: { top: [...R(18, 23), ...R(1, 5)], bottom: R(8, 15), TL: ['17'], BL: ['16'], TR: ['06'], BR: ['07'] },
  C_1:    { top: [...R(16, 20), ...R(1, 5)], bottom: R(8, 15), TL: [], BL: [], TR: ['06'], BR: ['07'] },
  CD_12:  { top: ['13x/1', ...R(14, 17), '16x', ...R(1, 5)], bottom: ['06', '06x', ...R(7, 12)], TL: ['13x'], BL: ['13'], TR: ['05x'], BR: ['05x/1'] },
  AB_typ: { top: [...R(6, 12), '12x'], bottom: [...R(15, 20), '01', '01x', '02', '03', '03x'], TL: ['05'], BL: ['04'], TR: ['13'], BR: ['14'] },
  AB_2:   { top: R(8, 15), bottom: [...R(18, 23), ...R(1, 5)], TL: ['07'], BL: ['06'], TR: ['16'], BR: ['17'] },
  AB_12:  { top: [...R(5, 11), '11x'], bottom: ['12x/1', ...R(13, 17), '01', '01x', '02', '03', '04'], TL: ['04x/1'], BL: ['04x'], TR: ['12'], BR: ['12x'] },
}
const layoutOf = (blk, floor) => {
  if (blk === 'A' || blk === 'B') return floor === 2 ? 'AB_2' : floor === 12 ? 'AB_12' : 'AB_typ'
  if (floor === 12) return 'CD_12'
  if (floor === 1 && blk === 'C') return 'C_1'
  return floor <= 2 ? 'CD_low' : 'CD_typ'
}
// Вид: длинный фасад C/D — море сверху, бассейн снизу; A/B — бассейн сверху, дорога снизу.
// Угловые: левый торец смотрит на море → «на море»; правые углы — по длинному фасаду (море / двор), а у A/B снизу — на улицу.
const SIDE = { CD: { top: 'sea', bottom: 'yard' }, AB: { top: 'yard', bottom: 'city' } }
function view(blk, floor, number) {
  const L = LAYOUT[layoutOf(blk, floor)], pos = norm(riser(number)), g = blk === 'A' || blk === 'B' ? 'AB' : 'CD'
  for (const k of ['top', 'bottom', 'TL', 'BL', 'TR', 'BR']) if (L[k].includes(pos)) {
    const v = k === 'TL' || k === 'BL' ? 'sea' : SIDE[g][k === 'TR' ? 'top' : k === 'BR' ? 'bottom' : k]
    return { v, where: k }
  }
  return null
}

const units = (await c.query(`select u.id, u.number, u.floor, u.view_side, u.building_id, substr(b.name,7,1) blk from units u join buildings b on b.id = u.building_id
  join projects p on p.id = b.project_id where p.slug ilike '%premium%' order by blk, floor, number`)).rows
const out = [], miss = [], stat = {}
for (const u of units) {
  const r = view(u.blk, u.floor, u.number)
  if (!r) { miss.push(`${u.blk} ${u.number}`); continue }
  out.push({ ...u, nv: r.v, where: r.where })
  const k = `${u.blk} ${layoutOf(u.blk, u.floor)}`; stat[k] ||= {}; stat[k][r.where] = (stat[k][r.where] || 0) + 1
}
// Проверка: на каждом этаже все позиции разные и квартир столько, сколько в базе
const dup = {}
for (const u of out) { const k = `${u.blk}-${u.floor}-${norm(riser(u.number))}`; dup[k] = (dup[k] || 0) + 1 }
console.log('units', units.length, 'classified', out.length, 'missing', miss.length, miss.join(' '))
console.log('dup positions', Object.entries(dup).filter(([, n]) => n > 1))
console.table(stat)
const views = {}; for (const u of out) { const k = u.blk + ' ' + u.nv; views[k] = (views[k] || 0) + 1 }; console.log(views)
const change = out.filter((u) => u.view_side !== u.nv); console.log('to change', change.length)

// Стояки типового этажа (3–11) для вкладки «Ориентация»
const typ = {}
for (const u of out) if (u.floor >= 3 && u.floor <= 11) { const k = u.building_id + '|' + riser(u.number); (typ[k] ||= new Set()).add(u.nv) }
const conflict = Object.entries(typ).filter(([, s]) => s.size > 1); console.log('riser conflicts on typical floors', conflict.length)

if (APPLY) {
  await c.query('begin')
  for (const [k, s] of Object.entries(typ)) { const [bid, r] = k.split('|')
    await c.query(`insert into portal.riser_info (building_id, riser, view_side) values ($1,$2,$3) on conflict (building_id, riser) do update set view_side = $3`, [bid, r, [...s][0]]) }
  for (const v of ['sea', 'yard', 'city']) {
    const ids = change.filter((u) => u.nv === v).map((u) => u.id)
    if (ids.length) await c.query('update units set view_side = $2 where id = any($1)', [ids, v])
  }
  await c.query('commit'); console.log('applied')
}
await c.end()
