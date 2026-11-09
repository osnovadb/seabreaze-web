import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { t, usd, dateTime, pct } from '@/lib/i18n'
import { projectBySlug, buildingsOf, unitsOfBuilding, viewMode, codeFor, conditionsFor, riserInfo, orientOf, orientText, VIEW_NAME, riser, unitNo, planUrl, TYPE_NAME } from '@/lib/catalog'
import { offersFor, promoOf, promoBadge } from '@/lib/promo'
import { clientScope } from '@/lib/scope'
import { q } from '@/lib/db'
import { ChessBoard, type CU } from '@/components/ChessBoard'
import { addManyToSelection } from '@/lib/actions'
import { bulkStatus, bulkHide } from '@/lib/objects'
import { ViewTabs } from '@/components/ViewTabs'
import { seesSource, isExternal, canBook } from '@/lib/perm'
import { one } from '@/lib/db'
import { UnitPanel } from '@/components/UnitPanel'
import { Top } from '@/components/ui'

export default async function ChessPage({ params, searchParams }: { params: { slug: string }; searchParams: { b?: string; u?: string; l?: string; side?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  // Без выбора — блок, где больше всего свободных
  const b = bs.find((x) => x.id === searchParams.b) || [...bs].sort((a, z) => z.free - a.free)[0]
  const units = await unitsOfBuilding(b.id)
  const mode = viewMode(c.user, false)
  const curClient = cookies().get('ge_embed')?.value === '1' ? (cookies().get('ge_client')?.value || '').replace(/[^0-9a-f-]/g, '') || null : null // QA 09.11: бронь другого клиента — не «ваша»
  const free = units.filter((u) => codeFor(u, c.user, mode, curClient) === 'F')
  const sync = seesSource(c.user.role) ? await one<{ at: string; src: string }>(`select max(u.synced_at) at, min(u.source_id) src from units u where u.building_id = $1`, [b.id]) : null
  const ri = await riserInfo(b.id)
  const orient = (u: (typeof units)[number]) => orientText(L, orientOf(u, ri)) || undefined
  const hasFacade = !!(await one('select 1 from portal.facades where building_id = $1 and quad is not null limit 1', [b.id]))
  const sel = units.find((u) => u.id === searchParams.u && codeFor(u, c.user, mode, curClient) !== 'X')
  const selBooking = sel?.booking_id && mode === 'team' ? await one<{ client: string; agent: string; ends_at: string }>(`select cl.name client, us.name agent, b.ends_at from portal.bookings b join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id where b.id = $1`, [sel.booking_id]) : null
  // Партнёру сверху — его лимиты по проекту (прототип 5): брони из лимита, клиенты в работе, ставка
  const lim = isExternal(c.user.role) ? await (async () => {
    const cond = await conditionsFor(p.id, c.user)
    const n = await one<{ b: number; cl: number }>(`select (select count(*)::int from portal.bookings where agent_id = $1 and project_id = $2 and status in ('requested','confirmed')) b,
      (select count(*)::int from portal.clients where owner_id = $1 and stage not in ('lost','handed') and pause_until is null) cl`, [c.user.id, p.id])
    return cond ? { ...n!, max: cond.max_bookings_agent, fix: cond.agent_fix_pct, pool: cond.agent_pool_pct, sales: p.sales_status } : null
  })() : null
  const qs = (o: Record<string, string | undefined>) => '?' + new URLSearchParams(Object.entries({ b: b.id, u: sel?.id, ...o }).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
  // Данные для шахматки в браузере: статус по роли, цена с акцией, вид, планировка — фильтры и подсветка без перезагрузки
  const offers = await offersFor(p.id)
  const cu: CU[] = units.map((u) => {
    const code = codeFor(u, c.user, mode, curClient), x = code === 'X', pr = x ? null : promoOf(u, offers)
    return { id: u.id, no: x ? '' : unitNo(u), riser: riser(u), floor: u.floor, code, rooms: x ? null : u.rooms, area: x ? 0 : u.area, out: x ? 0 : (u.plot_area || 0) + (u.ext_area || 0), type: u.unit_type, typeName: TYPE_NAME[u.unit_type] || u.unit_type,
      usd: x ? null : u.usd, net: x || u.usd == null ? null : u.usd - (pr?.usd || 0), promo: pr ? promoBadge(pr, T('Акция')) : null, plan: x ? null : planUrl(u.plan_file),
      view_side: x ? null : orientOf(u, ri).view, orient: x ? '' : orient(u) || '', layout: x ? null : u.layout_code, plot_area: x ? null : u.plot_area, ext_area: x ? null : u.ext_area, is_corner: x ? null : u.is_corner,
      building_id: u.building_id, project_id: u.project_id, hidden: mode === 'team' && u.hidden }
  })
  const views = (Array.from(new Set(cu.map((u) => u.view_side).filter(Boolean))) as string[]).map((v): [string, string] => [v, VIEW_NAME[v] || v])
  // 2.2 · «Стороны дома»: этажи × стояки только той стороны, куда смотрят окна (море, двор, город…) — из ориентации квартир, без разметки фасада
  const side = searchParams.side && views.some(([v]) => v === searchParams.side) ? searchParams.side : null
  const sideStat = views.map(([v, n]) => { const us = cu.filter((u) => u.view_side === v), fr = us.filter((u) => u.code === 'F' && u.net != null)
    return { v, n, total: us.length, free: fr.length, from: fr.length ? Math.min(...fr.map((u) => u.net!)) : null } })
  const shown = side ? cu.filter((u) => u.view_side === side) : cu
  const layouts = Array.from(new Set(cu.map((u) => u.layout).filter(Boolean))).sort() as string[]
  const cs = clientScope(c.user)
  const clients = ['owner', 'market_head', 'seller', 'agency_head', 'agent'].includes(c.user.role) ? await q<{ id: string; name: string }>(`select id, name from portal.clients cl where ${cs.sql} and stage not in ('handed','lost') order by (cl.id::text = '${(cookies().get('ge_client')?.value || '').replace(/[^0-9a-f-]/g, '')}') desc, last_activity_at desc limit 200`, cs.params) : []
  const editor = ['owner', 'office'].includes(c.user.role)
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name, `/projects/${p.slug}`], [T('Шахматка')]]} title={`${p.name} · ${b.name}`}
        sub={sync ? T('Данные на {d} · источник {s}', { d: dateTime(L, sync.at), s: sync.src }) : T('Цены застройщика в USD')}
        right={<><ViewTabs lang={L} base={`/projects/${p.slug}`} b={b.id} active={side ? "sides" : "chess"} facade={hasFacade} /><Link className="btn" href={`/catalog?p=${p.slug}`}>{T('Список')}</Link></>} />
      <div className="page">
        <div className="chips">{bs.map((x) => <Link key={x.id} href={`?b=${x.id}`} className={'chip' + (x.id === b.id ? ' on' : '')}>{x.name} <span className="n">{x.free}</span></Link>)}</div>
        {lim && <div className="card card--tight mt16 row" style={{ gap: 18 }}>
          <span className="small">{T('Ваши брони')}: <b>{lim.b} / {lim.max}</b></span>
          <span className="small">{T('Клиентов в работе')}: <b>{lim.cl}</b></span>
          <span className="small">{T('Ваша ставка')}: <b>{pct(L, lim.fix)} + {pct(L, lim.pool)}</b></span>
          {lim.sales === 'stop' && <span className="small warnc">{T('Проект на стоп-продажах — новые брони не принимаются')}</span>}
          {lim.b >= lim.max && <span className="small warnc">{T('Лимит броней исчерпан — снимите одну, чтобы поставить новую')}</span>}
        </div>}
        {views.length > 1 && <div className="chips mt16"><span className="small muted" style={{ alignSelf: 'center' }}>{T('Сторона дома')}:</span>
          <Link href={qs({ side: undefined, u: undefined })} className={'chip' + (!side ? ' on' : '')}>{T('Все')}</Link>
          {sideStat.map((x) => <Link key={x.v} href={qs({ side: x.v, u: undefined })} className={'chip' + (side === x.v ? ' on' : '')}>{T(x.n)} <span className="n">{x.free}</span>{x.from != null && <span className="tiny muted"> · {T('от')} {usd(L, x.from)}</span>}</Link>)}</div>}
        <div className={sel ? 'chess-wrap mt16' : 'mt16'}>
          <ChessBoard units={shown} lang={L} team={mode === 'team'} selected={sel?.id} hrefFor={Object.fromEntries(shown.map((u) => [u.id, qs({ u: u.id, side: side || undefined })]))} views={views} layouts={layouts}
            clients={clients} projectId={p.id} canPick={clients.length > 0 || editor} initial={searchParams.l ? { l: searchParams.l } : undefined}
            bulk={{ toSelection: addManyToSelection, ...(editor ? { status: bulkStatus } : {}), ...(c.user.role === 'owner' ? { hide: bulkHide } : {}) }} />
          {sel ? <UnitPanel u={sel} code={codeFor(sel, c.user, mode, curClient)} lang={L} mode={mode} closeHref={qs({ u: '' })} canBook={canBook(c.user.role) && sel.sales_status === 'sales'} booking={selBooking} orient={orient(sel)} quickEdit={editor} />
            : null}
        </div>
        <div className="row mt16 small muted">
          {!sel && <span>{T('Наведите на квартиру — краткая карточка; нажмите — подробная справа')}</span>}
          {free.length > 0 && <span>· {T('цены свободных')} {usd(L, Math.min(...free.map((u) => u.usd || 0)))} – {usd(L, Math.max(...free.map((u) => u.usd || 0)))}</span>}
          {isExternal(c.user.role) && <span>· {T('Недоступные квартиры показаны серым без причины')}</span>}
        </div>
      </div>
    </>
  )
}
