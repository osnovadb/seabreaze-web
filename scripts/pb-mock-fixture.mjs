// Фикстура заглушки Profitbase из нашего проекта: node scripts/pb-mock-fixture.mjs <slug> <out.json>
// id помещений = 900000 + порядковый номер; статусы — как в Profitbase (базовые и «Бронь GetsEstate», «Продано через GetsEstate»).
import fs from 'node:fs'
import pg from 'pg'
const [slug, out] = process.argv.slice(2)
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || env.DATABASE_URL }); await db.connect()
const p = (await db.query('select id, name from projects where slug = $1', [slug])).rows[0]
const bs = (await db.query('select id, name, external_id from buildings where project_id = $1 order by sort, name', [p.id])).rows
const us = (await db.query(`select u.*, u.area_total_m2::float area, u.price_list::float price from units u where project_id = $1 order by building_id, floor, number`, [p.id])).rows
const ST = { available: 'AVAILABLE', reserved: 'BOOKED', sold: 'SOLD', unavailable: 'UNAVAILABLE' }
const fx = {
  projects: [{ id: 7001, title: p.name, type: 'complex', currency: 'USD' }],
  houses: bs.map((b, i) => ({ id: 8001 + i, projectId: 7001, title: b.name })),
  statuses: [{ id: '501', name: 'Бронь GetsEstate', baseStatus: 'BOOKED', alias: 'ge_booking' }, { id: '502', name: 'Продано через GetsEstate', baseStatus: 'SOLD', alias: 'ge_sold' }],
  properties: us.map((u, i) => ({ id: 900001 + i, house_id: 8001 + bs.findIndex((b) => b.id === u.building_id), projectId: 7001, number: u.number, floor: u.floor, rooms_amount: Math.max(1, (u.bedrooms || 1)), studio: u.unit_type === 'studio',
    propertyType: 'property', typePurpose: 'residential', area: { area_total: u.area }, price: { value: u.price, prevValue: u.price }, status: ST[u.status] || 'UNAVAILABLE', customStatusId: null, attributes: { window_view: u.view_side || '', code: '' } })),
  floors: {},
}
fs.writeFileSync(out, JSON.stringify(fx, null, 1)); console.log(out, fx.properties.length, 'properties'); await db.end()
