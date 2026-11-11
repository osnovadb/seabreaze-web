// Импорт раскладки проекта с сайта партнёра Treva (treva.realestate): их открытый API отдаёт выгрузку из Profitbase застройщика —
// номер, корпус, этаж, площади, цены AZN/USD/EUR, статус и поквартирный план. Источник `treva:<проект>` (kind manual), повторный запуск
// обновляет статус и цену по external_id (id квартиры в Profitbase), новые квартиры добавляет, планы докачивает.
// На стенде: cd /opt/ge-portal22/src && set -a && . /opt/ge-portal22/portal.env && set +a && node scripts/treva-import.mjs [--replace-test] [--dry]
//   --replace-test  первый прогон: убрать тестовые квартиры проекта (source 'test'); те, на которые ссылаются брони, сделки и подборки,
//                   переносятся в корпус «ТЕСТ · QA» и скрываются от партнёров
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

const CATEGORY = 'brabus-island-baku' // categorySlug в API Treva
const PROJECT = 'brabus-island-baku' // наш projects.slug
const SOURCE = 'treva:brabus'
const API = 'https://api.treva.realestate'
const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'GetsEstate catalog import (partner feed)', Origin: 'https://treva.realestate' } })
    if (r.ok) return r
    await sleep(2000 * (i + 1))
  }
  throw new Error(`${url}: не отвечает`)
}

const units = []
for (let page = 1; ; page++) {
  const d = await (await get(`${API}/api/v1/unit-layouts?page=${page}&limit=100&archived=false&currency=USD&categorySlug=${CATEGORY}`)).json()
  units.push(...d.data)
  if (page >= d.pagination.totalPages) break
  await sleep(1000)
}
console.log(`Treva: ${units.length} объектов`)

