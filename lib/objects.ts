'use server'
// Админка каталога: проекты, блоки, планировки, квартиры, планы оплаты и видимость для партнёров.
// Пишем прямо в таблицы каталога; триггеры каталога сами ведут историю цен, ставят замки ручных правок и пересобирают витрины сайтов.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, one, tx, audit } from './db'
import { requireCtx, type Ctx } from './auth'
import { t } from './i18n'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const num = (f: FormData, k: string) => { const v = s(f, k).replace(',', '.'); return v === '' ? null : Number(v) }
const slugify = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60)
const UNIT_TYPES = ['studio', '1br', '2br', '3br', '4br', 'duplex', 'penthouse', 'townhouse', 'villa', 'commercial', 'parking']
const UNIT_STATUSES = ['available', 'reserved', 'sold', 'unavailable']

// Объекты и планы оплаты правит владелец; цены и статусы квартир — ещё и офис в Баку (ТЗ, матрица прав)
async function owner() {
  const c = await requireCtx()
  if (c.user.role !== 'owner' || (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1')) throw new Error('forbidden')
  return c
}
async function unitsEditor() {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role) || (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1')) throw new Error('forbidden')
  return c
}
const log = (c: Ctx, action: string, entity: string, id: string, data?: unknown) => audit(c.real.id, action, entity, id, data, c.impersonating ? c.user.id : null)
// Ошибка базы (ограничение, тип) — сообщение в форме, а не падение страницы
function safe<A extends unknown[]>(fn: (...a: A) => Promise<any>) {
  return async (...a: A) => {
    try { return await fn(...a) } catch (e: any) {
      if (e?.digest?.startsWith?.('NEXT_REDIRECT') || e?.message === 'forbidden') throw e
      console.error('objects:', e?.message)
      return { error: 'Не удалось сохранить — проверьте данные (' + String(e?.message || '').slice(0, 120) + ')' }
    }
  }
}
const done = (pid: string) => { revalidatePath(`/admin/objects/${pid}`); revalidatePath('/admin/objects'); revalidatePath('/projects', 'layout') }

/* ── Проект ── */
export async function saveProject(_: unknown, f: FormData) {
  const c = await owner()
  const name = s(f, 'name')
  if (!name) return { error: t(c.lang, 'Нужно название') }
  let dev = s(f, 'developer')
  if (dev === 'new') {
    if (!s(f, 'developer_name')) return { error: t(c.lang, 'Укажите застройщика') }
    dev = (await one<{ id: string }>(`insert into developers (name, country) values ($1, 'AZ') returning id`, [s(f, 'developer_name')]))!.id
  }
  const status = ['planned', 'under_construction', 'completed'].includes(s(f, 'status')) ? s(f, 'status') : 'under_construction'
  const id = s(f, 'id')
  try {
    if (id) {
      await q(`update projects set name = $2, developer_id = $3, city = $4, location = $5, delivery = $6, status = $7, sort = $8 where id = $1`,
        [id, name, dev, s(f, 'city') || null, s(f, 'location') || null, s(f, 'delivery') || null, status, num(f, 'sort') ?? 0])
      await log(c, 'object.project_update', 'project', id)
      done(id)
      return { ok: true }
    }
    const slug = s(f, 'slug') || slugify(name)
    const p = await one<{ id: string }>(`insert into projects (developer_id, slug, name, status, delivery, city, location, sort, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,'manual') returning id`,
      [dev, slug, name, status, s(f, 'delivery') || null, s(f, 'city') || 'Баку', s(f, 'location') || null, num(f, 'sort') ?? 0])
    // Новый проект — черновик: партнёры и сайты его не видят, пока не откроете
    await q(`insert into portal.project_settings (project_id, sales_status, agent_markets) values ($1, 'draft', '{}') on conflict do nothing`, [p!.id])
    await log(c, 'object.project_create', 'project', p!.id, { name })
    redirect(`/admin/objects/${p!.id}`)
  } catch (e: any) {
    if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e
    return { error: t(c.lang, 'Такой адрес проекта уже есть') }
  }
}

/* ── Блоки ── */
export async function saveBuilding(_: unknown, f: FormData) {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (s(f, 'delete')) {
    const n = await one<{ n: number }>('select count(*)::int n from units where building_id = $1', [id])
    if (n!.n) return { error: t(c.lang, 'В блоке есть квартиры — сначала удалите или перенесите их') }
    await q('delete from buildings where id = $1 and project_id = $2', [id, pid])
    await log(c, 'object.building_delete', 'building', id); done(pid); return { ok: true }
  }
  if (!s(f, 'name')) return { error: t(c.lang, 'Нужно название') }
  const kind = ['block', 'tower', 'villa_cluster'].includes(s(f, 'kind')) ? s(f, 'kind') : 'block'
  try {
    if (id) await q(`update buildings set name = $2, external_id = $3, kind = $4, floors_total = $5, delivery = $6, sort = $7 where id = $1 and project_id = $8`,
      [id, s(f, 'name'), s(f, 'code') || null, kind, num(f, 'floors'), s(f, 'delivery') || null, num(f, 'sort') ?? 0, pid])
    else await q(`insert into buildings (project_id, name, external_id, kind, floors_total, delivery, sort, source_id) values ($1,$2,$3,$4,$5,$6,$7,'manual')`,
      [pid, s(f, 'name'), s(f, 'code') || null, kind, num(f, 'floors'), s(f, 'delivery') || null, num(f, 'sort') ?? 0])
  } catch {
    return { error: t(c.lang, 'Блок с таким названием или кодом уже есть') }
  }
  await log(c, id ? 'object.building_update' : 'object.building_create', 'project', pid, { name: s(f, 'name') }); done(pid)
  return { ok: true }
}

/* ── Планировки (+ загрузка плана в хранилище файлов каталога) ── */
async function storePlan(file: File) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  if (!['png', 'jpg', 'jpeg', 'webp', 'pdf'].includes(ext)) throw new Error('type')
  const id = crypto.randomUUID()
  const disk = `${id}.${ext}`
  await fs.writeFile(path.join(process.env.UPLOADS_DIR || './dev-uploads', disk), Buffer.from(await file.arrayBuffer()))
  await q(`insert into directus_files (id, storage, filename_disk, filename_download, title, type, filesize) values ($1,'local',$2,$3,$4,$5,$6)`,
    [id, disk, file.name, file.name.replace(/\.[^.]+$/, ''), file.type || 'image/png', file.size])
  return id
}
export async function saveLayout(_: unknown, f: FormData) {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (!s(f, 'code')) return { error: t(c.lang, 'Нужен код планировки') }
  const type = UNIT_TYPES.includes(s(f, 'unit_type')) ? s(f, 'unit_type') : '2br'
  let plan: string | null = null
  const file = f.get('plan') as File | null
  if (file && typeof file === 'object' && file.size > 0) {
    try { plan = await storePlan(file) } catch { return { error: t(c.lang, 'План — картинка PNG, JPG, WEBP или PDF до 5 МБ') } }
  }
  try {
    if (id) await q(`update layouts set code = $2, unit_type = $3, name = $4, bedrooms = $5, internal_area_m2 = $6, external_area_m2 = $7, total_area_m2 = $8, plan_file = coalesce($9, plan_file) where id = $1 and project_id = $10`,
      [id, s(f, 'code'), type, s(f, 'name') || null, num(f, 'bedrooms'), num(f, 'internal'), num(f, 'external'), num(f, 'total'), plan, pid])
    else await q(`insert into layouts (project_id, code, unit_type, name, bedrooms, internal_area_m2, external_area_m2, total_area_m2, plan_file, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')`,
      [pid, s(f, 'code'), type, s(f, 'name') || null, num(f, 'bedrooms'), num(f, 'internal'), num(f, 'external'), num(f, 'total'), plan])
  } catch {
    return { error: t(c.lang, 'Планировка с таким кодом уже есть') }
  }
  await log(c, id ? 'object.layout_update' : 'object.layout_create', 'project', pid, { code: s(f, 'code') }); done(pid)
  return { ok: true }
}

/* ── Квартиры ── */
// Правка одной квартиры. Цена и статус — офис или владелец; ручная правка у квартир из Profitbase и xlsx получает замок от синхронизации (триггер каталога).
export const saveUnit = safe(async (_: unknown, f: FormData) => {
  const c = await unitsEditor()
  const pid = s(f, 'project'), id = s(f, 'id')
  const status = UNIT_STATUSES.includes(s(f, 'status')) ? s(f, 'status') : 'available'
  const price = num(f, 'price'), cur = ['USD', 'AZN', 'EUR'].includes(s(f, 'currency')) ? s(f, 'currency') : 'USD'
  if (price != null && (Number.isNaN(price) || price < 0)) return { error: t(c.lang, 'Проверьте цену') }
  if (c.user.role === 'office') {
    await q(`update units set price_list = $2, price_currency = $3, status = $4 where id = $1 and project_id = $5`, [id, price, cur, status, pid])
  } else {
    const lay = s(f, 'layout') ? await one<{ unit_type: string; bedrooms: number | null; total_area_m2: number | null; internal_area_m2: number | null; external_area_m2: number | null }>('select unit_type, bedrooms, total_area_m2, internal_area_m2, external_area_m2 from layouts where id = $1', [s(f, 'layout')]) : null
    const vals = [s(f, 'number'), num(f, 'floor'), s(f, 'building') || null, s(f, 'layout') || null, lay?.unit_type || (UNIT_TYPES.includes(s(f, 'unit_type')) ? s(f, 'unit_type') : '2br'),
      lay?.bedrooms ?? num(f, 'bedrooms'), num(f, 'area') ?? lay?.total_area_m2 ?? null, lay?.internal_area_m2 ?? null, num(f, 'ext_area') ?? lay?.external_area_m2 ?? null, num(f, 'plot_area'), price, cur, status, s(f, 'published') !== '0']
    if (!vals[0]) return { error: t(c.lang, 'Нужен номер квартиры') }
    if (id) await q(`update units set number = $2, floor = $3, building_id = $4, layout_id = $5, unit_type = $6, bedrooms = $7, area_total_m2 = $8, area_internal_m2 = $9, area_external_m2 = $10, plot_area_m2 = $11,
        price_list = $12, price_currency = $13, status = $14, published = $15 where id = $1 and project_id = $16`, [id, ...vals, pid])
    else await q(`insert into units (number, floor, building_id, layout_id, unit_type, bedrooms, area_total_m2, area_internal_m2, area_external_m2, plot_area_m2, price_list, price_currency, status, published, project_id, source_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual')`, [...vals, pid])
  }
  // Скрыть от партнёров — отдельная отметка портала, на сайты не влияет
  if (id && f.has('hidden_set')) {
    if (s(f, 'hidden') === '1') await q(`insert into portal.unit_hidden (unit_id, created_by) values ($1,$2) on conflict do nothing`, [id, c.user.id])
    else await q('delete from portal.unit_hidden where unit_id = $1', [id])
  }
  await log(c, id ? 'object.unit_update' : 'object.unit_create', 'unit', id || s(f, 'number'), { price, status }); done(pid)
  return { ok: true }
})
// Массовое создание: этажи «с–по» × позиции на этаже; номер = этаж + позиция (8 + 06 → 806), как у Premium. Существующие номера пропускаем.
export const generateUnits = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), bid = s(f, 'building')
  const from = num(f, 'floor_from'), to = num(f, 'floor_to')
  const positions = s(f, 'positions').split(/[\s,;]+/).filter(Boolean)
  if (!bid || from == null || to == null || to < from || !positions.length) return { error: t(c.lang, 'Укажите блок, этажи и позиции') }
  if ((to - from + 1) * positions.length > 600) return { error: t(c.lang, 'За раз — не больше 600 квартир') }
  const lay = s(f, 'layout') ? await one<{ id: string; unit_type: string; bedrooms: number | null; total_area_m2: number | null; external_area_m2: number | null }>('select id, unit_type, bedrooms, total_area_m2, external_area_m2 from layouts where id = $1 and project_id = $2', [s(f, 'layout'), pid]) : null
  const price = num(f, 'price'), cur = ['USD', 'AZN', 'EUR'].includes(s(f, 'currency')) ? s(f, 'currency') : 'USD'
  const exist = new Set((await q<{ number: string }>('select number from units where building_id = $1', [bid])).map((r) => r.number))
  let made = 0
  await tx(async (db) => {
    await db.query(`select set_config('app.skip_refresh', 'on', true)`)
    for (let fl = from; fl <= to; fl++) for (const pos of positions) {
      const number = `${fl}${pos}`
      if (exist.has(number)) continue
      await db.query(`insert into units (project_id, building_id, layout_id, number, floor, unit_type, bedrooms, area_total_m2, area_external_m2, price_list, price_currency, status, source_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual')`, [pid, bid, lay?.id || null, number, fl, lay?.unit_type || '2br', lay?.bedrooms ?? null, lay?.total_area_m2 ?? null, lay?.external_area_m2 ?? null, price, cur, price ? 'available' : 'unavailable'])
      made++
    }
    await db.query(`select set_config('app.skip_refresh', '', true)`)
    await db.query('select refresh_catalog()')
  })
  await log(c, 'object.units_generate', 'project', pid, { building: bid, made }); done(pid)
  return { ok: true, made }
})
// Изменение цен свободных квартир блока на процент (повышение прайса застройщиком) или удаление пустых квартир
export const bulkUnits = safe(async (_: unknown, f: FormData) => {
  const c = await unitsEditor()
  const pid = s(f, 'project'), bid = s(f, 'building')
  const pctv = num(f, 'pct')
  if (pctv == null || Number.isNaN(pctv) || Math.abs(pctv) > 50) return { error: t(c.lang, 'Процент — от −50 до 50') }
  const r = await q(`update units set price_list = round(price_list * (1 + $3 / 100.0)) where project_id = $1 and ($2 = '' or building_id::text = $2) and status = 'available' and price_list is not null returning id`, [pid, bid, pctv])
  await log(c, 'object.units_price_pct', 'project', pid, { building: bid || null, pct: pctv, n: r.length }); done(pid)
  return { ok: true, made: r.length }
})

