import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one } from '@/lib/db'
import { t, usd, m2 } from '@/lib/i18n'
import { unitById, codeFor, planUrl, unitNo, projectVisible, plansFor } from '@/lib/catalog'
import { PlanList } from '@/components/PlanList'
import { DESIGN, LOBBY } from '@/components/ui'
import { likeInShow } from '@/lib/actions'
import { ShowBook } from './book'

export default async function ShowUnit({ params, searchParams }: { params: { id: string }; searchParams: { booked?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const u = await unitById(params.id)
  if (!u || !['sales', 'stop'].includes(u.sales_status) || !(await projectVisible(u.project_id, c.user))) notFound()
  const free = codeFor(u, null, 'show') === 'F'
  const proj = await one<{ slug: string }>('select slug from projects where id = $1', [u.project_id])
  const liked = c.show?.clientId ? await one(`select 1 from portal.selection_items si join portal.selections s on s.id = si.selection_id where s.client_id = $1 and si.unit_id = $2 and si.liked`, [c.show.clientId, u.id]) : null
  const imgs = [DESIGN[u.rooms || 0]?.[0], proj?.slug === 'premium-residence' ? LOBBY[u.block] : null].filter(Boolean) as string[]
  const plans = await plansFor(u.project_id, u.building_id)
  return (
    <div className="page split">
      <div className="stack">
        <div className="card">{planUrl(u.plan_file) ? <div className="planbox" style={{ border: 0 }}><img src={planUrl(u.plan_file)!} alt="" /></div> : null}</div>
        <div className="grid g2">{imgs.map((h) => <div key={h} className="ph" style={{ aspectRatio: '16/10', position: 'relative' }}><img src={`/img/${h}.jpg`} alt="" /><span className="pill pill--off" style={{ position: 'absolute', top: 10, insetInlineStart: 10, background: '#fff' }}>{T('Визуализация')}</span></div>)}</div>
      </div>
      <div className="stack">
      <div className="card">
        <Link className="small muted" href={`/show/${proj?.slug}?b=${u.building_id}`}>← {u.building}</Link>
        <div className="h2 mt8" style={{ fontSize: 28 }}>{T('Квартира {n}', { n: unitNo(u) })}</div>
        <div className="muted">{T('{r} комн.', { r: u.rooms ?? '' })} · {m2(L, u.area)} · {T('{f} этаж', { f: u.floor })}</div>
        {u.plot_area ? <div className="small mt8">{T('Свой сад')} {m2(L, u.plot_area)}</div> : u.ext_area ? <div className="small mt8">{T('Терраса')} {m2(L, u.ext_area)}</div> : null}
        <div className="big mt16" style={{ fontSize: 32 }}>{free && u.usd ? usd(L, u.usd) : T('Недоступна')}</div>
        {free && u.usd && <div className="small muted">{usd(L, u.usd / (u.area + (u.plot_area || u.ext_area || 0)))}/m² · {T('расходы на сделку отдельно')}</div>}
        {searchParams.booked && <div className="okbox mt16">{T('Квартира забронирована на 14 дней. Консультант подтвердит бронь у застройщика.')}</div>}
        {free && u.sales_status === 'sales' && c.show?.clientId && (
          <>
            <form action={likeInShow.bind(null, u.id)} className="mt16"><button className="btn btn--lg btn--block">{liked ? '♥ ' + T('Нравится') : '♡ ' + T('Нравится')}</button></form>
            <ShowBook lang={L} unitId={u.id} clientId={c.show.clientId} />
          </>
        )}
        <div className="tiny muted mt16">{T('Квартиры сдаются без ремонта; на фото — пример дизайна застройщика.')}</div>
      </div>
      {free && u.usd && <PlanList plans={plans} price={u.usd} lang={L} />}
      </div>
    </div>
  )
}
