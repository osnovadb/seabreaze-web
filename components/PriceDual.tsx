import { t, usd, num, date, type Lang } from '@/lib/i18n'
import type { FxView } from './Calculator'

// 317 (Денис 11.11): Германия — крупно евро, рядом доллары и «договор в долларах, курс на дату»; Израиль — крупно доллары, шекели справочно;
// без курса или Global — только доллары
const SIGN = { EUR: '€', ILS: '₪' } as const
export function PriceDual({ amount, fx, lang, className = 'big', note = true }: { amount: number; fx: FxView; lang: Lang; className?: string; note?: boolean }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  if (!fx) return <div className={className}>{usd(lang, amount)}</div>
  const loc = SIGN[fx.cur] + num(lang, Math.round(amount * fx.perUsd))
  if (fx.cur === 'EUR') return <div><div className={className}>≈ {loc}</div><div className="small muted">{usd(lang, amount)}{note ? ' · ' + T('договор в долларах, курс на {d}', { d: date(lang, fx.date) }) : ''}</div></div>
  return <div><div className={className}>{usd(lang, amount)}</div><div className="small muted">≈ {loc}{note ? ' · ' + T('справочно, курс на {d}', { d: date(lang, fx.date) }) : ''}</div></div>
}
