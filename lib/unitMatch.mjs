// Фильтр квартир каталога (М12): один и тот же для страницы «Каталог» и для сохранённых поисков в tick.
// Работает по уже посчитанным полям квартиры: usd (цена в долларах), rooms (комнаты как в каталоге), area, floor и т. д.
// Старые сохранённые поиски ({ project, rooms: число, max: тыс. $, outdoor }) читаются так же.

/** Приводит фильтр к единому виду */
export function normFilter(f = {}) {
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean)
  return {
    project: f.project || null,
    building: f.building || null,
    types: arr(f.types),
    rooms: arr(f.rooms).map(Number).filter((n) => n >= 1 && n <= 9),
    pmin: num(f.pmin), pmax: num(f.pmax) ?? (num(f.max) != null ? num(f.max) * 1000 : null),
    amin: num(f.amin), amax: num(f.amax),
    fmin: num(f.fmin), fmax: num(f.fmax),
    view: f.view || null,
    outdoor: ['g', 't'].includes(f.outdoor) ? f.outdoor : null,
    corner: !!f.corner,
    promo: !!f.promo,
  }
}

/** Подходит ли квартира под фильтр. u: { project_id, building_id, unit_type, rooms, usd, area, floor, view_side, plot_area, ext_area, is_corner, promo } */
export function matchUnit(u, nf) {
  if (nf.project && u.project_id !== nf.project) return false
  if (nf.building && u.building_id !== nf.building) return false
  if (nf.types.length && !nf.types.includes(u.unit_type)) return false
  // «4» в фильтре — 4 комнаты и больше
  if (nf.rooms.length && !nf.rooms.some((r) => (r >= 4 ? (u.rooms || 0) >= 4 : u.rooms === r))) return false
  if (nf.pmin != null && !((u.usd || 0) >= nf.pmin)) return false
  if (nf.pmax != null && !(u.usd != null && u.usd <= nf.pmax)) return false
  if (nf.amin != null && !(u.area >= nf.amin)) return false
  if (nf.amax != null && !(u.area <= nf.amax)) return false
  if (nf.fmin != null && !(u.floor >= nf.fmin)) return false
  if (nf.fmax != null && !(u.floor <= nf.fmax)) return false
  if (nf.view && u.view_side !== nf.view) return false
  if (nf.outdoor === 'g' && !(u.plot_area > 0)) return false
  if (nf.outdoor === 't' && !(u.ext_area > 0)) return false
  if (nf.corner && !u.is_corner) return false
  if (nf.promo && !u.promo) return false
  return true
}