/* ── Планы оплаты (каталог: их же видят сайты) ── */
export const savePlan = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (s(f, 'delete')) { await q('delete from payment_plans where id = $1 and project_id = $2', [id, pid]); await log(c, 'object.plan_delete', 'project', pid); done(pid); return { ok: true } }
  if (!s(f, 'name')) return { error: t(c.lang, 'Нужно название') }
  const full = s(f, 'kind') === 'full'
  const down = full ? 100 : num(f, 'down'), months = full ? 0 : num(f, 'months')
  if (!full && (down == null || months == null || down <= 0 || down >= 100 || months <= 0)) return { error: t(c.lang, 'Для рассрочки нужны первый взнос (меньше 100%) и срок в месяцах') }
  const vals = [s(f, 'name'), s(f, 'building') || null, down, months, full ? num(f, 'discount') : null, s(f, 'valid_from') || null, s(f, 'valid_to') || null, s(f, 'note') || null, num(f, 'sort') ?? 0]
  if (id) await q(`update payment_plans set name = $2, building_id = $3, down_payment_pct = $4, months = $5, full_payment_discount_pct = $6, valid_from = $7, valid_to = $8, source_note = $9, sort = $10, verified = true where id = $1 and project_id = $11`, [id, ...vals, pid])
  else await q(`insert into payment_plans (name, building_id, down_payment_pct, months, full_payment_discount_pct, valid_from, valid_to, source_note, sort, project_id, verified) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`, [...vals, pid])
  await log(c, id ? 'object.plan_update' : 'object.plan_create', 'project', pid, { name: s(f, 'name') }); done(pid)
  return { ok: true }
})

