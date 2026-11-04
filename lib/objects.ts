'use server'
// Админка каталога: проекты, блоки, планировки, квартиры, планы оплаты и видимость для партнёров.
// Пишем прямо в таблицы каталога; триггеры каталога сами ведут историю цен, ставят замки ручных правок и пересобирают витрины сайтов.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { storeFile, isFile } from './files'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, one, tx, audit, notify as notifyUser } from './db'
import { requireCtx, type Ctx } from './auth'
import { t } from './i18n'
import { autoPost, dropAutoPost } from './posts'
import { asActor } from './unitEvents'
import { UNIT_TYPES, riser } from './catalog'
import { readXlsx } from './xlsx'
import { parseChess, bareNo } from './chessImport'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const num = (f: FormData, k: string) => { const v = s(f, k).replace(',', '.'); return v === '' ? null : Number(v) }
const slugify = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60)
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
      // Обложка для списка проектов: картинка до 25 МБ; «убрать» — вернуть картинку по умолчанию
      const cover = f.get('cover')
      if (isFile(cover)) {
        // gif, heic и прочее — понятная ошибка, а не общий catch про адрес проекта
        if (!/^image\/(jpeg|png|webp)$/.test(cover.type) || !/\.(jpe?g|png|webp)$/i.test(cover.name)) return { error: t(c.lang, 'Нужна картинка: JPG, PNG или WEBP') }
        if (cover.size > 25 * 1024 * 1024) return { error: t(c.lang, 'Файл больше 25 МБ') }
        const fid = await storeFile(cover, c.user.id, { exts: ['jpg', 'jpeg', 'png', 'webp'] })
        await q(`insert into portal.project_settings (project_id, cover_file_id) values ($1,$2) on conflict (project_id) do update set cover_file_id = $2`, [id, fid])
      } else if (s(f, 'cover_drop')) await q('update portal.project_settings set cover_file_id = null where project_id = $1', [id])
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
// Скрыть от партнёров (квота, придержать): отметка портала, на сайты не влияет. М12: их места в листе ожидания закрываются с уведомлением.
async function hideUnits(ids: string[], by: string) {
  for (const id of ids) {
    await q(`insert into portal.unit_hidden (unit_id, created_by) values ($1,$2) on conflict do nothing`, [id, by])
    const gone = await q<{ id: string; user_id: string; unit: string }>(`update portal.waitlist w set active = false from portal.users us, units u join buildings b on b.id = u.building_id
      where w.unit_id = $1 and w.active and us.id = w.user_id and us.role in ('agent','agency_head') and u.id = w.unit_id
      returning w.id, w.user_id, portal.unit_no(b.external_id, u.number) unit`, [id])
    for (const g of gone) await notifyUser(g.user_id, 'waitlist', 'Квартира {u} снята с продажи для партнёров — вы убраны из листа ожидания', '/waitlist', { u: g.unit })
  }
}
// Быстрая правка из панели шахматки: только цена, валюта и статус (офис или владелец), от имени пользователя
export const quickUnit = safe(async (_: unknown, f: FormData) => {
  const c = await unitsEditor()
  const id = s(f, 'id')
  const price = num(f, 'price'), cur = ['USD', 'AZN', 'EUR'].includes(s(f, 'currency')) ? s(f, 'currency') : null
  const status = UNIT_STATUSES.includes(s(f, 'status')) ? s(f, 'status') : null
  if (price != null && (Number.isNaN(price) || price <= 0)) return { error: t(c.lang, 'Проверьте цену') }
  const u = await one<{ project_id: string }>('select project_id from units where id = $1', [id])
  if (!u || !cur || !status) return { error: t(c.lang, 'Проверьте данные') }
  await asActor(c.user.id, 'portal', (db) => db.query('update units set price_list = $2, price_currency = $3, status = $4 where id = $1', [id, price, cur, status]))
  await log(c, 'object.unit_quick', 'unit', id, { price, cur, status }); done(u.project_id)
  return { ok: true }
})
// Массово из шахматки: статус (офис или владелец) и «скрыть от партнёров» (владелец)
const uuids = (f: FormData) => f.getAll('units').map(String).filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)).slice(0, 500)
export async function bulkStatus(f: FormData) {
  const c = await unitsEditor()
  const pid = s(f, 'project'), st = s(f, 'status'), ids = uuids(f)
  if (!UNIT_STATUSES.includes(st) || !ids.length) return
  const r = await asActor(c.user.id, 'portal', (db) => db.query('update units set status = $3 where project_id::text = $1 and id = any($2) and status <> $3', [pid, ids, st]))
  await log(c, 'object.units_status', 'project', pid, { status: st, n: r.rowCount }); done(pid)
}
export async function bulkHide(f: FormData) {
  const c = await owner()
  const pid = s(f, 'project'), ids = (await q<{ id: string }>('select id from units where project_id::text = $1 and id = any($2)', [pid, uuids(f)])).map((r) => r.id)
  if (!ids.length) return
  if (s(f, 'hidden') === '1') await hideUnits(ids, c.user.id)
  else await q('delete from portal.unit_hidden where unit_id = any($1)', [ids])
  await log(c, 'object.units_hidden', 'project', pid, { hidden: s(f, 'hidden') === '1', n: ids.length }); done(pid); revalidatePath('/projects', 'layout')
}
// Правка одной квартиры. Цена и статус — офис или владелец; ручная правка у квартир из Profitbase и xlsx получает замок от синхронизации (триггер каталога).
export const saveUnit = safe(async (_: unknown, f: FormData) => {
  const c = await unitsEditor()
  const pid = s(f, 'project'), id = s(f, 'id')
  const status = UNIT_STATUSES.includes(s(f, 'status')) ? s(f, 'status') : 'available'
  const price = num(f, 'price'), cur = ['USD', 'AZN', 'EUR'].includes(s(f, 'currency')) ? s(f, 'currency') : 'USD'
  if (price != null && (Number.isNaN(price) || price < 0)) return { error: t(c.lang, 'Проверьте цену') }
  // Правка — от имени пользователя: журнал квартиры запишет автора (lib/unitEvents.ts)
  const err = await asActor(c.user.id, 'portal', async (db) => {
  if (c.user.role === 'office') {
    await db.query(`update units set price_list = $2, price_currency = $3, status = $4 where id = $1 and project_id = $5`, [id, price, cur, status, pid])
  } else {
    const lay = s(f, 'layout') ? (await db.query<{ unit_type: string; bedrooms: number | null; total_area_m2: number | null; internal_area_m2: number | null; external_area_m2: number | null }>('select unit_type, bedrooms, total_area_m2, internal_area_m2, external_area_m2 from layouts where id = $1', [s(f, 'layout')])).rows[0] : null
    const vals = [s(f, 'number'), num(f, 'floor'), s(f, 'building') || null, s(f, 'layout') || null, lay?.unit_type || (UNIT_TYPES.includes(s(f, 'unit_type')) ? s(f, 'unit_type') : '2br'),
      lay?.bedrooms ?? num(f, 'bedrooms'), num(f, 'area') ?? lay?.total_area_m2 ?? null, lay?.internal_area_m2 ?? null, num(f, 'ext_area') ?? lay?.external_area_m2 ?? null, num(f, 'plot_area'), price, cur, status, s(f, 'published') !== '0']
    if (!vals[0]) return t(c.lang, 'Нужен номер квартиры')
    if (id) await db.query(`update units set number = $2, floor = $3, building_id = $4, layout_id = $5, unit_type = $6, bedrooms = $7, area_total_m2 = $8, area_internal_m2 = $9, area_external_m2 = $10, plot_area_m2 = $11,
        price_list = $12, price_currency = $13, status = $14, published = $15 where id = $1 and project_id = $16`, [id, ...vals, pid])
    else await db.query(`insert into units (number, floor, building_id, layout_id, unit_type, bedrooms, area_total_m2, area_internal_m2, area_external_m2, plot_area_m2, price_list, price_currency, status, published, project_id, source_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual')`, [...vals, pid])
  }
  })
  if (err) return { error: err }
  // Скрыть от партнёров — отдельная отметка портала, на сайты не влияет
  if (id && f.has('hidden_set')) {
    if (s(f, 'hidden') === '1') await hideUnits([id], c.user.id)
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
  const was = (await one<{ sales_status: string }>('select sales_status from portal.project_settings where project_id = $1', [pid]))?.sales_status
  const markets = ['DE', 'IL', 'GLOBAL'].filter((m) => f.get('m_' + m))
  // Ссылка «На сайте» — своя для партнёров каждого рынка
  const urls: Record<string, string> = {}
  for (const m of ['DE', 'IL', 'GLOBAL']) if (/^https?:\/\//.test(s(f, 'url_' + m))) urls[m] = s(f, 'url_' + m)
  await q(`insert into portal.project_settings (project_id, sales_status, agent_markets, site_urls, updated_at) values ($1,$2,$3,$4, now())
    on conflict (project_id) do update set sales_status = $2, agent_markets = $3, site_urls = $4, updated_at = now()`, [pid, st, markets, JSON.stringify(urls)])
  // Лента партнёров (М9): старт продаж — один раз на день
  if (st === 'sales' && was !== 'sales') { const pr = await one<{ name: string; slug: string }>('select name, slug from projects where id = $1', [pid]); await autoPost(`sales:${pid}:${new Date().toISOString().slice(0, 10)}`, 'Старт продаж: {p}', { p: pr?.name || '' }, pid, `/projects/${pr?.slug}`) }
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

/* ── Акции застройщика и правило сложения (v2 · М6) ── */
export const savePromo = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (s(f, 'delete')) { await q(`delete from portal.special_offers where id = $1 and project_id = $2 and source = 'manual'`, [id, pid]); await dropAutoPost('promo:' + id); await log(c, 'object.promo_delete', 'project', pid); done(pid); return { ok: true } }
  const kind = s(f, 'kind') === 'fixed' ? 'fixed' : 'pct', value = num(f, 'value')
  if (!s(f, 'name')) return { error: t(c.lang, 'Нужно название') }
  if (value == null || !(value > 0) || (kind === 'pct' && value >= 100)) return { error: t(c.lang, 'Скидка: процент от 0 до 100 или сумма больше нуля') }
  const cur = kind === 'fixed' ? (s(f, 'currency') || 'USD').toUpperCase().slice(0, 3) : null
  // фиксированная скидка применяется только в валюте квартир проекта или в USD — иначе молча не сработала бы
  if (cur) { const curs = (await q<{ c: string }>('select distinct price_currency c from units where project_id = $1', [pid])).map((r) => r.c.trim()); if (cur !== 'USD' && !curs.includes(cur)) return { error: t(c.lang, 'Валюта суммы — USD или валюта цен проекта ({c})', { c: curs.join(', ') || 'USD' }) } }
  const bid = s(f, 'building') || null
  // Квартиры — номерами через запятую (как в шахматке); пусто — весь проект или блок
  const nums = Array.from(new Set(s(f, 'units').split(/[\s,;]+/).filter(Boolean)))
  let unitIds: string[] | null = null
  if (nums.length) {
    unitIds = (await q<{ id: string }>(`select id from units where project_id = $1 and ($2::uuid is null or building_id = $2) and number = any($3)`, [pid, bid, nums])).map((r) => r.id)
    if (unitIds.length !== nums.length) return { error: t(c.lang, 'Не все квартиры найдены: {n} из {m}', { n: unitIds.length, m: nums.length }) }
  }
  const from = s(f, 'starts_on') || null, to = s(f, 'ends_on') || null
  if (from && to && to < from) return { error: t(c.lang, 'Дата окончания раньше начала') }
  const vals = [s(f, 'name').slice(0, 120), s(f, 'badge').slice(0, 30) || null, kind, value, cur, unitIds, from, to, !!f.get('active'), bid]
  if (id && (await one<{ source: string }>('select source from portal.special_offers where id = $1', [id]))?.source === 'profitbase') return { error: t(c.lang, 'Акция из Profitbase меняется только у застройщика') }
  const pr = await one<{ name: string; slug: string }>('select name, slug from projects where id = $1', [pid])
  // Лента партнёров (М9): запись об акции живёт в сроки акции; выключили — запись убирается
  const syncPost = (oid: string) => (f.get('active') ? autoPost('promo:' + oid, 'Новая акция «{n}» в проекте {p}', { n: s(f, 'name'), p: pr?.name || '' }, pid, `/projects/${pr?.slug}`, [], { starts_on: from, ends_on: to }) : dropAutoPost('promo:' + oid))
  if (id) { await q(`update portal.special_offers set name = $2, badge = $3, kind = $4, value = $5, currency = $6, unit_ids = $7, starts_on = $8, ends_on = $9, active = $10, building_id = $11 where id = $1 and project_id = $12 and source = 'manual'`, [id, ...vals, pid]); await syncPost(id) }
  else {
    const r = await one<{ id: string }>(`insert into portal.special_offers (name, badge, kind, value, currency, unit_ids, starts_on, ends_on, active, building_id, project_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [...vals, pid, c.user.id])
    await syncPost(r!.id)
  }
  await log(c, id ? 'object.promo_update' : 'object.promo_create', 'project', pid, { name: s(f, 'name'), kind, value }); done(pid)
  return { ok: true }
})
export const savePromoMode = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), mode = s(f, 'mode')
  if (!['chain', 'sum', 'best', 'exclusive'].includes(mode)) return { error: 'mode' }
  await q(`insert into portal.project_settings (project_id, promo_mode) values ($1, $2) on conflict (project_id) do update set promo_mode = excluded.promo_mode`, [pid, mode])
  await log(c, 'object.promo_mode', 'project', pid, { mode }); done(pid)
  return { ok: true }
})

/* ── Опции: платные дополнения к квартире (группа 4) ── */
export const saveOption = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (s(f, 'delete')) { await q('delete from portal.unit_options where id = $1 and project_id = $2', [id, pid]); await log(c, 'object.option_delete', 'project', pid, { id }); done(pid); return { ok: true } }
  const title = s(f, 'title'), price = num(f, 'price'), cur = s(f, 'currency')
  if (!title) return { error: t(c.lang, 'Нужно название') }
  if (price == null || Number.isNaN(price) || price <= 0) return { error: t(c.lang, 'Проверьте цену') }
  if (!['USD', 'AZN', 'EUR'].includes(cur)) return { error: t(c.lang, 'Проверьте валюту') }
  const blocks = (await q<{ id: string; external_id: string | null }>('select id, external_id from buildings where project_id = $1', [pid]))
  const bids = f.getAll('buildings').map(String).filter((x) => blocks.some((b) => b.id === x))
  const types = f.getAll('types').map(String).filter((x) => UNIT_TYPES.includes(x))
  // Квартиры — номерами через запятую, как в шахматке (A-101 или 101); неизвестный номер — ошибка, а не тихий пропуск
  const nums = s(f, 'units').split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
  let uids: string[] = []
  if (nums.length) {
    const us = await q<{ id: string; no: string; number: string }>(`select u.id, upper(portal.unit_no(b.external_id, u.number)) no, upper(u.number) number from units u join buildings b on b.id = u.building_id where u.project_id = $1`, [pid])
    const miss = nums.filter((n) => !us.some((u) => u.no === n || u.number === n))
    if (miss.length) return { error: t(c.lang, 'Нет таких квартир: {n}', { n: miss.slice(0, 5).join(', ') }) }
    uids = Array.from(new Set(us.filter((u) => nums.includes(u.no) || nums.includes(u.number)).map((u) => u.id)))
  }
  const vals = [title, s(f, 'note') || null, price, cur, bids, types, uids, s(f, 'active') !== '0', num(f, 'sort') ?? 0]
  if (id) await q(`update portal.unit_options set title = $3, note = $4, price = $5, currency = $6, building_ids = $7, unit_types = $8, unit_ids = $9, active = $10, sort = $11 where id = $1 and project_id = $2`, [id, pid, ...vals])
  else await q(`insert into portal.unit_options (project_id, title, note, price, currency, building_ids, unit_types, unit_ids, active, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [pid, ...vals])
  await log(c, id ? 'object.option_update' : 'object.option_create', 'project', pid, { title, price, cur }); done(pid)
  return { ok: true }
})

/* ── Импорт шахматки из xlsx и копирование этажа (группа 4) ── */
// mode=check — только отчёт; mode=apply — всё одной транзакцией, и только если в файле нет ошибок
export const importChess = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), apply = s(f, 'mode') === 'apply'
  const file = f.get('file')
  if (!isFile(file) || !/\.xlsx$/i.test(file.name)) return { error: t(c.lang, 'Нужен файл .xlsx') }
  if (file.size > 5 * 1024 * 1024) return { error: t(c.lang, 'Файл больше 5 МБ') }
  let rows: string[][]
  try { rows = readXlsx(Buffer.from(await file.arrayBuffer())) } catch { return { error: t(c.lang, 'Не удалось прочитать xlsx') } }
  if (rows.length > 3001) return { error: t(c.lang, 'Не больше 3000 строк за раз') }
  const blocks = await q<{ id: string; name: string; external_id: string | null }>('select id, name, external_id from buildings where project_id = $1', [pid])
  const layouts = await q<{ id: string; code: string; unit_type: string; bedrooms: number | null; total_area_m2: number | null }>('select id, code, unit_type, bedrooms, total_area_m2::float from layouts where project_id = $1', [pid])
  const p = parseChess(rows, { blocks: blocks.flatMap((b) => [b.name, b.external_id || ''].filter(Boolean)), layouts: layouts.map((l) => l.code) })
  if (p.error) return { error: t(c.lang, p.error) }
  const bid = (name: string) => blocks.find((b) => b.name.toLowerCase() === name.toLowerCase() || (b.external_id || '').toLowerCase() === name.toLowerCase())!.id
  const cur = await q<Record<string, any>>(`select id, building_id, upper(number) number, floor, unit_type, bedrooms, area_total_m2::float, area_external_m2::float, plot_area_m2::float, price_list::float, price_currency, status, view_side, is_corner, layout_id from units where project_id = $1`, [pid])
  const errors = [...p.errors]
  const plan: { kind: 'create' | 'update'; id?: string; building: string; number: string; set: Record<string, unknown> }[] = []
  let same = 0
  for (const r of p.rows) {
    const b = bid(r.block), set = { ...r.set }
    if (set.layout) { const l = layouts.find((x) => x.code.toLowerCase() === String(set.layout).toLowerCase())!; delete set.layout; set.layout_id = l.id; set.unit_type ??= l.unit_type; set.bedrooms ??= l.bedrooms; set.area_total_m2 ??= l.total_area_m2 }
    const u = cur.find((x) => x.building_id === b && x.number === r.number) || cur.find((x) => x.building_id === b && bareNo(x.number) === r.bare)
    if (u) {
      const diff = Object.fromEntries(Object.entries(set).filter(([k, v]) => u[k] !== v && !(u[k] == null && v == null)))
      if (Object.keys(diff).length) plan.push({ kind: 'update', id: u.id, building: b, number: r.number, set: diff }); else same++
    } else {
      if (set.floor == null) { errors.push(`${r.line}: ${t(c.lang, 'для новой квартиры нужен этаж')}`); continue }
      if (!set.unit_type) { errors.push(`${r.line}: ${t(c.lang, 'для новой квартиры нужен тип или планировка')}`); continue }
      plan.push({ kind: 'create', building: b, number: r.number, set })
    }
  }
  const report = { create: plan.filter((x) => x.kind === 'create').length, update: plan.filter((x) => x.kind === 'update').length, same, errors: errors.slice(0, 50), errorsTotal: errors.length }
  if (!apply || errors.length || !plan.length) return { ok: !errors.length, report, applied: false }
  const COLS_OK = ['floor', 'unit_type', 'bedrooms', 'area_total_m2', 'area_external_m2', 'plot_area_m2', 'price_list', 'price_currency', 'status', 'view_side', 'is_corner', 'layout_id']
  await asActor(c.user.id, 'portal', async (db) => {
    await db.query(`select set_config('app.skip_refresh', 'on', true)`)
    for (const x of plan) {
      const keys = Object.keys(x.set).filter((k) => COLS_OK.includes(k))
      if (x.kind === 'update') await db.query(`update units set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [x.id, ...keys.map((k) => x.set[k])])
      else {
        const v = { price_currency: 'USD', status: x.set.price_list ? 'available' : 'unavailable', ...x.set }
        const ks = Object.keys(v).filter((k) => COLS_OK.includes(k))
        await db.query(`insert into units (project_id, building_id, number, source_id, ${ks.join(', ')}) values ($1,$2,$3,'manual',${ks.map((_, i) => '$' + (i + 4)).join(',')})`, [pid, x.building, x.number, ...ks.map((k) => (v as Record<string, unknown>)[k])])
      }
    }
    await db.query(`select set_config('app.skip_refresh', '', true)`)
    await db.query('select refresh_catalog()')
  })
  await log(c, 'object.chess_import', 'project', pid, { create: report.create, update: report.update, file: file.name }); done(pid)
  return { ok: true, report, applied: true }
})

// Номер квартиры на другом этаже в формате образца: «806» → «906», «A-0301» → «A-0401», «12A05» как есть по позиции.
// Этаж в номере — цифры перед двумя последними (позиция); ширина сохраняется (03 → 04). Без этажа в номере — этаж + позиция.
function floorNumber(n: string, from: number, to: number) {
  const m = n.match(/^([A-Za-zА-Яа-я]{1,3}-)?(\d+)(.*)$/)
  if (m && m[2].length >= 3 && Number(m[2].slice(0, -2)) === from) return (m[1] || '') + String(to).padStart(m[2].length - 2, '0') + m[2].slice(-2) + m[3]
  return (m?.[1] || '') + `${to}${riser({ number: n, floor: from })}`
}
// Копировать этаж: квартиры этажа-образца на этажи «с–по» с теми же позициями (стояками); номер = этаж + позиция, как при создании
export const copyFloor = safe(async (_: unknown, f: FormData) => {
  const c = await owner()
  const pid = s(f, 'project'), bid = s(f, 'building')
  const src = num(f, 'source'), from = num(f, 'floor_from'), to = num(f, 'floor_to')
  if (src == null || from == null || to == null || to < from) return { error: t(c.lang, 'Укажите этаж-образец и этажи «с–по»') }
  if (src >= from && src <= to) return { error: t(c.lang, 'Этаж-образец не должен входить в диапазон') }
  if (to - from > 60) return { error: t(c.lang, 'Не больше 60 этажей за раз') }
  const base = await q<{ number: string; floor: number; layout_id: string | null; unit_type: string; bedrooms: number | null; area_total_m2: number | null; area_internal_m2: number | null; area_external_m2: number | null; plot_area_m2: number | null; price_list: number | null; price_currency: string; view_side: string | null; is_corner: boolean | null }>(
    `select number, floor, layout_id, unit_type, bedrooms, area_total_m2, area_internal_m2, area_external_m2, plot_area_m2, price_list, price_currency, view_side, is_corner from units where building_id = $1 and project_id = $2 and floor = $3`, [bid, pid, src])
  if (!base.length) return { error: t(c.lang, 'На этаже-образце нет квартир') }
  const withPrice = s(f, 'prices') === '1'
  const exist = new Set((await q<{ number: string }>('select upper(number) number from units where building_id = $1', [bid])).map((r) => r.number))
  let made = 0
  await asActor(c.user.id, 'portal', async (db) => {
    await db.query(`select set_config('app.skip_refresh', 'on', true)`)
    for (let fl = from; fl <= to; fl++) for (const u of base) {
      const number = floorNumber(u.number, u.floor, fl)
      if (exist.has(number.toUpperCase())) continue
      const price = withPrice ? u.price_list : null
      await db.query(`insert into units (project_id, building_id, layout_id, number, floor, unit_type, bedrooms, area_total_m2, area_internal_m2, area_external_m2, plot_area_m2, price_list, price_currency, status, view_side, is_corner, source_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'manual')`, [pid, bid, u.layout_id, number, fl, u.unit_type, u.bedrooms, u.area_total_m2, u.area_internal_m2, u.area_external_m2, u.plot_area_m2, price, u.price_currency, price ? 'available' : 'unavailable', u.view_side, u.is_corner])
      made++
    }
    await db.query(`select set_config('app.skip_refresh', '', true)`)
    await db.query('select refresh_catalog()')
  })
  await log(c, 'object.floor_copy', 'project', pid, { building: bid, src, from, to, made }); done(pid)
  return { ok: true, made }
})
