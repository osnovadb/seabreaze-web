// 2.2 · Словари рынков (portal.dict): причины Lost, сегменты, слова-табу (271 — предупреждение, не запрет), причины отказа брони
import { q, one } from './db'

export async function tabooHits(text: string, markets: string[] = []) {
  const words = await q<{ label: string; market: string }>(`select label, market from portal.dict where kind = 'taboo' and (market = '' or market = any($1))`, [markets])
  const low = (text || '').toLowerCase()
  return Array.from(new Set(words.filter((w) => w.label && low.includes(w.label.toLowerCase())).map((w) => w.label)))
}
// 270: «Переговоры о цене разрешены» на рынке клиента; выключено — скидку и бронь запрашивает руководитель Global (или админ)
export async function priceNegotiation(market: string | null) {
  return (await one<{ p: boolean }>(`select price_negotiation p from portal.markets where code = $1`, [market || 'GLOBAL']))?.p ?? true
}
