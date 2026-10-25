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

// Текст пишем по-русски; остальные языки — по словарю, ключ — русская строка.
// Нет перевода → английский, нет английского → русский (и строка попадает в дамп при I18N_DUMP).
export function t(lang: Lang, ru: string, vars?: Record<string, string | number>): string {
  let s = ru
  if (lang === 'ru') s = RU[ru] ?? ru
  else s = DICT[lang][ru] ?? DICT.en[ru] ?? (dump(lang, ru), ru)
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}
export const tr = (lang: Lang) => (ru: string, vars?: Record<string, string | number>) => t(lang, ru, vars)

function dump(lang: Lang, ru: string) {
  if (typeof window !== 'undefined' || !process.env.I18N_DUMP) return
  try { eval('require')('fs').appendFileSync(process.env.I18N_DUMP, JSON.stringify({ lang, ru }) + '\n') } catch { /* ignore */ }
}

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB', de: 'de-DE', he: 'he-IL' }
export const num = (lang: Lang, n: number, d = 0) => new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
export const usd = (lang: Lang, n: number) => '$' + num(lang, Math.round(n))
export const pct = (lang: Lang, n: number) => num(lang, n, Number(n) % 1 ? 1 : 0) + '%'
export const m2 = (lang: Lang, a: number) => num(lang, Number(a), 2) + (lang === 'ru' ? ' м²' : lang === 'he' ? ' מ״ר' : ' m²')
export const date = (lang: Lang, d: string | Date | null) => (d ? new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '—')
export const dateTime = (lang: Lang, d: string | Date | null) => (d ? new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—')
// Переменные шаблонов из базы: даты в ISO показываем в формате языка
export const fmtVars = (lang: Lang, v: Record<string, string | number> | null | undefined) =>
  v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? date(lang, x) : x])) : undefined
