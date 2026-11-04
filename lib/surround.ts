// Окружение на планах (М2): что вокруг дома — море, бассейн, дорога. Метка — точка в долях 0..1 картинки плана.
// На условной схеме этажа (плана нет) окружение задаётся сторонами: верхний ряд квартир смотрит на «верх», нижний — на «низ».
import { t, type Lang } from './i18n'

export const MARKS: Record<string, [string, string]> = {
  sea: ['🌊', 'Море'], beach: ['🏖️', 'Пляж'], pool: ['🏊', 'Бассейн'], road: ['🛣️', 'Дорога'], street: ['🚗', 'Улица'],
  park: ['🌳', 'Парк'], yard: ['🌿', 'Двор'], playground: ['🛝', 'Детская площадка'], parking: ['🅿️', 'Парковка'],
  entrance: ['🚪', 'Вход'], marina: ['⛵', 'Марина'], restaurant: ['🍽️', 'Ресторан'], gym: ['🏋️', 'Фитнес'], spa: ['💆', 'Спа'],
  shop: ['🛒', 'Магазин'], school: ['🏫', 'Школа'], building: ['🏢', 'Соседний дом'], custom: ['📍', 'Метка'],
}
export type Mark = { kind: string; label?: string; x: number; y: number }
export type Side = { kind: string; label?: string }
export type Sides = Partial<Record<'top' | 'right' | 'bottom' | 'left', Side>>
export const SIDES = ['top', 'right', 'bottom', 'left'] as const
export const SIDE_NAME: Record<string, string> = { top: 'Сверху', right: 'Справа', bottom: 'Снизу', left: 'Слева' }

export const markIcon = (k: string) => (MARKS[k] || MARKS.custom)[0]
export const markText = (L: Lang, m: { kind: string; label?: string }) => m.label || t(L, (MARKS[m.kind] || MARKS.custom)[1])

// Разбор того, что пришло из формы или базы: только известные виды, координаты в пределах картинки
export function cleanMarks(v: unknown): Mark[] {
  const a = Array.isArray(v) ? v : []
  return a.filter((m) => m && MARKS[m.kind] && [m.x, m.y].every((x) => typeof x === 'number' && x >= 0 && x <= 1))
    .slice(0, 60).map((m) => ({ kind: m.kind, x: +m.x.toFixed(4), y: +m.y.toFixed(4), ...(typeof m.label === 'string' && m.label.trim() ? { label: m.label.trim().slice(0, 40) } : {}) }))
}
// Что рядом с квартирой на плане этажа: метки ближе 0,28 картинки к центру её контура, ближние первыми
export function nearMarks(marks: Mark[], c: [number, number] | null, max = 3) {
  if (!c) return []
  return marks.map((m) => ({ m, d: Math.hypot(m.x - c[0], m.y - c[1]) })).filter((x) => x.d < 0.28).sort((a, b) => a.d - b.d).slice(0, max).map((x) => x.m)
}
