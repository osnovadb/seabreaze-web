'use server'
// Разметка объектов (владелец): генплан с контурами домов, фасады с сеткой окон, поэтажные планы с контурами по стоякам, ориентация стояков.
// Картинки — в файлах портала; координаты — доли 0..1 от картинки, поэтому разметка не зависит от размера экрана.
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { t } from './i18n'
import { storeFile, isFile } from './files'
import { riser } from './catalog'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function owner() {
  const c = await requireCtx()
  if (c.user.role !== 'owner' || (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1')) throw new Error('forbidden')
  return c
}
const done = (pid: string) => { revalidatePath(`/admin/objects/${pid}`, 'layout'); revalidatePath('/projects', 'layout'); revalidatePath('/show', 'layout') }
const pt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && x > -0.2 && x < 1.2)
// Контуры: [{ key, points: [[x,y]…] (от 3 точек), label: [x,y] }]
function shapes(json: string) {
  const a = JSON.parse(json || '[]')
  if (!Array.isArray(a)) throw new Error('shape')
  return a.filter((x) => x && typeof x.key === 'string' && Array.isArray(x.points) && x.points.length >= 3 && x.points.every(pt))
    .map((x) => ({ key: x.key, points: x.points.map((p: number[]) => [+p[0].toFixed(4), +p[1].toFixed(4)]), label: pt(x.label) ? x.label : centroid(x.points) }))
}
const centroid = (ps: number[][]) => [+(ps.reduce((a, p) => a + p[0], 0) / ps.length).toFixed(4), +(ps.reduce((a, p) => a + p[1], 0) / ps.length).toFixed(4)]
async function image(f: FormData, userId: string, lang: Parameters<typeof t>[0]) {
  const file = f.get('file')
  if (!isFile(file)) return null
  if (!/^image\//.test(file.type)) throw new Error(t(lang, 'Нужна картинка: JPG, PNG или WEBP'))
  return storeFile(file, userId)
}

/* ── Генплан ── */
export async function saveGenplan(_: unknown, f: FormData) {
  const c = await owner()
  const pid = s(f, 'project')
  try {
    const fid = await image(f, c.user.id, c.lang)
    if (fid) await q(`insert into portal.genplans (project_id, image, file_id, polygons, updated_at) values ($1, $2, $3, '[]', now())
      on conflict (project_id) do update set image = $2, file_id = $3, updated_at = now()`, [pid, '/files/' + fid, fid])
    if (f.has('shapes')) {
      // В базе контур генплана хранится под ключом block (код блока) — как читают страница проекта и режим показа
      const sh = shapes(s(f, 'shapes')).map((x) => ({ block: x.key, points: x.points, label: x.label }))
      const r = await q(`update portal.genplans set polygons = $2, note = nullif($3, ''), updated_at = now() where project_id = $1 returning project_id`, [pid, JSON.stringify(sh), s(f, 'note')])
      if (!r.length) return { error: t(c.lang, 'Сначала загрузите картинку генплана') }
    }
  } catch (e: any) { return { error: e?.message === 'shape' ? t(c.lang, 'Не удалось прочитать контуры') : String(e?.message || e) } }
  await audit(c.real.id, 'markup.genplan', 'project', pid, null, c.impersonating ? c.user.id : null)
  done(pid)
  return { ok: true }
}

/* ── Фасады ── */
export async function saveFacade(_: unknown, f: FormData) {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (s(f, 'delete')) { await q('delete from portal.facades where id = $1', [id]); done(pid); return { ok: true } }
  const risers = s(f, 'risers').split(/[\s,;]+/).filter(Boolean)
  const from = Number(s(f, 'floor_from')), to = Number(s(f, 'floor_to'))
  if (!risers.length || !from || !to || to < from) return { error: t(c.lang, 'Укажите стояки слева направо и этажи') }
  let quad: number[][] | null = null
  if (s(f, 'quad')) { try { const qd = JSON.parse(s(f, 'quad')); if (Array.isArray(qd) && qd.length === 4 && qd.every(pt)) quad = qd } catch { /* ниже */ } }
  try {
    const fid = await image(f, c.user.id, c.lang)
    if (id) await q(`update portal.facades set title = $2, risers = $3, floor_from = $4, floor_to = $5, quad = coalesce($6, quad), file_id = coalesce($7, file_id) where id = $1`,
      [id, s(f, 'title') || 'Фасад', risers, from, to, quad ? JSON.stringify(quad) : null, fid])
    else {
      if (!fid) return { error: t(c.lang, 'Загрузите фото фасада') }
      await q(`insert into portal.facades (building_id, file_id, title, risers, floor_from, floor_to, quad) values ($1,$2,$3,$4,$5,$6,$7)`,
        [s(f, 'building'), fid, s(f, 'title') || 'Фасад', risers, from, to, JSON.stringify(quad || [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]])])
    }
  } catch (e: any) { return { error: String(e?.message || e) } }
  await audit(c.real.id, 'markup.facade', 'project', pid, { building: s(f, 'building') }, c.impersonating ? c.user.id : null)
  done(pid)
  return { ok: true }
}

/* ── Поэтажные планы ── */
export async function saveFloorPlan(_: unknown, f: FormData) {
  const c = await owner()
  const pid = s(f, 'project'), id = s(f, 'id')
  if (s(f, 'delete')) { await q('delete from portal.floor_plans where id = $1', [id]); done(pid); return { ok: true } }
  const from = Number(s(f, 'floor_from')) || 1, to = Number(s(f, 'floor_to')) || 99
  try {
    const fid = await image(f, c.user.id, c.lang)
    const cells = f.has('shapes') ? JSON.stringify(shapes(s(f, 'shapes')).map((x) => ({ riser: x.key, points: x.points, label: x.label }))) : null
    if (id) await q(`update portal.floor_plans set title = $2, floor_from = $3, floor_to = $4, north_deg = $5, file_id = coalesce($6, file_id), cells = coalesce($7, cells) where id = $1`,
      [id, s(f, 'title') || 'Типовой этаж', from, to, Number(s(f, 'north')) || 0, fid, cells])
    else {
      if (!fid) return { error: t(c.lang, 'Загрузите план этажа') }
      await q(`insert into portal.floor_plans (building_id, file_id, title, floor_from, floor_to, north_deg) values ($1,$2,$3,$4,$5,$6)`, [s(f, 'building'), fid, s(f, 'title') || 'Типовой этаж', from, to, Number(s(f, 'north')) || 0])
    }
  } catch (e: any) { return { error: e?.message === 'shape' ? t(c.lang, 'Не удалось прочитать контуры') : String(e?.message || e) } }
  await audit(c.real.id, 'markup.floorplan', 'project', pid, null, c.impersonating ? c.user.id : null)
  done(pid)
  return { ok: true }
}

/* ── Ориентация стояков: вид из окон и сторона света; вид дублируется в квартиры каталога (units.view_side) для сайтов ── */
export async function saveRisers(_: unknown, f: FormData) {
  const c = await owner()
  const pid = s(f, 'project'), bid = s(f, 'building')
  const units = await q<{ id: string; number: string; floor: number; view_side: string | null }>('select id, number, floor, view_side from units where building_id = $1', [bid])
  const prev = new Map((await q<{ riser: string; view_side: string | null }>('select riser, view_side from portal.riser_info where building_id = $1', [bid])).map((x) => [x.riser, x.view_side]))
  const risers = Array.from(new Set(units.map((u) => riser(u))))
  const VIEWS = ['sea', 'marina', 'park', 'yard', 'city', 'mixed'], DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  let n = 0
  for (const r of risers) {
    const v = VIEWS.includes(s(f, 'v_' + r)) ? s(f, 'v_' + r) : null, d = DIRS.includes(s(f, 'd_' + r)) ? s(f, 'd_' + r) : null
    await q(`insert into portal.riser_info (building_id, riser, view_side, direction, note) values ($1,$2,$3,$4,$5)
      on conflict (building_id, riser) do update set view_side = $3, direction = $4, note = $5`, [bid, r, v, d, s(f, 'n_' + r) || null])
    // Квартиры со своим видом (не пустым и не равным прежнему виду стояка) не трогаем: это этажи с другой нарезкой
    const ids = units.filter((u) => riser(u) === r && (u.view_side == null || u.view_side === (prev.get(r) ?? null))).map((u) => u.id)
    if (ids.length) { await q('update units set view_side = $2 where id = any($1) and view_side is distinct from $2', [ids, v]); n += ids.length }
  }
  await audit(c.real.id, 'markup.risers', 'building', bid, { risers: risers.length }, c.impersonating ? c.user.id : null)
  done(pid)
  return { ok: true, made: n }
}
