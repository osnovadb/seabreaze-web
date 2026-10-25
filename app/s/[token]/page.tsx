import { PrintButton } from '@/components/PrintButton'
import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { t, usd, m2, isRtl, type Lang } from '@/lib/i18n'
import { unitsByIds, planUrl, unitNo, codeFor } from '@/lib/catalog'
import { openedSelection } from '@/lib/actions'
import { DESIGN } from '@/components/ui'

export const dynamic = 'force-dynamic'
export default async function PublicSelection({ params, searchParams }: { params: { token: string }; searchParams: { preview?: string } }) {
  const s = await one<{ id: string; lang: Lang; client: string; agent: string; agent_email: string; title: string }>(
    `select s.id, s.lang, cl.name client, u.name agent, u.email agent_email, s.title from portal.selections s join portal.clients cl on cl.id = s.client_id join portal.users u on u.id = s.user_id where s.token = $1`, [params.token])
  if (!s) notFound()
  if (!searchParams.preview) await openedSelection(params.token)
  const L = s.lang, T = (x: string, v?: Record<string, string | number>) => t(L, x, v)
  const items = await q<{ unit_id: string; note: string | null }>('select unit_id, note from portal.selection_items where selection_id = $1 order by sort', [s.id])
  const units = new Map((await unitsByIds(items.map((i) => i.unit_id))).map((u) => [u.id, u]))
  return (
    <div dir={isRtl(L) ? 'rtl' : 'ltr'} style={{ background: 'var(--sand)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 64px' }}>
        <div className="between"><img src="/brand/wordmark.svg" alt="GetsEstate" style={{ height: 24 }} /><PrintButton label={T('Скачать PDF')} /></div>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 28 }}>{T('Подборка для {c}', { c: s.client.split(' · ').pop()! })}</h1>
        <p className="muted">{T('{n} квартир · Sea Breeze, Баку · цены по прайсу застройщика в долларах США, расходы на сделку отдельно', { n: items.length })}</p>
        <div className="stack mt24" style={{ gap: 20 }}>
          {items.map((i) => {
            const u = units.get(i.unit_id)
            if (!u) return null
            const free = codeFor(u, null, 'show') === 'F' || !!u.booking_id
            const img = DESIGN[u.rooms || 0]?.[0]
            return (
              <div key={i.unit_id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {img && <div style={{ position: 'relative' }}><img src={`/img/${img}.jpg`} alt="" style={{ width: '100%', aspectRatio: '16/8', objectFit: 'cover' }} /><span className="pill pill--off" style={{ position: 'absolute', top: 12, insetInlineStart: 12, background: '#fff' }}>{T('Визуализация')}</span></div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, padding: 20 }}>
                  <div>
                    <div className="h2">{T('Квартира {n}', { n: unitNo(u) })}</div>
                    <div className="muted">{T('{r} комн.', { r: u.rooms ?? '' })} · {m2(L, u.area)} · {T('{f} этаж', { f: u.floor })} · {u.building}</div>
                    <div className="big mt16">{free && u.usd ? usd(L, u.usd) : T('Уже забронирована')}</div>
                    {i.note && <div className="bronze mt8">„{i.note}“ — {T('ваш консультант')}</div>}
                    <div className="small muted mt8">{T('Сдаётся без ремонта; на фото — пример дизайна застройщика.')}</div>
                  </div>
                  {planUrl(u.plan_file) && <div className="planbox"><img src={planUrl(u.plan_file)!} alt="" style={{ maxHeight: 220 }} /></div>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="card mt24 between">
          <div><div className="label">{T('Ваш консультант')}</div><div className="h3 mt8">{s.agent}</div><div className="small muted">{s.agent_email}</div></div>
          <a className="btn btn--p btn--lg noprint" href={`mailto:${s.agent_email}`}>{T('Связаться с консультантом')}</a>
        </div>
        <p className="tiny muted mt16">{T('Предложение не является офертой. Цены и наличие подтверждаются консультантом перед бронью.')}</p>
      </div>
    </div>
  )
}
