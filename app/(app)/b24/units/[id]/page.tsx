import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, date } from '@/lib/i18n'
import { listProjects, buildingsOf } from '@/lib/catalog'
import { Top, Pill } from '@/components/ui'
import { bookingAction } from '@/lib/actions'

// 2.2 · Units в Bitrix24 (вариант B, экраны Сейлз 02–04): подбор по шахматке → квартиры клиента → условия покупки
type U = { unit_id: string; no: string; project: string; slug: string; status: string | null; booking_id: string | null; ends_at: string | null; final: number | null; liked: boolean; in_sel: boolean; usd: number | null; mine: boolean }
const ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { hold: ['холд 24 ч', 'ink'], queued: ['в очереди у застройщика', 'warn'], requested: ['запрос брони', 'warn'], confirmed: ['бронь', 'ok'], release_pending: ['снять у застройщика', 'warn'], converted: ['договор', 'ok'] }

export default async function Units({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; created?: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound()
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const cl = await one<{ id: string; name: string; attach_status: string; protected_until: string | null; b24_deal_id: number | null; market: string | null }>(
    'select id, name, attach_status, protected_until::text, b24_deal_id, market from portal.clients where id = $1', [params.id])
  if (!cl) notFound()
  const units = await q<U>(`with b as (select distinct on (unit_id) * from portal.bookings where client_id = $1 and status in ('hold','queued','requested','confirmed','release_pending','converted') order by unit_id, created_at desc),
      s as (select si.unit_id, bool_or(coalesce(si.liked, false)) liked from portal.selection_items si join portal.selections x on x.id = si.selection_id where x.client_id = $1 group by si.unit_id)
    select u.id unit_id, portal.unit_no(bl.external_id, u.number) no, p.name project, p.slug, b.status, b.id booking_id, b.ends_at::text, b.final_price::float final,
      coalesce(s.liked, false) liked, s.unit_id is not null in_sel, u.price_list::float usd, b.agent_id = $2 mine
    from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id left join b on b.unit_id = u.id left join s on s.unit_id = u.id
    where b.id is not null or s.unit_id is not null order by b.status is null, p.name, no`, [cl.id, c.user.id]).catch(async () =>
      q<U>(`select u.id unit_id, portal.unit_no(bl.external_id, u.number) no, p.name project, p.slug, b.status, b.id booking_id, b.ends_at::text, b.final_price::float final, false liked, true in_sel, u.price_list::float usd, b.agent_id = $2 mine
        from portal.bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id where b.client_id = $1 and b.status in ('hold','queued','requested','confirmed','release_pending','converted')`, [cl.id, c.user.id]))
  const regs = await one<{ ok: number; all: number }>(`select count(*) filter (where status in ('confirmed','confirmed_silence'))::int ok, count(*)::int "all" from portal.registrations where client_id = $1`, [cl.id])
  const tab = searchParams.tab || (units.length ? 'units' : 'pick')
  const ps = tab === 'pick' ? await listProjects(c.user) : []
  const blds = tab === 'pick' ? await Promise.all(ps.map(async (p) => ({ p, bs: await buildingsOf(p.id, c.user) }))) : []
  const active = units.filter((u) => u.status)
  return (
    <>
      <Top title={cl.name} sub={[cl.attach_status === 'candidate' ? T('кандидат партнёра') : cl.protected_until ? T('закреплён до {d}', { d: date(L, cl.protected_until) }) : '', regs?.all ? T('регистрации у застройщиков: {a} из {b}', { a: regs.ok, b: regs.all }) : '', cl.b24_deal_id ? T('сделка Bitrix24 № {n}', { n: cl.b24_deal_id }) : ''].filter(Boolean).join(' · ')}
        right={<Link className="btn" href={`/clients/${cl.id}`}>{T('Карточка клиента')}</Link>} />
      <div className="page">
        {searchParams.created && <div className="okbox" style={{ marginBottom: 12 }}>{T('Запрос брони отправлен бэк-офису — статус появится в сделке Bitrix24')}</div>}
        <div className="chips">{[['pick', 'Подбор'], ['units', `${T('Квартиры клиента')} · ${units.length}`], ['terms', `${T('Условия покупки')} · ${active.length}`]].map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={'chip' + (tab === k ? ' on' : '')}>{k === 'pick' ? T(l) : l}</Link>)}</div>
        {tab === 'pick' && <div className="grid g3 mt16">{blds.map(({ p, bs }) => (
          <div key={p.id} className="card stack" style={{ gap: 8 }}>
            <div className="h3">{p.name}</div>
            <div className="small muted">{T('свободно {n}', { n: p.free })}{p.min_usd ? ' · ' + T('от') + ' ' + usd(L, p.min_usd) : ''}</div>
            <div className="chips">{bs.map((b) => <Link key={b.id} className="chip" href={`/projects/${p.slug}/chess?b=${b.id}`}>{b.name} <span className="n">{b.free}</span></Link>)}</div>
            <div className="row" style={{ gap: 6 }}><Link className="btn btn--sm" href={`/projects/${p.slug}/chess?b=${bs[0]?.id || ''}&side=sea`}>{T('Сторона моря')}</Link><Link className="btn btn--sm" href={`/catalog?p=${p.slug}`}>{T('Списком')}</Link></div>
          </div>))}</div>}
        {tab === 'units' && <div className="tbl-wrap mt16"><table className="tbl">
          <thead><tr>{['Квартира', 'Проект', 'Отметка', 'Холд / бронь', 'Цена', ''].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {units.length === 0 && <tr><td colSpan={6} className="muted">{T('Пока пусто — выберите квартиры во вкладке «Подбор»')}</td></tr>}
            {units.map((u) => <tr key={u.unit_id}>
              <td><Link href={`/units/${u.unit_id}`}><b>{u.no}</b></Link></td>
              <td className="small">{u.project}</td>
              <td>{u.liked ? <Pill kind="ok">♥ {T('нравится')}</Pill> : u.in_sel ? <span className="small muted">{T('в подборке')}</span> : ''}</td>
              <td>{u.status ? <><Pill kind={ST[u.status][1]}>{T(ST[u.status][0])}</Pill>{u.ends_at && <div className="tiny muted">{T('до {d}', { d: date(L, u.ends_at) })}</div>}</> : <span className="small muted">—</span>}</td>
              <td className="num">{usd(L, u.final ?? u.usd ?? 0)}</td>
              <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {(!u.status || (u.status === 'hold' && u.mine)) && <Link className="btn btn--sm btn--p" href={`/units/${u.unit_id}/book?client=${cl.id}`}>{T('Условия покупки →')}</Link>}
                {u.status === 'hold' && u.mine && <form action={bookingAction}><input type="hidden" name="id" value={u.booking_id!} /><input type="hidden" name="act" value="release_hold" /><button className="btn btn--sm">{T('Снять холд')}</button></form>}
              </td>
            </tr>)}
          </tbody></table></div>}
        {tab === 'terms' && <div className="stack mt16">
          {active.length === 0 && <div className="muted">{T('Нет холдов и запросов брони')}</div>}
          {active.map((u) => <div key={u.unit_id} className="card row" style={{ justifyContent: 'space-between' }}>
            <span><b>{u.no}</b> · {u.project} · <Pill kind={ST[u.status!][1]}>{T(ST[u.status!][0])}</Pill>{u.ends_at && <span className="small muted"> · {T('до {d}', { d: date(L, u.ends_at) })}</span>}</span>
            <span className="row" style={{ gap: 8 }}><b>{usd(L, u.final ?? 0)}</b>{u.status === 'hold' && u.mine ? <Link className="btn btn--sm btn--p" href={`/units/${u.unit_id}/book?client=${cl.id}`}>{T('Запросить бронь')}</Link> : <Link className="btn btn--sm" href="/bookings">{T('Брони')}</Link>}</span>
          </div>)}
        </div>}
      </div>
    </>
  )
}
