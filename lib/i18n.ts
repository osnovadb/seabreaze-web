import en from './dict/en.json'
import de from './dict/de.json'
import he from './dict/he.json'
import ru from './dict/ru.json'
import az from './dict/az.json'

export type Lang = 'ru' | 'en' | 'de' | 'he' | 'az'
// LANGS — языки, которые можно выбрать (переключатель, профиль, письма). az — черновик до вычитки Фуадом (ревью 11.11):
// в переключателе его нет, включается только cookie ge_lang=az через /dev/lang?l=az (QA) — см. DRAFT_LANGS
export const LANGS: Lang[] = ['ru', 'en', 'de', 'he']
export const DRAFT_LANGS: Lang[] = ['az']
export const isLang = (x: unknown): x is Lang => typeof x === 'string' && ([...LANGS, ...DRAFT_LANGS] as string[]).includes(x)
export const isRtl = (l: Lang) => l === 'he'
const DICT: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { en, de, he, az }
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
  if (lang === 'ru' && vars) s = ruPlural(s)
  if (lang === 'en' && vars) s = s.replace(/(^|[^\d.,])1 (room|day|month|apartment|unit|booking|client|floor|week|project|deal|hour|working day|file|row)s\b/g, (_m, p: string, w: string) => `${p}1 ${w}`) // М6: «1 rooms»
  return s
}
// Вычитка иврита 11.11: при значении 1 — форма единственного числа («1 ימים» → «יום אחד»)
const HE_ONE: [RegExp, string][] = [[/(^|[^\d.,])1 ימי עסקים/g, '$1יום עסקים אחד'], [/(^|[^\d.,])1 ימים/g, '$1יום אחד'], [/(^|[^\d.,])1 דירות/g, '$1דירה אחת'],
  [/(^|[^\d.,])1 חודשים/g, '$1חודש אחד'], [/(^|[^\d.,])1 שעות/g, '$1שעה אחת'], [/(^|[^\d.,])1 לקוחות/g, '$1לקוח אחד'], [/(^|[^\d.,])1 הזמנות/g, '$1הזמנה אחת'],
  [/(^|[^\d.,])1 קומות/g, '$1קומה אחת'], [/(^|[^\d.,])1 שבועות/g, '$1שבוע אחד'], [/(^|[^\d.,])1 פרויקטים/g, '$1פרויקט אחד'], [/(^|[^\d.,])1 עסקאות/g, '$1עסקה אחת']]
const heOne = (s: string) => HE_ONE.reduce((a, [re, to]) => a.replace(re, to), s)
// О70 (обход 11.11): «1 квартир», «2 клиентов» — русская форма слова после числа (строки пишутся с формой «много»)
const RU_FORMS: Record<string, [string, string, string]> = {
  квартир: ['квартира', 'квартиры', 'квартир'], клиентов: ['клиент', 'клиента', 'клиентов'], броней: ['бронь', 'брони', 'броней'], сделок: ['сделка', 'сделки', 'сделок'],
  строк: ['строка', 'строки', 'строк'], дней: ['день', 'дня', 'дней'], месяцев: ['месяц', 'месяца', 'месяцев'], проектов: ['проект', 'проекта', 'проектов'],
  планировок: ['планировка', 'планировки', 'планировок'], платежей: ['платёж', 'платежа', 'платежей'], вариантов: ['вариант', 'варианта', 'вариантов'], пользователей: ['пользователь', 'пользователя', 'пользователей'],
}
const ruForm = (n: number, f: [string, string, string]) => { const a = n % 100, b = n % 10; return a >= 11 && a <= 14 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2] }
const RU_RE = new RegExp(`(^|[^\\d.,])(\\d+) (${Object.keys(RU_FORMS).join('|')})(?![а-яё])`, 'g')
const ruPlural = (s: string) => s.replace(RU_RE, (_m, p: string, n: string, w: string) => `${p}${n} ${ruForm(Number(n), RU_FORMS[w])}`)
export const tr = (lang: Lang) => (ru: string, vars?: Record<string, string | number>) => t(lang, ru, vars)

function dump(lang: Lang, ru: string) {
  if (typeof window !== 'undefined' || !process.env.I18N_DUMP) return
  try { eval('require')('fs').appendFileSync(process.env.I18N_DUMP, JSON.stringify({ lang, ru }) + '\n') } catch { /* ignore */ }
}

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB', de: 'de-DE', he: 'he-IL', az: 'az-AZ' }
export const num = (lang: Lang, n: number, d = 0) => new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
export const usd = (lang: Lang, n: number) => (n < 0 ? '−$' : '$') + num(lang, Math.round(Math.abs(n)))
export const pct = (lang: Lang, n: number) => num(lang, n, Number(n) % 1 ? 1 : 0) + '%'
export const m2u = (lang: Lang) => (lang === 'ru' ? 'м²' : lang === 'he' ? 'מ״ר' : 'm²') // М6: в английском была кириллическая «м²»
export const m2 = (lang: Lang, a: number) => num(lang, Number(a), 2) + ' ' + m2u(lang)
// М6: в английском «07/05/2027» непонятно — май или июль; пишем «7 May 2027»
export const date = (lang: Lang, d: string | Date | null) => (d ? new Intl.DateTimeFormat(LOCALE[lang], lang === 'en' ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '—')
// О75 (обход 11.11): по-английски «04/11» читалось как 11 апреля — месяц словом, как в date()
export const dateTime = (lang: Lang, d: string | Date | null) => (d ? new Intl.DateTimeFormat(LOCALE[lang], lang === 'en' ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—')
// Переменные шаблонов из базы: даты в ISO показываем в формате языка
export const fmtVars = (lang: Lang, v: Record<string, string | number> | null | undefined) =>
  v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fmtOne(lang, x)])) : undefined
// О70 (обход 11.11): в истории и уведомлениях суммы и проценты — в формате языка экрана («$142 984», «12,5»), а не как записаны («$142,984», «12.5»)
const fmtOne = (lang: Lang, x: string | number) => {
  if (typeof x === 'number') return Number.isInteger(x) ? x : num(lang, x, Math.abs(x * 10) % 1 ? 2 : 1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return date(lang, x)
  if (/^−?-?\$\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) { const n = Number(x.replace(/[−$,]/g, '').replace(/^-/, '')); return usd(lang, /^[−-]/.test(x) ? -n : n) }
  return x
}

// «Сегодня» по Баку (YYYY-MM-DD): портал работает по времени офиса, сервер — в UTC
// «ноябрь 2026» из «2026-11»
export const monthName = (lang: Lang, ym: string) => new Intl.DateTimeFormat(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T00:00:00Z'))
export const bakuToday = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(d)
export const bakuYear = () => Number(bakuToday().slice(0, 4))
