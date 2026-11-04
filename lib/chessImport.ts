// Импорт шахматки из xlsx (группа 4) — для застройщиков без Profitbase. Разбор и проверка без базы: строки → изменения.
// Совпадение квартиры — корпус + номер. Пустая ячейка ничего не меняет, поэтому можно грузить только цены или только статусы.
import { UNIT_TYPES } from './catalog'

export const COLS: [key: string, ru: string, alias: string[]][] = [
  ['block', 'Корпус', ['block', 'building', 'gebäude', 'бинйан']], ['floor', 'Этаж', ['floor', 'etage']], ['number', 'Номер', ['number', 'unit', 'nr', 'nummer', '№']],
  ['type', 'Тип', ['type', 'typ']], ['bedrooms', 'Спальни', ['bedrooms', 'schlafzimmer']], ['area', 'Площадь', ['area', 'fläche', 'м²', 'm2']],
  ['terrace', 'Терраса', ['terrace', 'terrasse', 'балкон']], ['garden', 'Сад', ['garden', 'garten', 'участок']], ['layout', 'Планировка', ['layout', 'grundriss', 'код планировки']],
  ['price', 'Цена', ['price', 'preis']], ['currency', 'Валюта', ['currency', 'währung']], ['status', 'Статус', ['status']],
  ['view', 'Вид', ['view', 'вид из окон', 'aussicht']], ['corner', 'Угловая', ['corner', 'eck']],
]
const TYPE_ALIAS: Record<string, string> = { 'студия': 'studio', '1 спальня': '1br', '2 спальни': '2br', '3 спальни': '3br', '4 спальни': '4br', 'дуплекс': 'duplex', 'пентхаус': 'penthouse',
  'таунхаус': 'townhouse', 'вилла': 'villa', 'коммерция': 'commercial', 'машиноместо': 'parking', 'паркинг': 'parking', 'кладовка': 'storage', 'parking': 'parking', 'storage': 'storage' }
const STATUS_ALIAS: Record<string, string> = { available: 'available', free: 'available', 'свободна': 'available', 'свободно': 'available', reserved: 'reserved', booked: 'reserved', 'бронь': 'reserved',
  sold: 'sold', 'продана': 'sold', 'продано': 'sold', unavailable: 'unavailable', 'не в продаже': 'unavailable', 'закрыта': 'unavailable' }
const VIEW_ALIAS: Record<string, string> = { sea: 'sea', 'море': 'sea', 'на море': 'sea', marina: 'marina', 'марина': 'marina', park: 'park', 'парк': 'park', yard: 'yard', 'двор': 'yard', 'во двор': 'yard',
  city: 'city', 'улица': 'city', 'город': 'city', mixed: 'mixed', 'две стороны': 'mixed' }

export type Row = { line: number; block: string; number: string; set: Record<string, unknown> }
const yes = (v: string) => ['да', 'yes', 'ja', '1', 'true', 'x', '+'].includes(v.toLowerCase())

// rows — первая строка заголовок; номер строки в ошибках — как в Excel
export function parseChess(rows: string[][], ctx: { blocks: string[]; layouts: string[] }) {
  const head = (rows[0] || []).map((h) => h.trim().toLowerCase())
  const idx: Record<string, number> = {}
  for (const [k, ru, al] of COLS) { const i = head.findIndex((h) => h === ru.toLowerCase() || al.includes(h)); if (i >= 0) idx[k] = i }
  if (idx.block == null || idx.number == null) return { error: 'Нужны колонки «Корпус» и «Номер»', rows: [] as Row[], errors: [] as string[] }
  const out: Row[] = [], errors: string[] = []
  const num = (v: string) => { const x = Number(v.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : NaN }
  rows.slice(1).forEach((r, i) => {
    const line = i + 2, cell = (k: string) => (idx[k] != null ? String(r[idx[k]] ?? '').trim() : '')
    if (!r.some((x) => String(x ?? '').trim())) return
    const block = cell('block'), number = cell('number').toUpperCase().replace(/^[A-ZА-Я]{1,3}-/, '') // «A-101» из шахматки = «101» в корпусе A
    const err = (m: string) => errors.push(`${line}: ${m}`)
    if (!block || !number) return err('нет корпуса или номера')
    if (!ctx.blocks.some((b) => b.toLowerCase() === block.toLowerCase())) return err(`нет корпуса «${block}»`)
    const set: Record<string, unknown> = {}
    const n = (k: string, col: string, min = 0) => { const v = cell(k); if (!v) return true; const x = num(v); if (Number.isNaN(x) || x < min) { err(`${col}: «${v}»`); return false } set[col] = x; return true }
    if (!n('floor', 'floor', -5) || !n('bedrooms', 'bedrooms') || !n('area', 'area_total_m2') || !n('terrace', 'area_external_m2') || !n('garden', 'plot_area_m2') || !n('price', 'price_list')) return
    if (set.floor != null) set.floor = Math.round(set.floor as number)
    const type = cell('type').toLowerCase()
    if (type) { const v = UNIT_TYPES.includes(type) ? type : TYPE_ALIAS[type]; if (!v) return err(`тип «${cell('type')}»`); set.unit_type = v }
    const cur = cell('currency').toUpperCase()
    if (cur) { if (!['USD', 'AZN', 'EUR'].includes(cur)) return err(`валюта «${cur}»`); set.price_currency = cur }
    const st = cell('status').toLowerCase()
    if (st) { const v = STATUS_ALIAS[st]; if (!v) return err(`статус «${cell('status')}»`); set.status = v }
    const vw = cell('view').toLowerCase()
    if (vw) { const v = VIEW_ALIAS[vw]; if (!v) return err(`вид «${cell('view')}»`); set.view_side = v }
    if (cell('corner')) set.is_corner = yes(cell('corner'))
    const lay = cell('layout')
    if (lay) { if (!ctx.layouts.some((l) => l.toLowerCase() === lay.toLowerCase())) return err(`нет планировки «${lay}»`); set.layout = lay }
    if (out.some((x) => x.block.toLowerCase() === block.toLowerCase() && x.number === number)) return err(`квартира ${block}-${number} в файле дважды`)
    out.push({ line, block, number, set })
  })
  return { error: '', rows: out, errors }
}