const TYPE = { 0: 'studio', 1: '1br', 2: '2br', 3: '3br', 4: '4br' }
const unitType = (x) => (x.realEstateType === 'Villa' ? 'villa' : TYPE[x.rooms] || null)
const number = (x) => (x.realEstateType === 'Villa' ? `V-${x.unitCode}` : x.unitCode)
const FINISH = { renovated: 'turnkey' }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const st = { added: 0, updated: 0, same: 0, plans: 0, moved: 0, removed: 0, skipped: 0 }
try {
  await db.query('begin')
  await db.query(`select set_config('app.sync_source', $1, true), set_config('app.skip_refresh', 'on', true)`, [SOURCE])
  const [proj] = await q('select id, developer_id from projects where slug = $1', [PROJECT])
  if (!proj) throw new Error(`нет проекта ${PROJECT}`)
  await q(`insert into sources (id, kind, name, developer_id, notes) values ($1, 'manual', $2, $3, $4) on conflict (id) do nothing`, [SOURCE,
    'BRABUS Island — сайт партнёра Treva (Profitbase застройщика, проект 56881)', proj.developer_id,
    'API treva.realestate /api/v1/unit-layouts: номер, этаж, площади, цена USD, статус, поквартирный план. Скрипт scripts/treva-import.mjs. До получения ключа Profitbase от застройщика.'])

  // Корпуса: башня в Profitbase одна, но у застройщика (листы планировок, номера A-…/D-…) это блоки A–D — корпус по подъезду;
  // виллы — по названию дома. Срок сдачи берём наш (в выгрузке 2026 — для всех домов одинаково)
  const bname = (x) => (x.realEstateType === 'Villa' || !x.entrance ? x.house.title : `Block ${x.entrance}`)
  const delivery = (await q('select max(delivery) d from buildings where project_id = $1', [proj.id]))[0].d
  const bld = {}
  for (const name of [...new Set(units.map(bname))].sort()) {
    const villa = units.some((x) => bname(x) === name && x.realEstateType === 'Villa')
    const floors = Math.max(...units.filter((x) => bname(x) === name).map((x) => x.floor || 0)) || null
    const [b] = await q(`insert into buildings (project_id, name, kind, floors_total, delivery, source_id, sort) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (project_id, name) do update set source_id = excluded.source_id, kind = excluded.kind, floors_total = coalesce(excluded.floors_total, buildings.floors_total) returning id`,
      [proj.id, name, villa ? 'villa_cluster' : 'block', villa ? null : floors, delivery, SOURCE, villa ? 9 : 0])
    bld[name] = b.id
  }

  if (args.has('--replace-test')) {
    const test = await q(`select u.id, u.number from units u where u.project_id = $1 and u.source_id = 'test'`, [proj.id])
    const used = new Set((await q(`select unit_id id from portal.bookings union select unit_id from portal.deals union select unit_id from portal.selection_items
      union select unit_id from portal.selection_variants union select unit_id from portal.calc_variants union select unit_id from portal.waitlist where unit_id is not null`)).map((r) => r.id))
    const keep = test.filter((t) => used.has(t.id))
    if (keep.length) {
      const [qa] = await q(`insert into buildings (project_id, name, kind, sort) values ($1, 'ТЕСТ · QA', 'block', 99) on conflict (project_id, name) do update set sort = 99 returning id`, [proj.id])
      await q('update units set building_id = $1 where id = any($2)', [qa.id, keep.map((t) => t.id)])
      await q(`insert into portal.unit_hidden (unit_id, note) select unnest($1::uuid[]), 'ТЕСТ: квартира из тестовой раскладки, на ней брони и сделки QA' on conflict do nothing`, [keep.map((t) => t.id)])
      st.moved = keep.length
    }
    const drop = test.filter((t) => !used.has(t.id)).map((t) => t.id)
    await q('delete from portal.unit_events where unit_id = any($1)', [drop])
    await q('delete from units where id = any($1)', [drop])
    st.removed = drop.length
    await q(`delete from buildings b where b.project_id = $1 and b.source_id is distinct from $2 and b.name <> 'ТЕСТ · QA' and not exists (select 1 from units u where u.building_id = b.id)`, [proj.id, SOURCE])
    await q(`delete from layouts l where l.project_id = $1 and l.source_id is distinct from $2 and not exists (select 1 from units u where u.layout_id = l.id)`, [proj.id, SOURCE])
  }

  const dir = process.env.UPLOADS_DIR
  for (const x of units) {
    const type = unitType(x)
    if (!type || !x.unitCode) { st.skipped++; continue }
    const no = number(x)
    // Поквартирный план — своя планировка на квартиру (в выгрузке у каждой квартиры свой лист)
    let [lay] = await q('select id, plan_file from layouts where project_id = $1 and code = $2', [proj.id, no])
    if (!lay) [lay] = await q(`insert into layouts (project_id, code, unit_type, name, bedrooms, internal_area_m2, external_area_m2, total_area_m2, source_id, external_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, plan_file`, [proj.id, no, type, x.unitTypeOption?.titleRu || null, x.rooms, x.internalArea, x.balconyArea, x.totalArea, SOURCE, x.externalId])
    const img = x.mainImage?.url || x.gallery?.[0]?.url // mainImage — лист застройщика 1414×2000, gallery — превью 495×700
    if (!lay.plan_file && img && dir && !DRY) {
      const buf = Buffer.from(await (await get(API + img)).arrayBuffer())
      const id = crypto.randomUUID(), ext = path.extname(img) || '.jpg'
      fs.writeFileSync(path.join(dir, id + ext), buf)
      await q(`insert into directus_files (id, storage, filename_disk, filename_download, title, type, filesize) values ($1,'local',$2,$3,$4,$5,$6)`,
        [id, id + ext, `BRABUS ${no}${ext}`, `BRABUS ${no}`, ext === '.png' ? 'image/png' : 'image/jpeg', buf.length])
      await q('update layouts set plan_file = $1 where id = $2', [id, lay.id])
      st.plans++
      await sleep(200)
    }
    const row = [proj.id, bld[bname(x)], lay.id, no, x.realEstateType === 'Villa' ? null : x.floor, type, x.rooms, x.totalArea, x.internalArea, x.balconyArea,
      x.status, x.prices.USD, SOURCE, x.externalId, x.status, JSON.stringify(x), FINISH[x.renovation] || null, x.updatedAt]
    const [prev] = await q('select status, price_list::float p from units where source_id = $1 and external_id = $2', [SOURCE, x.externalId])
    await q(`insert into units (project_id, building_id, layout_id, number, floor, unit_type, bedrooms, area_total_m2, area_internal_m2, area_external_m2,
        status, price_list, price_currency, source_id, external_id, external_status, raw, finish, source_updated_at, synced_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'USD',$13,$14,$15,$16,$17,$18, now())
      on conflict (source_id, external_id) do update set building_id = excluded.building_id, layout_id = excluded.layout_id, number = excluded.number, floor = excluded.floor,
        unit_type = excluded.unit_type, bedrooms = excluded.bedrooms, area_total_m2 = excluded.area_total_m2, area_internal_m2 = excluded.area_internal_m2,
        area_external_m2 = excluded.area_external_m2, external_status = excluded.external_status, raw = excluded.raw, finish = excluded.finish,
        source_updated_at = excluded.source_updated_at, synced_at = now(),
        status = case when units.locked_fields ? 'status' then units.status else excluded.status end,
        price_list = case when units.locked_fields ? 'price_list' then units.price_list else excluded.price_list end`, row)
    if (!prev) st.added++
    else if (prev.status !== x.status || prev.p !== x.prices.USD) st.updated++
    else st.same++
  }
  // Корпуса источника, в которых не осталось квартир (прежняя «BRABUS Tower» до разбивки на блоки)
  await q(`delete from buildings b where b.project_id = $1 and b.source_id = $2 and not exists (select 1 from units u where u.building_id = b.id)`, [proj.id, SOURCE])
  await q(`update sources set last_sync_at = now(), last_sync_status = 'ok' where id = $1`, [SOURCE])
  await db.query(`select set_config('app.skip_refresh', '', true)`)
  await q('select refresh_catalog()')
  await db.query(DRY ? 'rollback' : 'commit')
} catch (e) {
  await db.query('rollback')
  throw e
} finally {
  await db.end()
}
console.log(DRY ? '(пробный прогон, ничего не записано)' : '', st)
