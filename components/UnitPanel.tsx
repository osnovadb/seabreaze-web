import Link from 'next/link'
import type { Unit, Code } from '@/lib/catalog'
import { planUrl, unitNo } from '@/lib/catalog'
import { t, usd, m2, date, type Lang } from '@/lib/i18n'
import { Pill } from '@/components/ui'
import { startShow } from '@/lib/actions'

const CODE_NAME: Record<Code, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ours' | 'ink']> = {
  F: ['Свободно', 'ok'], B: ['Бронь застройщика', 'warn'], S: ['Продано', 'bad'], N: ['Не в продаже', 'off'], SB: ['Квота SeaBreeze', 'off'],
  O: ['Наша бронь', 'ours'], M: ['Ваша бронь', 'ours'], D: ['Наша сделка', 'ink'], X: ['Недоступно', 'off'],
}

// Квартира справа от шахматки: смотреть, не уходя со страницы. mode=show — без рабочих действий и внутренней информации.
export function UnitPanel({ u, code, lang, mode, closeHref, canBook, booking, orient }: {
  u: Unit; code: Code; lang: Lang; mode: 'team' | 'agent' | 'show'; closeHref: string; canBook?: boolean
  booking?: { client: string; agent: string; ends_at: string } | null; orient?: string
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const outdoor = (u.plot_area || 0) + (u.ext_area || 0)
  const plan = planUrl(u.plan_file)
  const [cn, ck] = CODE_NAME[code]
  const show = mode === 'show'
  return (
    <div className="card upanel">
      <div className="between">
        <div>
          <div className="h3">{T('Квартира {n}', { n: unitNo(u) })}</div>
          <div className="small muted">{T('{r} комн.', { r: u.rooms ?? '—' })} · {T('{f} этаж', { f: u.floor })} · {u.building}</div>
        </div>
        <Link href={closeHref} scroll={false} className="x" aria-label="×">×</Link>
      </div>
      {!show && <div className="mt8"><Pill kind={ck}>{T(cn)}</Pill></div>}
      <div className="mt16">{plan ? <div className="planbox"><img src={plan} alt="" /></div> : <div className="planbox muted small" style={{ height: 160 }}>{T('План появится позже')}</div>}</div>
      <div className="big num mt16">{u.usd ? usd(lang, u.usd) : T('Цена по запросу')}</div>
      {u.usd ? <div className="small muted">{usd(lang, u.usd / (u.area + outdoor))}/{lang === 'ru' ? 'м²' : 'm²'}{outdoor ? ' · ' + T('с учётом сада или террасы') : ''}</div> : null}
      <div className="mt8">
        <div className="kv"><span>{T('Общая площадь')}</span><span>{m2(lang, u.area)}</span></div>
        {u.plot_area ? <div className="kv"><span>{T('Свой сад')}</span><span>{m2(lang, u.plot_area)}</span></div> : null}
        {u.ext_area ? <div className="kv"><span>{T('Терраса')}</span><span>{m2(lang, u.ext_area)}</span></div> : null}
        {u.layout_code && <div className="kv"><span>{T('Планировка')}</span><span>{u.layout_code}</span></div>}
        {orient && <div className="kv"><span>{T('Вид из окон')}</span><span>{orient}</span></div>}
        {mode === 'team' && booking && <div className="kv"><span>{T('Бронь')}</span><span className="small">{booking.client} · {booking.agent} · {T('до {d}', { d: date(lang, booking.ends_at) })}</span></div>}
      </div>
      <div className="stack mt16" style={{ gap: 8 }}>
        {show ? (
          <Link className="btn btn--p btn--block" href={`/show/unit/${u.id}`}>{T('Подробнее')}</Link>
        ) : (
          <>
            {code === 'F' && canBook && <Link className="btn btn--p btn--block" href={`/units/${u.id}/book`}>{T('Забронировать')}</Link>}
            {code === 'M' && <Link className="btn btn--block" href="/bookings">{T('Ваша бронь до {d} →', { d: date(lang, u.booking_ends) })}</Link>}
            <Link className="btn btn--block" href={`/units/${u.id}`}>{T('Открыть карточку')}</Link>
            {code === 'F' && <form action={startShow}><input type="hidden" name="to" value={`/show/unit/${u.id}`} /><input type="hidden" name="lang" value={lang} /><button className="btn btn--b btn--block">{T('Показать клиенту')}</button></form>}
          </>
        )}
      </div>
    </div>
  )
}
