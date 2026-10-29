import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { t, usd, m2 } from '@/lib/i18n'
import { projectBySlug, buildingsOf, unitsOfBuilding, viewMode, codeFor, riser, planUrl, unitNo, riserInfo, orientOf, orientText } from '@/lib/catalog'
import { one } from '@/lib/db'
import { polyStr } from '@/lib/geom'
import { ViewTabs } from '@/components/ViewTabs'
import { Top, Legend } from '@/components/ui'

export default async function Floor({ params, searchParams }: { params: { slug: string }; searchParams: { b?: string; f?: string; u?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const b = bs.find((x) => x.id === searchParams.b) || bs[0]
  const all = await unitsOfBuilding(b.id)
  const mode = viewMode(c.user, false)
  const floors = Array.from(new Set(all.map((u) => u.floor))).sort((a, b) => b - a)
  const f = Number(searchParams.f) || floors[0]
  const units = all.filter((u) => u.floor === f).sort((a, b) => (parseInt(riser(a)) || 0) - (parseInt(riser(b)) || 0) || riser(a).localeCompare(riser(b)))
  const half = Math.ceil(units.length / 2)
  const rows = [units.slice(0, half), units.slice(half).reverse()]
  const sel = units.find((u) => u.id === searchParams.u) || units.find((u) => codeFor(u, c.user, mode) === 'F')
  // Настоящий план этажа, если загружен (Объекты → Разметка), и ориентация стояков
  const plan = await one<{ file_id: string; north_deg: number; cells: { riser: string; points: number[][] }[] }>('select file_id, north_deg, cells from portal.floor_plans where building_id = $1 and $2 between floor_from and floor_to order by floor_to - floor_from limit 1', [b.id, f])
  const hasFacade = !!(await one('select 1 from portal.facades where building_id = $1 and quad is not null limit 1', [b.id]))
  const ri = await riserInfo(b.id)
  const orient = (u: (typeof units)[number]) => orientText(L, orientOf(u, ri))
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name, `/projects/${p.slug}`], [b.name, `/projects/${p.slug}/chess?b=${b.id}`], [T('Этаж {f}', { f })]]}
        title={T('{f} этаж · {n} свободно из {t}', { f, n: units.filter((u) => codeFor(u, c.user, mode) === 'F').length, t: units.length })}
        right={<ViewTabs lang={L} base={`/projects/${p.slug}`} b={b.id} active="floor" facade={hasFacade} />} />
      <div className="page" style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
        <div className="card card--tight stack" style={{ gap: 4 }}>
          <div className="label">{T('Этаж')}</div>
          {floors.map((x) => {
            const n = all.filter((u) => u.floor === x && codeFor(u, c.user, mode) === 'F').length
            return <Link key={x} href={`?b=${b.id}&f=${x}`} className={x === f ? 'chip on' : 'chip'} style={{ justifyContent: 'space-between' }}><b>{x}</b><span className="n">{n || '—'}</span></Link>
          })}
        </div>
        <div>
          {plan ? (
            <div className="fz">
              <img src={`/files/${plan.file_id}`} alt="" />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none">
                {plan.cells.map((cell) => {
                  const u = units.find((x) => riser(x) === cell.riser)
                  if (!u) return null
                  const code = codeFor(u, c.user, mode)
                  const poly = <polygon points={polyStr(cell.points)} className={`z-${code}${sel?.id === u.id ? ' z-sel' : ''}`}><title>{code === 'X' ? '' : `${unitNo(u)} · ${orient(u)}`}</title></polygon>
                  return code === 'X' ? <g key={cell.riser}>{poly}</g> : <Link key={cell.riser} href={`?b=${b.id}&f=${f}&u=${u.id}`} scroll={false}>{poly}</Link>
                })}
              </svg>
              <div className="compass" title={T('Север')}><span style={{ transform: `rotate(${plan.north_deg}deg)`, display: 'inline-block' }}>↑</span><span style={{ position: 'absolute', bottom: 4, fontSize: 9 }}>N</span></div>
            </div>
          ) : (
          <div className="floor">
            <div className="label" style={{ marginBottom: 10 }}>{T('Схема этажа · порядок и стороны — по поэтажному плану застройщика')}</div>
            {rows.map((r, i) => {
              const tot = r.reduce((a, u) => a + u.area, 0)
              return (
                <div key={i}>
                  {i === 1 && <div className="floor__corr">{T('коридор · лифты · лестницы')}</div>}
                  <div className="floor__row">
                    {r.map((u) => {
                      const code = codeFor(u, c.user, mode)
                      const inner = <><b>{code === 'X' ? '' : riser(u)}</b><span>{code === 'X' ? '' : `${u.rooms ?? ''}${T('к')} · ${u.area}`}</span><span>{code === 'F' && u.usd ? usd(L, u.usd) : ''}</span></>
                      const st = { flex: `${u.area / tot} 0 0`, outline: sel?.id === u.id ? '2px solid var(--ink)' : undefined }
                      return code === 'X' ? <div key={u.id} className="floor__u c-X" style={st} /> : <Link key={u.id} href={`?b=${b.id}&f=${f}&u=${u.id}`} className={`floor__u c-${code}`} style={st}>{inner}</Link>
                    })}
                  </div>
                </div>
              )
            })}
            <div className="small muted mt16">{T('Ширина квартиры на схеме пропорциональна площади.')}</div>
          </div>
          )}
          <div className="mt16"><Legend lang={L} team={mode === 'team'} /></div>
        </div>
        {sel ? (
          <div className="card">
            <div className="h3">{unitNo(sel)} · {T(codeFor(sel, c.user, mode) === 'F' ? 'свободно' : 'занято')}</div>
            <div className="small muted">{T('{r} комн.', { r: sel.rooms ?? '' })} · {m2(L, sel.area)} · {T('{f} этаж', { f: sel.floor })}</div>
            {orient(sel) && <div className="small mt8">{T('Вид из окон')}: <b>{orient(sel)}</b>{orientOf(sel, ri).note ? ' · ' + orientOf(sel, ri).note : ''}</div>}
            {planUrl(sel.plan_file) && <div className="planbox mt16"><img src={planUrl(sel.plan_file)!} alt="" style={{ maxHeight: 340 }} /></div>}
            {sel.usd && <div className="big mt16">{usd(L, sel.usd)}</div>}
            <Link className="btn btn--p btn--block mt16" href={`/units/${sel.id}`}>{T('Карточка квартиры')}</Link>
          </div>
        ) : <div className="card muted">{T('На этаже нет доступных квартир')}</div>}
      </div>
    </>
  )
}
