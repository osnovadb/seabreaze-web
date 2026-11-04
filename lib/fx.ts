import { q } from './db'
import type { Lang } from './i18n'

// Курсы ЦБ Азербайджана (public.currency_rates: сколько AZN за единицу валюты). Обновляет tick раз в сутки.
// Цены в каталоге — в валюте проекта (пересчитаны в USD); здесь — показ в валюте рынка, только для справки.
export type Fx = { cur: 'EUR' | 'ILS'; perUsd: number; date: string }
const MARKET_CUR: Record<string, Fx['cur']> = { DE: 'EUR', IL: 'ILS' }
const LANG_CUR: Partial<Record<Lang, Fx['cur']>> = { de: 'EUR', he: 'ILS' }

let cache: { at: number; rates: Map<string, { azn: number; date: string }> } | null = null
async function rates() {
  if (cache && Date.now() - cache.at < 600_000) return cache.rates
  const rows = await q<{ currency: string; azn: number; date: string }>(`select distinct on (currency) currency, azn_per_unit::float azn, valid_from::date::text date
    from currency_rates order by currency, valid_from desc, id desc`)
  cache = { at: Date.now(), rates: new Map(rows.map((r) => [r.currency, { azn: r.azn, date: r.date }])) }
  return cache.rates
}
// Валюта рынка пользователя (DE → EUR, IL → ILS); для GLOBAL и без курса — null, показываем только USD
export async function fxFor(market: string | null | undefined, lang?: Lang): Promise<Fx | null> {
  // GLOBAL — только USD (ТЗ); по языку — лишь когда рынка нет вовсе (клиент без рынка)
  if (market === 'GLOBAL') return null
  const cur = (market && MARKET_CUR[market]) || (!market && lang && LANG_CUR[lang])
  if (!cur) return null
  const r = await rates(), usd = r.get('USD'), x = r.get(cur)
  if (!usd || !x) return null
  return { cur, perUsd: usd.azn / x.azn, date: x.date < usd.date ? x.date : usd.date }
}

// Сумма в USD по курсу ЦБ (через AZN); 0 — курса нет
export async function toUsd(amount: number, cur: string) {
  if (cur === 'USD') return amount
  const r = await rates(), usd = r.get('USD'), x = r.get(cur)
  if (cur === 'AZN') return usd ? amount / usd.azn : 0
  return usd && x ? amount * x.azn / usd.azn : 0
}
