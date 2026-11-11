// 378: страна проживания — из списка (от неё рынок клиента и ставка застройщика по сделке)
import { COUNTRIES, countryCode, countryName } from '@/lib/country'
import { t, type Lang } from '@/lib/i18n'
export function CountrySelect({ lang, value, name = 'country', required = false }: { lang: Lang; value?: string | null; name?: string; required?: boolean }) {
  const code = countryCode(value) || ''
  const legacy = value && !code ? value : null // прежняя запись свободным текстом — показываем как есть, пока не выберут из списка
  return (
    <select key={`${name}:${String(value || '')}`} className="in" name={name} defaultValue={legacy || code} required={required}>
      <option value="">{t(lang, '— выберите страну —')}</option>
      {legacy && <option value={legacy}>{legacy}</option>}
      {COUNTRIES.map(([c]) => <option key={c} value={c}>{countryName(c, lang)}</option>)}
    </select>
  )
}
