// 2.2 · Срок сдачи блока и проекта (запрос Дениса 10.11): квартал + год вместо свободного текста.
// Хранение — в том же текстовом столбце, год впереди: «2027-Q4», «2027», «2025-done» (сдан), чтобы сайты с slice(0, 4) брали год.
// Без зависимостей — общий для форм, страниц и юнит-тестов.
export type Delivery = { year: number | null; q: 1 | 2 | 3 | 4 | null; done: boolean }
type L4 = 'ru' | 'en' | 'de' | 'he'

const ROMAN: Record<string, 1 | 2 | 3 | 4> = { i: 1, ii: 2, iii: 3, iv: 4 }
const asQ = (x: string | undefined): 1 | 2 | 3 | 4 | null => { if (!x) return null; const r = ROMAN[x.toLowerCase()]; if (r) return r; const n = Number(x); return n >= 1 && n <= 4 ? (n as 1 | 2 | 3 | 4) : null }

// Разбор: канон («2027-Q4», «2027», «2025-done», «done») и прежние записи («IV кв. 2027», «Q4 2027», «4 кв 2027», «2030», «сдан»)
export function parseDelivery(raw: string | null | undefined): Delivery | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})(?:-(Q[1-4]|done))?$/i)
  if (m) return { year: Number(m[1]), q: m[2] && /^q/i.test(m[2]) ? asQ(m[2].slice(1)) : null, done: !!m[2] && /done/i.test(m[2]) }
  if (/^(done|сдан[аоы]?|delivered|completed|fertig(gestellt)?)$/i.test(s)) return { year: null, q: null, done: true }
  const done = /сдан|delivered|completed|fertig/i.test(s)
  const year = s.match(/\b(20\d{2})\b/)
  // квартал: «IV кв», «4 кв», «Q4», «4Q», «4 квартал»
  const qm = s.match(/\b(I{1,3}|IV)\s*(?:кв|квартал)/i) || s.match(/(?:^|[^\d])([1-4])\s*(?:кв|квартал|Q(?![a-z]))/i) || s.match(/\bQ\s*([1-4])\b/i)
  if (!year && !done) return null
  return { year: year ? Number(year[1]) : null, q: asQ(qm?.[1]), done }
}

export function canonDelivery(d: Delivery | null): string | null {
  if (!d) return null
  if (d.done) return d.year ? `${d.year}-done` : 'done'
  if (!d.year) return null
  return d.q ? `${d.year}-Q${d.q}` : String(d.year)
}

// Из формы: quarter = '' | '1'..'4' | 'done', year = '' | 'YYYY'
export function deliveryFromForm(quarter: string, year: string): string | null {
  const y = /^\d{4}$/.test(year) ? Number(year) : null
  if (quarter === 'done') return y ? canonDelivery({ year: y, q: null, done: true }) : null // «сдан» — только с годом: сайты берут первые 4 символа
  return canonDelivery({ year: y, q: y ? asQ(quarter) : null, done: false })
}

const RQ = ['', 'I', 'II', 'III', 'IV']
const DONE: Record<L4, string> = { ru: 'сдан', en: 'completed', de: 'fertiggestellt', he: 'הושלם' }
export function fmtDelivery(lang: string, raw: string | null | undefined): string {
  const d = parseDelivery(raw)
  if (!d) return String(raw ?? '').trim() // нераспознанное прежнее значение — как есть
  const L = (['ru', 'en', 'de', 'he'].includes(lang) ? lang : 'en') as L4
  if (d.done) return d.year ? `${DONE[L]} · ${d.year}` : DONE[L]
  if (!d.year) return ''
  if (!d.q) return String(d.year)
  return L === 'ru' ? `${RQ[d.q]} кв. ${d.year}` : L === 'he' ? `רבעון ${d.q} ${d.year}` : `Q${d.q} ${d.year}`
}

// Ключ сортировки: сданные — раньше всех, затем по году и кварталу; без квартала — в конце года
const key = (d: Delivery) => (d.done ? 0 : (d.year || 9999) * 10 + (d.q || 5))
// Срок проекта: свой, если задан; иначе — диапазон по блокам («Q2 2027 – Q4 2028») или один срок
export function deliveryRange(lang: string, own: string | null | undefined, blocks: (string | null | undefined)[]): string {
  if (own && String(own).trim()) return fmtDelivery(lang, own)
  const ds = blocks.map((b) => ({ raw: b, d: parseDelivery(b) })).filter((x) => x.d) as { raw: string; d: Delivery }[]
  if (!ds.length) { const any = blocks.find((b) => b && String(b).trim()); return any ? String(any).trim() : '' }
  ds.sort((a, b) => key(a.d) - key(b.d))
  const a = fmtDelivery(lang, ds[0].raw), z = fmtDelivery(lang, ds[ds.length - 1].raw)
  return a === z ? a : `${a} – ${z}`
}

// Годы для списка в форме: прошлый … +8
export const deliveryYears = (now = new Date()) => Array.from({ length: 10 }, (_, i) => now.getFullYear() - 1 + i)
