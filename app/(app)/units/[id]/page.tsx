import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, m2, date, dateTime } from '@/lib/i18n'
import { unitById, unitsOfBuilding, viewMode, codeFor, planUrl, unitNo, projectBySlug, projectVisible, plansFor, riserInfo, riser, VIEW_NAME, DIR_NAME } from '@/lib/catalog'
import { PlanList } from '@/components/PlanList'
import { canBook, seesSource, isExternal } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { Top, Pill, DESIGN, LOBBY } from '@/components/ui'
import { addToSelection, startShow } from '@/lib/actions'

const CODE_NAME: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ours' | 'ink']> = {
  F: ['Свободно', 'ok'], B: ['Бронь застройщика', 'warn'], S: ['Продано', 'bad'], N: ['Не в продаже', 'off'], SB: ['Квота SeaBreeze', 'off'],
  O: ['Наша бронь', 'ours'], M: ['Ваша бронь', 'ours'], D: ['Наша сделка', 'ink'], X: ['Недоступно', 'off'],
}

export default async function UnitPage({ params, searchParams }: { params: { id: string }; searchParams: { img?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const u = await unitById(params.id)
  if (!u || (isExternal(c.user.role) && !(await projectVisible(u.project_id, c.user)))) notFound()
  const mode = viewMode(c.user, false)
  const code = codeFor(u, c.user, mode)
  if (code === 'X') notFound()
  const proj = (await q<{ slug: string; name: string }>('select slug, name from projects where id = $1', [u.project_id]))[0]
  const ext = isExternal(c.user.role)
  const outdoor = (u.plot_area || 0) + (u.ext_area || 0)
  const perM2 = u.usd ? u.usd / (u.area + outdoor) : null
  const imgs: [string, string][] = [['plan', T('План')]]
  if (proj.slug === 'premium-residence') { if (LOBBY[u.block]) imgs.push(['/img/' + LOBBY[u.block] + '.jpg', T('Лобби блока')]); if (DESIGN[u.rooms || 0]) imgs.push(['/img/' + DESIGN[u.rooms || 0][0] + '.jpg', T('Пример дизайна')]) }
  const cur = searchParams.img || 'plan'
  const cs = clientScope(c.user)
  const clients = await q<{ id: string; name: string }>(`select id, name from portal.clients cl where ${cs.sql} and stage not in ('handed') order by last_activity_at desc limit 100`, cs.params)
  const similar = (await unitsOfBuilding(u.building_id)).filter((x) => x.id !== u.id && x.rooms === u.rooms && codeFor(x, c.user, mode) === 'F').slice(0, 4)
  const hist = seesSource(c.user.role) ? await q<{ price: number; currency: string; changed_at: string; changed_by: string }>('select price::float, currency, changed_at, changed_by from price_history where unit_id = $1 order by changed_at desc limit 5', [u.id]) : []
  const inSel = await q<{ id: string; client: string }>(`select s.id, cl.name client from portal.selection_items si join portal.selections s on s.id = si.selection_id join portal.clients cl on cl.id = s.client_id where si.unit_id = $1 and (${ext ? 's.user_id = $2' : 'true'})`, ext ? [u.id, c.user.id] : [u.id])
  const bk = u.booking_id ? (await q<{ client: string; agent: string; status: string; ends_at: string; final_price: number }>(`select cl.name client, us.name agent, b.status, b.ends_at, b.final_price::float from portal.bookings b join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id where b.id = $1`, [u.booking_id]))[0] : null
  const plans = await plansFor(u.project_id, u.building_id)
  const ri = (await riserInfo(u.building_id)).get(riser(u))
  const [cn, ck] = CODE_NAME[code]
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [proj.name, `/projects/${proj.slug}`], [u.building, `/projects/${proj.slug}/chess?b=${u.building_id}`], [unitNo(u)]]}
        title={T('Квартира {n}', { n: unitNo(u) })} sub={`${T('{r} комн.', { r: u.rooms ?? '—' })} · ${m2(L, u.area)} · ${T('{f} этаж', { f: u.floor })} · ${u.building}`}
        right={<Pill kind={ck}>{T(cn)}</Pill>} />
      <div className="page split">
        <div className="card">
          <div className="chips">{imgs.map(([k, l]) => <Link key={k} href={`?img=${encodeURIComponent(k)}`} className={'chip' + (cur === k ? ' on' : '')}>{l}</Link>)}</div>
          <div className="mt16">
            {cur === 'plan' ? (planUrl(u.plan_file) ? <div className="planbox"><img src={planUrl(u.plan_file)!} alt="" /></div> : <div className="planbox muted" style={{ height: 300 }}>{T('План появится после загрузки от застройщика')}</div>)
              : <div className="ph"><img src={cur} alt="" /></div>}
          </div>
          {cur !== 'plan' && <div className="small muted mt8">{T('Визуализация. Квартиры сдаются без ремонта.')}</div>}
        </div>
        <div className="stack">
          <div className="card">
            <div className="big num">{u.usd ? usd(L, u.usd) : T('Цена по запросу')}</div>
            {perM2 && <div className="small muted">{usd(L, perM2)}/{L === 'ru' ? 'м²' : 'm²'}{outdoor ? ' · ' + T('с учётом сада или террасы') : ''} · {T('прайс застройщика, USD')}{u.currency !== 'USD' ? ` (${T('пересчёт из')} ${u.currency})` : ''}</div>}
            <div className="mt16">
              <div className="kv"><span>{T('Общая площадь')}</span><span>{m2(L, u.area)}</span></div>
              {u.plot_area ? <div className="kv"><span>{T('Свой сад')}</span><span>{m2(L, u.plot_area)}</span></div> : null}
              {u.ext_area ? <div className="kv"><span>{T('Терраса')}</span><span>{m2(L, u.ext_area)}</span></div> : null}
              <div className="kv"><span>{T('Комнаты')}</span><span>{u.rooms ?? '—'}</span></div>
              <div className="kv"><span>{T('Этаж')}</span><span>{u.floor}</span></div>
              {u.layout_code && <div className="kv"><span>{T('Планировка')}</span><span>{u.layout_code}</span></div>}
              {ri && (ri.view_side || ri.direction) && <div className="kv"><span>{T('Вид из окон')}</span><span>{[ri.view_side ? T(VIEW_NAME[ri.view_side]) : '', ri.direction ? T('окна на {d}', { d: T(DIR_NAME[ri.direction]) }) : '', ri.note || ''].filter(Boolean).join(' · ')}</span></div>}
              <div className="kv"><span>{T('Отделка')}</span><span>{T('без ремонта')}</span></div>
              <div className="kv"><span>{T('Сдача')}</span><span>{u.delivery || T('уточняется у застройщика')}</span></div>
            </div>
            {code === 'F' && canBook(c.user.role) && u.sales_status === 'sales' && <Link className="btn btn--p btn--lg btn--block mt16" href={`/units/${u.id}/book`}>{T('Забронировать')}</Link>}
            {u.sales_status === 'stop' && <div className="note mt16">{T('Проект на стоп-продажах — новые брони не принимаются')}</div>}
            {code === 'M' && <Link className="btn btn--lg btn--block mt16" href="/bookings">{T('Ваша бронь до {d} →', { d: date(L, u.booking_ends) })}</Link>}
            {code === 'F' && clients.length > 0 && (
              <form action={addToSelection} className="row mt8">
                <input type="hidden" name="unit" value={u.id} />
                <select className="in" name="client" style={{ flex: 1 }}>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button className="btn">{T('В подборку')}</button>
              </form>
            )}
            {code === 'F' && (
              <form action={startShow} className="mt8"><input type="hidden" name="to" value={`/show/unit/${u.id}`} /><input type="hidden" name="lang" value={L} /><button className="btn btn--b btn--block">{T('Показать клиенту')}</button></form>
            )}
          </div>
          {u.usd && <PlanList plans={plans} price={u.usd} lang={L} />}
          {!ext && (
            <div className="card card--sand">
              <div className="label" style={{ color: 'var(--bronze)' }}>{T('Только для команды')}</div>
              {seesSource(c.user.role) && <>
                <div className="kv mt8"><span>{T('Источник')}</span><span className="small">{u.source_id}</span></div>
                <div className="kv"><span>{T('Статус в источнике')}</span><span>{u.external_status || u.status}</span></div>
                <div className="kv"><span>{T('Подтверждено')}</span><span>{dateTime(L, u.synced_at)}</span></div>
                <div className="kv"><span>{T('Ручные правки')}</span><span className="small">{u.locked.length ? '🔒 ' + u.locked.map((x) => T(x === 'price_list' ? 'цена' : x === 'status' ? 'статус' : x)).join(', ') + ' · ' + T('синхронизация не меняет') : T('нет · синхронизация может менять цену и статус')}</span></div>
              </>}
              {bk && <div className="kv"><span>{T('Бронь')}</span><span className="small">{bk.client} · {bk.agent} · {T('до {d}', { d: date(L, bk.ends_at) })} · {usd(L, bk.final_price)}</span></div>}
              {hist.length > 0 && <><div className="label mt16">{T('История цены')}</div>{hist.map((h, i) => <div key={i} className="kv"><span>{date(L, h.changed_at)}</span><span className="small">{h.price ? h.currency + ' ' + Math.round(h.price).toLocaleString('ru') : '—'} · {h.changed_by}</span></div>)}</>}
              <div className="kv"><span>{T('В подборках')}</span><span className="small">{inSel.length ? inSel.map((x) => x.client).join(', ') : '—'}</span></div>
            </div>
          )}
          {similar.length > 0 && (
            <div className="card">
              <div className="h3">{T('Похожие свободные')}</div>
              {similar.map((x) => <Link key={x.id} href={`/units/${x.id}`} className="kv"><span style={{ color: 'var(--ink)' }}>{unitNo(x)} · {T('{f} эт.', { f: x.floor })} · {m2(L, x.area)}</span><span>{x.usd ? usd(L, x.usd) : ''}</span></Link>)}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
