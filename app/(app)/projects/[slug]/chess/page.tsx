import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { t, usd, dateTime, pct } from '@/lib/i18n'
import { projectBySlug, buildingsOf, unitsOfBuilding, viewMode, codeFor, conditionsFor, riserInfo, orientOf, orientText, VIEW_NAME } from '@/lib/catalog'
import { ViewTabs } from '@/components/ViewTabs'
import { seesSource, isExternal, canBook } from '@/lib/perm'
import { one } from '@/lib/db'
import { UnitPanel } from '@/components/UnitPanel'
import { Top, Legend } from '@/components/ui'
import { Chess } from '@/components/Chess'

export default async function ChessPage({ params, searchParams }: { params: { slug: string }; searchParams: { b?: string; m?: string; r?: string; u?: string; v?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const b = bs.find((x) => x.id === searchParams.b) || bs[bs.length - 1]
  const units = await unitsOfBuilding(b.id)
  const mode = viewMode(c.user, false)
  const cellMode = (searchParams.m as 'price' | 'rooms' | 'm2') || 'price'
  const rooms = Number(searchParams.r) || undefined
  const counts = units.reduce((a, u) => { const k = codeFor(u, c.user, mode); a[k] = (a[k] || 0) + 1; return a }, {} as Record<string, number>)
  const free = units.filter((u) => codeFor(u, c.user, mode) === 'F')
  const sync = seesSource(c.user.role) ? await one<{ at: string; src: string }>(`select max(u.synced_at) at, min(u.source_id) src from units u where u.building_id = $1`, [b.id]) : null
  // Ориентация стояков: фильтр «вид из окон» и строка в карточке квартиры
  const ri = await riserInfo(b.id)
  const views = Array.from(new Set(units.map((u) => orientOf(u, ri).view).filter(Boolean))) as string[]
  const view = views.includes(searchParams.v || '') ? searchParams.v : undefined
  const match = view ? new Set(units.filter((u) => orientOf(u, ri).view === view).map((u) => u.id)) : undefined
  const orient = (u: (typeof units)[number]) => orientText(L, orientOf(u, ri)) || undefined
  const hasFacade = !!(await one('select 1 from portal.facades where building_id = $1 and quad is not null limit 1', [b.id]))
  const sel = units.find((u) => u.id === searchParams.u && codeFor(u, c.user, mode) !== 'X')
  const selBooking = sel?.booking_id && mode === 'team' ? await one<{ client: string; agent: string; ends_at: string }>(`select cl.name client, us.name agent, b.ends_at from portal.bookings b join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id where b.id = $1`, [sel.booking_id]) : null
  // Партнёру сверху — его лимиты по проекту (прототип 5): брони из лимита, клиенты в работе, ставка
  const lim = isExternal(c.user.role) ? await (async () => {
    const cond = await conditionsFor(p.id, c.user)
    const n = await one<{ b: number; cl: number }>(`select (select count(*)::int from portal.bookings where agent_id = $1 and project_id = $2 and status in ('requested','confirmed')) b,
      (select count(*)::int from portal.clients where owner_id = $1 and stage not in ('lost','handed') and pause_until is null) cl`, [c.user.id, p.id])
    return cond ? { ...n!, max: cond.max_bookings_agent, fix: cond.agent_fix_pct, pool: cond.agent_pool_pct, sales: p.sales_status } : null
  })() : null
  const qs = (o: Record<string, string | number | undefined>) => '?' + new URLSearchParams(Object.entries({ b: b.id, m: cellMode, r: rooms, v: view, u: sel?.id, ...o }).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name, `/projects/${p.slug}`], [T('Шахматка')]]} title={`${p.name} · ${b.name}`}
        sub={sync ? T('Данные на {d} · источник {s}', { d: dateTime(L, sync.at), s: sync.src }) : T('Цены застройщика в USD')}
        right={<><ViewTabs lang={L} base={`/projects/${p.slug}`} b={b.id} active="chess" facade={hasFacade} /><Link className="btn" href={`/catalog?p=${p.slug}`}>{T('Список')}</Link></>} />
      <div className="page">
        <div className="chips">{bs.map((x) => <Link key={x.id} href={`?b=${x.id}&m=${cellMode}`} className={'chip' + (x.id === b.id ? ' on' : '')}>{x.name} <span className="n">{x.free}</span></Link>)}</div>
        <div className="between mt16">
          <div className="chips">
            <Link href={qs({ r: '' })} className={'chip' + (!rooms ? ' on' : '')}>{T('Комнаты: все')}</Link>
            {[1, 2, 3, 4].filter((r) => units.some((u) => u.rooms === r)).map((r) => <Link key={r} href={qs({ r })} className={'chip' + (rooms === r ? ' on' : '')}>{r}</Link>)}
            {views.length > 0 && <><span className="small muted" style={{ marginInlineStart: 8 }}>{T('Вид')}:</span><Link href={qs({ v: '' })} className={'chip' + (!view ? ' on' : '')}>{T('любой')}</Link>{views.map((v) => <Link key={v} href={qs({ v })} className={'chip' + (view === v ? ' on' : '')}>{T(VIEW_NAME[v])}</Link>)}</>}
          </div>
          <div className="chips">{(['price', 'rooms', 'm2'] as const).map((m) => <Link key={m} href={qs({ m })} className={'chip' + (cellMode === m ? ' on' : '')}>{T(m === 'price' ? 'Цена, тыс. $' : m === 'rooms' ? 'Комнаты' : '$/м²')}</Link>)}</div>
        </div>
        {lim && <div className="card card--tight mt16 row" style={{ gap: 18 }}>
          <span className="small">{T('Ваши брони')}: <b>{lim.b} / {lim.max}</b></span>
          <span className="small">{T('Клиентов в работе')}: <b>{lim.cl}</b></span>
          <span className="small">{T('Ваша ставка')}: <b>{pct(L, lim.fix)} + {pct(L, lim.pool)}</b></span>
          {lim.sales === 'stop' && <span className="small warnc">{T('Проект на стоп-продажах — новые брони не принимаются')}</span>}
          {lim.b >= lim.max && <span className="small warnc">{T('Лимит броней исчерпан — снимите одну, чтобы поставить новую')}</span>}
        </div>}
        <div className="mt16"><Legend lang={L} team={mode === 'team'} /></div>
        <div className="chess-wrap mt16">
          <Chess units={units} viewer={c.user} mode={mode} lang={L} cellMode={cellMode} rooms={rooms} match={match} selected={sel?.id} hrefFor={(u) => qs({ u: u.id })} />
          {sel ? <UnitPanel u={sel} code={codeFor(sel, c.user, mode)} lang={L} mode={mode} closeHref={qs({ u: '' })} canBook={canBook(c.user.role) && sel.sales_status === 'sales'} booking={selBooking} orient={orient(sel)} />
            : <div className="card upanel small muted">{T('Нажмите на квартиру в шахматке — она откроется здесь.')}</div>}
        </div>
        <div className="row mt16 small muted">
          <span>{T('Свободно {f} из {n}', { f: free.length, n: units.length })}</span>
          {free.length > 0 && <span>· {T('цены свободных')} {usd(L, Math.min(...free.map((u) => u.usd || 0)))} – {usd(L, Math.max(...free.map((u) => u.usd || 0)))}</span>}
          {mode === 'team' && <span>· {T('наша бронь')} {(counts.O || 0) + (counts.M || 0)} · {T('бронь застройщика')} {counts.B || 0} · {T('продано')} {counts.S || 0}</span>}
          {isExternal(c.user.role) && <span>· {T('Недоступные квартиры показаны серым без причины')}</span>}
        </div>
      </div>
    </>
  )
}
