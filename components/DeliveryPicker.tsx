// Срок сдачи в формах объекта: квартал + год (или «сдан»). Нераспознанное прежнее значение не теряем: показываем и храним, пока не выбрано новое.
import { t, type Lang } from '@/lib/i18n'
import { parseDelivery, deliveryYears } from '@/lib/delivery'

export function DeliveryPicker({ lang, value, label, compact }: { lang: Lang; value: string | null; label?: string; compact?: boolean }) {
  const T = (s: string) => t(lang, s)
  const d = parseDelivery(value)
  const years = deliveryYears()
  if (d?.year && !years.includes(d.year)) years.unshift(d.year)
  const q = d?.done ? 'done' : d?.q ? String(d.q) : ''
  const sel = (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <select className="in" name="delivery_q" defaultValue={q} aria-label={T('Квартал')} style={{ minWidth: 0 }}>
        <option value="">{T('квартал')}</option>{['1', '2', '3', '4'].map((x) => <option key={x} value={x}>{['I', 'II', 'III', 'IV'][Number(x) - 1]} {T('кв.')}</option>)}<option value="done">{T('сдан')}</option>
      </select>
      <select className="in" name="delivery_y" defaultValue={d?.year ? String(d.year) : ''} aria-label={T('Год')} style={{ minWidth: 0 }}>
        <option value="">{T('год')}</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <input type="hidden" name="delivery_raw" value={value || ''} />
    </span>
  )
  const legacy = value && !d ? <span className="tiny warnc">{T('было')}: «{value}» — {T('выберите квартал и год')}</span> : null
  if (compact) return <span className="stack" style={{ gap: 2 }}>{sel}{legacy}</span>
  return <label className="field"><span>{T(label || 'Сдача')}</span>{sel}{legacy}</label>
}
