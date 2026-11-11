import en from './dict/en.json'
import de from './dict/de.json'
import he from './dict/he.json'
import ru from './dict/ru.json'

export type Lang = 'ru' | 'en' | 'de' | 'he'
export const LANGS: Lang[] = ['ru', 'en', 'de', 'he']
export const isRtl = (l: Lang) => l === 'he'
const DICT: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { en, de, he }
// Русские переопределения: ключ остаётся прежним, показ меняется (например, «Продавец» → «Менеджер по продажам»)
const RU: Record<string, string> = ru

const warned = new Set<string>()
// Текст пишем по-русски; остальные языки — по словарю, ключ — русская строка.
// Нет перевода → английский, нет английского → русский (и строка попадает в дамп при I18N_DUMP).
export function t(lang: Lang, ru: string, vars?: Record<string, string | number>): string {
  let s = ru
  if (lang === 'ru') s = RU[ru] ?? ru
  else {
    // неизвестный язык (QA 10.11: страница «Регистрации» падала 500) — английский и отметка в журнале
    const d = DICT[lang as Exclude<Lang, 'ru'>]
    if (!d && !warned.has(String(lang))) { warned.add(String(lang)); console.warn('i18n: unknown lang', JSON.stringify(lang)) }
    s = d?.[ru] ?? DICT.en[ru] ?? (dump(lang, ru), ru)
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  if (lang === 'he' && vars) s = heOne(s)
  if (lang === 'en' && vars) s = s.replace(/(^|[^\d.,])1 (room|day|month|apartment|unit|booking|client|floor|week|project|deal|hour|working day|file|row)s\b/g, (_m, p: string, w: string) => `${p}1 ${w}`) // М6: «1 rooms»
  return s
}
// Вычитка иврита 11.11: при значении 1 — форма единственного числа («1 ימים» → «יום אחד»)
const HE_ONE: [RegExp, string][] = [[/(^|[^\d.,])1 ימי עסקים/g, '$1יום עסקים אחד'], [/(^|[^\d.,])1 ימים/g, '$1יום אחד'], [/(^|[^\d.,])1 דירות/g, '$1דירה אחת'],
  [/(^|[^\d.,])1 חודשים/g, '$1חודש אחד'], [/(^|[^\d.,])1 שעות/g, '$1שעה אחת'], [/(^|[^\d.,])1 לקוחות/g, '$1לקוח אחד'], [/(^|[^\d.,])1 הזמנות/g, '$1הזמנה אחת'],
  [/(^|[^\d.,])1 קומות/g, '$1קומה אחת'], [/(^|[^\d.,])1 שבועות/g, '$1שבוע אחד'], [/(^|[^\d.,])1 פרויקטים/g, '$1פרויקט אחד'], [/(^|[^\d.,])1 עסקאות/g, '$1עסקה אחת']]
const heOne = (s: string) => HE_ONE.reduce((a, [re, to]) => a.replace(re, to), s)
export const tr = (lang: Lang) => (ru: string, vars?: Record<string, string | number>) => t(lang, ru, vars)

function dump(lang: Lang, ru: string) {
  if (typeof window !== 'undefined' || !process.env.I18N_DUMP) return
  try { eval('require')('fs').appendFileSync(process.env.I18N_DUMP, JSON.stringify({ lang, ru }) + '\n') } catch { /* ignore */ }
}

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB', de: 'de-DE', he: 'he-IL' }
export const num = (lang: Lang, n: number, d = 0) => new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
export const usd = (lang: Lang, n: number) => (n < 0 ? '−$' : '$') + num(lang, Math.round(Math.abs(n)))
export const pct = (lang: Lang, n: number) => num(lang, n, Number(n) % 1 ? 1 : 0) + '%'
export const m2u = (lang: Lang) => (lang === 'ru' ? 'м²' : lang === 'he' ? 'מ״ר' : 'm²') // М6: в английском была кириллическая «м²»
export const m2 = (lang: Lang, a: number) => num(lang, Number(a), 2) + ' ' + m2u(lang)
// М6: в английском «07/05/2027» непонятно — май или июль; пишем «7 May 2027»
export const date = (lang: Lang, d: string | Date | null) => (d ? new Intl.DateTimeFormat(LOCALE[lang], lang === 'en' ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '—')
export const dateTime = (lang: Lang, d: string | Date | null) => (d ? new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—')
// Переменные шаблонов из базы: даты в ISO показываем в формате языка
export const fmtVars = (lang: Lang, v: Record<string, string | number> | null | undefined) =>
  v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? date(lang, x) : x])) : undefined

// «Сегодня» по Баку (YYYY-MM-DD): портал работает по времени офиса, сервер — в UTC
// «ноябрь 2026» из «2026-11»
export const monthName = (lang: Lang, ym: string) => new Intl.DateTimeFormat(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T00:00:00Z'))
export const bakuToday = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(d)
export const bakuYear = () => Number(bakuToday().slice(0, 4))
