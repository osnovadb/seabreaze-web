// Самая выгодная действующая акция на квартиру (М6) — одна функция для портала (lib/promo.ts) и tick (сохранённые поиски).
// Фиксированная скидка — в валюте проекта: в USD по тому же курсу, что и цена квартиры; в чужой валюте (AZN на USD-квартиру) не действует.

/** u: { id, building_id, usd, price, currency }; offers — в порядке offersFor (по сроку окончания). Возвращает { offer, usd } или null */
export function bestOffer(u, offers) {
  if (!u.usd) return null
  let best = null
  for (const o of offers) {
    if (o.building_id && o.building_id !== u.building_id) continue
    if (o.unit_ids && o.unit_ids.length && !o.unit_ids.includes(u.id)) continue
    const usd = o.kind === 'fixed' ? (o.currency === u.currency && u.price ? (o.value * u.usd) / u.price : o.currency === 'USD' ? o.value : 0) : (u.usd * o.value) / 100
    if (!usd) continue
    if (!best || usd > best.usd + 0.005) best = { offer: o, usd } // при равной выгоде — первая по сроку окончания
  }
  return best
}
