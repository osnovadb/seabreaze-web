// 378 (Денис 12.11, «Все так»): ставка рынка по сделке — от страны проживания клиента; страна — из списка при регистрации
// Рынок: DE — Германия, Австрия, Швейцария; IL — Израиль; остальные — GLOBAL (portal.markets.countries)
export const COUNTRIES: [string, string, string, string, string][] = [ // код, ru, en, de, he
  ['DE', 'Германия', 'Germany', 'Deutschland', 'גרמניה'], ['AT', 'Австрия', 'Austria', 'Österreich', 'אוסטריה'], ['CH', 'Швейцария', 'Switzerland', 'Schweiz', 'שווייץ'],
  ['IL', 'Израиль', 'Israel', 'Israel', 'ישראל'], ['AZ', 'Азербайджан', 'Azerbaijan', 'Aserbaidschan', 'אזרבייג׳ן'], ['RU', 'Россия', 'Russia', 'Russland', 'רוסיה'],
  ['UA', 'Украина', 'Ukraine', 'Ukraine', 'אוקראינה'], ['KZ', 'Казахстан', 'Kazakhstan', 'Kasachstan', 'קזחסטן'], ['GE', 'Грузия', 'Georgia', 'Georgien', 'גאורגיה'],
  ['TR', 'Турция', 'Turkey', 'Türkei', 'טורקיה'], ['AE', 'ОАЭ', 'UAE', 'VAE', 'איחוד האמירויות'], ['GB', 'Великобритания', 'United Kingdom', 'Vereinigtes Königreich', 'בריטניה'],
  ['US', 'США', 'USA', 'USA', 'ארה״ב'], ['FR', 'Франция', 'France', 'Frankreich', 'צרפת'], ['IT', 'Италия', 'Italy', 'Italien', 'איטליה'], ['ES', 'Испания', 'Spain', 'Spanien', 'ספרד'],
  ['NL', 'Нидерланды', 'Netherlands', 'Niederlande', 'הולנד'], ['BE', 'Бельгия', 'Belgium', 'Belgien', 'בלגיה'], ['PL', 'Польша', 'Poland', 'Polen', 'פולין'], ['CZ', 'Чехия', 'Czechia', 'Tschechien', 'צ׳כיה'],
  ['CY', 'Кипр', 'Cyprus', 'Zypern', 'קפריסין'], ['GR', 'Греция', 'Greece', 'Griechenland', 'יוון'], ['UZ', 'Узбекистан', 'Uzbekistan', 'Usbekistan', 'אוזבקיסטן'], ['OT', 'Другая страна', 'Other country', 'Anderes Land', 'מדינה אחרת'],
]
const ALIASES: Record<string, string> = {}
for (const [code, ...names] of COUNTRIES) for (const n of [code, ...names]) ALIASES[n.toLowerCase()] = code
Object.assign(ALIASES, { 'germany (de)': 'DE', 'österreich': 'AT', 'osterreich': 'AT', 'israel (il)': 'IL', 'ישראל': 'IL' })
// свободный текст прежних записей («Deutschland», «Israel») → код
export const countryCode = (raw: string | null | undefined) => (raw ? ALIASES[raw.trim().toLowerCase()] || null : null)
export function marketOfCountry(raw: string | null | undefined): string | null {
  const c = countryCode(raw)
  if (!c) return raw && raw.trim() ? 'GLOBAL' : null
  return ['DE', 'AT', 'CH'].includes(c) ? 'DE' : c === 'IL' ? 'IL' : 'GLOBAL'
}
export const countryName = (code: string | null | undefined, lang: string) => {
  const r = COUNTRIES.find((x) => x[0] === code); if (!r) return code || ''
  return lang === 'en' || lang === 'az' ? r[2] : lang === 'de' ? r[3] : lang === 'he' ? r[4] : r[1]
}
