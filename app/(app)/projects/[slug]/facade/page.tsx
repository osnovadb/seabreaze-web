import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { projectBySlug, buildingsOf, unitsOfBuilding, viewMode, codeFor, riserInfo, riser, VIEW_NAME, DIR_NAME } from '@/lib/catalog'
import { canBook } from '@/lib/perm'
import { Top, Legend } from '@/components/ui'
import { FacadeView } from '@/components/FacadeView'
import { UnitPanel } from '@/components/UnitPanel'
import { ViewTabs } from '@/components/ViewTabs'

type F = { id: string; title: string; file_id: string; risers: string[]; floor_from: number; floor_to: number; quad: number[][] }
// Фасад: квартиры прямо на фото дома (как фасадный виджет Profitbase); клик — квартира справа
export default async function Facade({ params, searchParams }: { params: { slug: string }; searchParams: { b?: string; s?: string; u?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const all = await q<F & { building_id: string }>(`select f.id, f.building_id, f.title, f.file_id, f.risers, f.floor_from, f.floor_to, f.quad from portal.facades f join buildings b on b.id = f.building_id where b.project_id = $1 and f.quad is not null order by f.sort, f.created_at`, [p.id])
  const b = bs.find((x) => x.id === searchParams.b) || bs.find((x) => all.some((f) => f.building_id === x.id)) || bs[0]
  const fs = all.filter((f) => f.building_id === b.id)
  const f = fs.find((x) => x.id === searchParams.s) || fs[0]
  const units = await unitsOfBuilding(b.id)
  const mode = viewMode(c.user, false)
  const sel = units.find((u) => u.id === searchParams.u && codeFor(u, c.user, mode) !== 'X')
  const selBooking = sel?.booking_id && mode === 'team' ? await one<{ client: string; agent: string; ends_at: string }>(`select cl.name client, us.name agent, b.ends_at from portal.bookings b join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id where b.id = $1`, [sel.booking_id]) : null
  const ri = sel ? (await riserInfo(b.id)).get(riser(sel)) : undefined
  const orient = ri && (ri.view_side || ri.direction) ? [ri.view_side ? T(VIEW_NAME[ri.view_side]) : '', ri.direction ? T('окна на {d}', { d: T(DIR_NAME[ri.direction]) }) : ''].filter(Boolean).join(' · ') : undefined
  const qs = (o: Record<string, string>) => '?' + new URLSearchParams({ b: b.id, ...(f ? { s: f.id } : {}), ...(sel ? { u: sel.id } : {}), ...o }).toString()
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name, `/projects/${p.slug}`], [T('Фасад')]]} title={`${p.name} · ${b.name}`} sub={f ? f.title : T('Фасад этого дома ещё не размечен')} right={<ViewTabs lang={L} base={`/projects/${p.slug}`} b={b.id} active="facade" facade />} />
      <div className="page">
        <div className="chips">{bs.map((x) => <Link key={x.id} href={`?b=${x.id}`} className={'chip' + (x.id === b.id ? ' on' : '')}>{x.name} <span className="n">{all.filter((ff) => ff.building_id === x.id).length || '—'}</span></Link>)}</div>
        {fs.length > 1 && <div className="chips mt8">{fs.map((x) => <Link key={x.id} href={`?b=${b.id}&s=${x.id}`} className={'chip' + (x.id === f?.id ? ' on' : '')}>{x.title}</Link>)}</div>}
        <div className="mt16"><Legend lang={L} team={mode === 'team'} /></div>
        {f ? (
          <div className="chess-wrap mt16">
            <FacadeView facade={f} units={units} viewer={c.user} mode={mode} selected={sel?.id} hrefFor={(u) => qs({ u: u.id })} />
            {sel ? <UnitPanel u={sel} code={codeFor(sel, c.user, mode)} lang={L} mode={mode} closeHref={qs({ u: '' })} canBook={canBook(c.user.role) && sel.sales_status === 'sales'} booking={selBooking} orient={orient} />
              : <div className="card upanel small muted">{T('Нажмите на окно квартиры — она откроется здесь.')}</div>}
          </div>
        ) : <div className="card muted mt16">{T('Фасад этого дома ещё не размечен — смотрите шахматку.')} <Link className="bronze" href={`/projects/${p.slug}/chess?b=${b.id}`}>{T('Шахматка')} →</Link></div>}
      </div>
    </>
  )
}
