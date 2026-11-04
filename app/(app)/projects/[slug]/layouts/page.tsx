import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one } from '@/lib/db'
import { t, usd, num } from '@/lib/i18n'
import { projectBySlug, buildingsOf, unitsOfProject, viewMode, codeFor, planUrl, TYPE_NAME } from '@/lib/catalog'
import { offersFor, promoOf } from '@/lib/promo'
import { ViewTabs } from '@/components/ViewTabs'
import { Top } from '@/components/ui'

// Вид «Планировки» (как у Profitbase): каждая планировка проекта — картинка, площадь, сколько свободно и почём;
// нажатие ведёт в шахматку блока с подсветкой этой планировки
export default async function Layouts({ params, searchParams }: { params: { slug: string }; searchParams: { b?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const b = bs.find((x) => x.id === searchParams.b) || null
  const mode = viewMode(c.user, false)
  const offers = await offersFor(p.id)
  const units = (await unitsOfProject(p.id)).filter((u) => !b || u.building_id === b.id).map((u) => { const code = codeFor(u, c.user, mode); const pr = code === 'F' ? promoOf(u, offers) : null; return { ...u, code, net: u.usd != null ? u.usd - (pr?.usd || 0) : null } })
  const groups = new Map<string, typeof units>()
  for (const u of units) if (u.code !== 'X') { const k = u.layout_code || `${u.unit_type}|${Math.round(u.area)}`; groups.set(k, [...(groups.get(k) || []), u]) }
  const rows = Array.from(groups.entries()).map(([k, us]) => {
    const free = us.filter((u) => u.code === 'F'), prices = free.map((u) => u.net || 0).filter(Boolean)
    const areas = us.map((u) => u.area)
    return { k, code: us[0].layout_code, plan: planUrl(us.find((u) => u.plan_file)?.plan_file || null), type: us[0].unit_type, rooms: us[0].rooms, total: us.length, free: free.length,
      amin: Math.min(...areas), amax: Math.max(...areas), pmin: prices.length ? Math.min(...prices) : null, pmax: prices.length ? Math.max(...prices) : null,
      m2: prices.length ? Math.min(...free.filter((u) => u.net).map((u) => u.net! / u.area)) : null, block: us[0].building_id, blocks: new Set(us.map((u) => u.building_id)).size }
  }).sort((a, z) => (z.free ? 1 : 0) - (a.free ? 1 : 0) || (a.rooms || 0) - (z.rooms || 0) || a.amin - z.amin)
  const hasFacade = !!(await one('select 1 from portal.facades f join buildings b on b.id = f.building_id where b.project_id = $1 and quad is not null limit 1', [p.id]))
  const bid = b?.id || bs[0]?.id
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name, `/projects/${p.slug}`], [T('Планировки')]]} title={T('{p} · планировки', { p: p.name })}
        sub={T('{n} планировок · свободно {f} квартир', { n: rows.length, f: rows.reduce((a, r) => a + r.free, 0) })}
        right={<ViewTabs lang={L} base={`/projects/${p.slug}`} b={bid} active="layouts" facade={hasFacade} />} />
      <div className="page">
        <div className="chips"><Link href="?" className={'chip' + (!b ? ' on' : '')}>{T('Все корпуса')}</Link>{bs.map((x) => <Link key={x.id} href={`?b=${x.id}`} className={'chip' + (b?.id === x.id ? ' on' : '')}>{x.name} <span className="n">{x.free}</span></Link>)}</div>
        <div className="ucards mt16">
          {rows.map((r) => (
            <Link key={r.k} href={`/projects/${p.slug}/chess?b=${b?.id || r.block}${r.code ? '&l=' + encodeURIComponent(r.code) : ''}`} className="ucard" style={r.free ? undefined : { opacity: 0.6 }}>
              <div className="ucard__img">{r.plan ? <img src={r.plan} alt="" loading="lazy" /> : <span className="muted tiny">{T('планировка не загружена')}</span>}</div>
              <div className="ucard__b">
                <div className="between"><b>{r.code || T(TYPE_NAME[r.type] || r.type)}</b><span className={'pill ' + (r.free ? 'pill--ok' : 'pill--off')}>{T('{f} из {n}', { f: r.free, n: r.total })}</span></div>
                <div className="small mt8">{r.rooms ? T('{r} комн.', { r: r.rooms }) : T(TYPE_NAME[r.type] || r.type)} · {r.amin === r.amax ? num(L, r.amin, 1) : `${num(L, r.amin, 1)}–${num(L, r.amax, 1)}`} м²</div>
                {!b && r.blocks > 1 && <div className="tiny muted">{T('в корпусах: {n}', { n: r.blocks })}</div>}
                <div className="mt8">{r.pmin ? <><b>{r.pmin === r.pmax ? usd(L, r.pmin) : `${usd(L, r.pmin)} – ${usd(L, r.pmax!)}`}</b><div className="tiny muted">{T('от {p}/м²', { p: usd(L, r.m2!) })}</div></> : <span className="small muted">{T('свободных нет')}</span>}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