/* ── Видимость ── */
export const saveAccess = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project')
  const st = ['draft', 'sales', 'stop', 'closed'].includes(s(f, 'sales_status')) ? s(f, 'sales_status') : 'draft'
  const markets = ['DE', 'IL', 'GLOBAL'].filter((m) => f.get('m_' + m))
  // Ссылка «На сайте» — своя для партнёров каждого рынка
  const urls: Record<string, string> = {}
  for (const m of ['DE', 'IL', 'GLOBAL']) if (/^https?:\/\//.test(s(f, 'url_' + m))) urls[m] = s(f, 'url_' + m)
  await q(`insert into portal.project_settings (project_id, sales_status, agent_markets, site_urls, updated_at) values ($1,$2,$3,$4, now())
    on conflict (project_id) do update set sales_status = $2, agent_markets = $3, site_urls = $4, updated_at = now()`, [pid, st, markets, JSON.stringify(urls)])
  // Сайты рынков — каталог (project_markets): то, что видят покупатели
  for (const m of ['dach', 'il']) {
    const on = !!f.get('site_' + m)
    await q(`insert into project_markets (project_id, market_id, visible) values ($1,$2,$3) on conflict (project_id, market_id) do update set visible = $3`, [pid, m, on])
  }
  await log(c, 'object.access', 'project', pid, { sales_status: st, markets }); done(pid)
  return { ok: true }
})
export async function saveException(f: FormData) {
  const c = await owner()
  const pid = s(f, 'project')
  if (s(f, 'delete')) await q('delete from portal.project_exceptions where id = $1 and project_id = $2', [s(f, 'delete'), pid])
  else {
    const [kind, id] = s(f, 'who').split(':')
    if (!id) return
    await q(`insert into portal.project_exceptions (project_id, agency_id, user_id, allow, note) values ($1,$2,$3,$4,$5)`, [pid, kind === 'agency' ? id : null, kind === 'user' ? id : null, s(f, 'allow') === '1', s(f, 'note') || null])
  }
  await log(c, 'object.exception', 'project', pid, { who: s(f, 'who'), allow: s(f, 'allow'), del: s(f, 'delete') || undefined }); done(pid)
}
