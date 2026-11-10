import { cookies } from 'next/headers'
import { variantsOf } from '@/lib/variants'
import { activeGrid } from '@/lib/calc'
import { VariantCalc } from '@/components/VariantCalc'
import { fmtDelivery } from '@/lib/delivery'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, m2, date, dateTime, num } from '@/lib/i18n'
import { unitById, unitsOfBuilding, viewMode, codeFor, planUrl, unitNo, projectBySlug, projectVisible, plansFor, downGridFor, conditionsFor, riserInfo, orientOf, orientText, riser } from '@/lib/catalog'
import { Calculator } from '@/components/Calculator'
import { fxFor } from '@/lib/fx'
import { promoForUnit, offersFor, promoOf } from '@/lib/promo'
import { priceChain } from '@/lib/plans'
import { canBook, seesSource, isExternal, maxDiscount, discountCeiling } from '@/lib/perm'
import { unitHistory } from '@/lib/unitEvents'
import { polyStr } from '@/lib/geom'
import { optionsFor } from '@/lib/options'
import { clientScope } from '@/lib/scope'
import { Top, Pill, DESIGN, LOBBY } from '@/components/ui'
import { addToSelection, holdUnit, startShow } from '@/lib/actions'
import { joinWaitlist } from '@/lib/waitActions'
import { unlockUnits } from '@/lib/sourceActions'
import { needUuid } from '@/lib/ids'

const ST_NAME: Record<string, string> = { available: 'свободна', reserved: 'бронь застройщика', sold: 'продана', unavailable: 'не в продаже' }
const CODE_NAME: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ours' | 'ink']> = {
  F: ['Свободно', 'ok'], B: ['Бронь застройщика', 'warn'], S: ['Продано', 'bad'], N: ['Не в продаже', 'off'], SB: ['Передана агентству (Sea Breeze)', 'off'],
  O: ['Наша бронь', 'ours'], M: ['Ваша бронь', 'ours'], D: ['Наша сделка', 'ink'], X: ['Недоступно', 'off'],
}

export default async function UnitPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ img?: string; err?: string; held?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  needUuid(params.id)
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const u = await unitById(params.id)
  if (!u || (isExternal(c.user.role) && !(await projectVisible(u.project_id, c.user)))) notFound()
  const mode = viewMode(c.user, false)
  // QA 10.11 (строка 11 свода, этап 3 калькулятора): чужая бронь партнёру — не 404, а «бронь» с листом ожидания; его варианты и подборки остаются доступны.
  // Кто бронирует и по какой цене — по-прежнему только команде (блок «Только для команды»)
  const raw = codeFor(u, c.user, mode)
  const code = raw === 'X' && mode === 'agent' && !u.hidden && !u.deal_id && !!u.booking_id && u.status !== 'sold' ? 'O' : raw
  if (code === 'X') notFound()
  const proj = (await q<{ slug: string; name: string }>('select slug, name from projects where id = $1', [u.project_id]))[0]
  const ext = isExternal(c.user.role)
  const outdoor = (u.plot_area || 0) + (u.ext_area || 0)
  const perM2 = u.usd ? u.usd / (u.area + outdoor) : null
  const imgs: [string, string][] = [['plan', T('План')]]
  if (proj.slug === 'premium-residence') { if (LOBBY[u.block]) imgs.push(['/img/' + LOBBY[u.block] + '.jpg', T('Лобби блока')]); if (DESIGN[u.rooms || 0]) imgs.push(['/img/' + DESIGN[u.rooms || 0][0] + '.jpg', T('Пример дизайна')]) }
  // План этажа с этой квартирой (поэтажные планы застройщика, Объекты → Разметка): вкладка «На этаже»
  const fp = await one<{ file_id: string; cells: { riser: string; points: number[][] }[]; north_deg: number }>('select file_id, cells, north_deg from portal.floor_plans where building_id = $1 and $2 between floor_from and floor_to order by floor_to - floor_from limit 1', [u.building_id, u.floor])
  const myCell = fp?.cells.find((x) => x.riser === riser(u))
  if (fp) imgs.splice(1, 0, ['floor', T('На этаже')])
  const cur = imgs.some(([k]) => k === searchParams.img) ? searchParams.img! : 'plan'
  const cs = clientScope(c.user)
  const clients = await q<{ id: string; name: string }>(`select id, name from portal.clients cl where ${cs.sql} and stage not in ('handed') and cl.anonymized_at is null order by (cl.id::text = '${((await cookies()).get('ge_client')?.value || '').replace(/[^0-9a-f-]/g, '')}') desc, last_activity_at desc limit 100`, cs.params)
  const simOffers = await offersFor(u.project_id) // «Похожие свободные» — тоже с ценой по акции, как сверху
  const similar = (await unitsOfBuilding(u.building_id)).filter((x) => x.id !== u.id && x.rooms === u.rooms && codeFor(x, c.user, mode) === 'F').slice(0, 4)
  const hist = ext ? [] : await unitHistory(u.id, 12)
  const inSel = await q<{ id: string; client: string }>(`select s.id, cl.name client from portal.selection_items si join portal.selections s on s.id = si.selection_id join portal.clients cl on cl.id = s.client_id where si.unit_id = $1 and (${ext ? 's.user_id = $2' : 'true'})`, ext ? [u.id, c.user.id] : [u.id])
  const bk = u.booking_id ? (await q<{ client: string; agent: string; status: string; ends_at: string; final_price: number }>(`select cl.name client, us.name agent, b.status, b.ends_at, b.final_price::float from portal.bookings b join portal.clients cl on cl.id = b.client_id join portal.users us on us.id = b.agent_id where b.id = $1`, [u.booking_id]))[0] : null
  const plans = await plansFor(u.project_id, u.building_id)
  const opts = await optionsFor(u)
  const fx = await fxFor(c.user.market, L)
  const { promo, mode: promoMode } = await promoForUnit(u)
  // калькулятор вариантов: сетка скидок за взнос (по блоку и датам), предел и порог скидки роли, доход «для себя»
  const calcCond = await conditionsFor(u.project_id, c.user)
  const grid = activeGrid(await downGridFor(u.project_id), new Date().toISOString().slice(0, 10), u.building_id)
  const role = c.user.role
  const calcSelf: 'agent' | 'ours' | 'seller' | null = ext ? (role === 'agency_head' || !c.user.agency_id ? 'agent' : null) : ['owner', 'market_head'].includes(role) ? 'ours' : role === 'seller' ? 'seller' : null
  // этап 2: сохранённые варианты квартиры (свои; владельцу и руководителю рынка — все, для согласования)
  const variants = (await variantsOf(u.id, c.user)).map((v) => ({ id: v.id, name: v.name, author: v.author, client: v.client, client_id: v.client_id, mine: v.author_id === c.user.id, needs_approval: v.needs_approval, approved_at: v.approved_at, created_at: v.created_at, params: v.params, snapshot: v.snapshot }))
  const promoPrice = promo && u.usd ? priceChain(u.usd, null, promo, promoMode).base : null
  const ori = orientOf(u, await riserInfo(u.building_id)), oriText = [orientText(L, ori), ori.note || ''].filter(Boolean).join(' · ')
  const [cn, ck] = ext && code === 'O' ? (['Забронирована', 'warn'] as const) : CODE_NAME[code]
  // Лист ожидания (М12): на занятую, но не проданную квартиру
  const waitable = ['B', 'O', 'D', 'SB', 'N'].includes(code) && u.status !== 'sold'
  const myWait = waitable ? await q<{ client: string | null; pos: number }>(`select cl.name client, (select count(*)::int from portal.waitlist w2 where w2.unit_id = w.unit_id and w2.active and w2.created_at <= w.created_at) pos
    from portal.waitlist w left join portal.clients cl on cl.id = w.client_id where w.unit_id = $1 and w.user_id = $2 and w.active`, [u.id, c.user.id]) : []
  const queue = waitable ? (await q<{ n: number }>('select count(*)::int n from portal.waitlist where unit_id = $1 and active', [u.id]))[0].n : 0
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [proj.name, `/projects/${proj.slug}`], [u.building, `/projects/${proj.slug}/chess?b=${u.building_id}`], [unitNo(u)]]}
        title={T('Квартира {n}', { n: unitNo(u) })} sub={`${T('{r} комн.', { r: u.rooms ?? '—' })} · ${m2(L, u.area)} · ${T('{f} этаж', { f: u.floor })} · ${u.building}`}
        right={<Pill kind={ck}>{T(cn)}</Pill>} />
      <div className="page split">
        <div className="stack" style={{ minWidth: 0 }}><div className="card">
          <div className="chips">{imgs.map(([k, l]) => <Link key={k} href={`?img=${encodeURIComponent(k)}`} className={'chip' + (cur === k ? ' on' : '')}>{l}</Link>)}</div>
          <div className="mt16">
            {cur === 'floor' && fp ? (
              <Link href={`/projects/${proj.slug}/floor?b=${u.building_id}&f=${u.floor}&u=${u.id}`} className="fz" style={{ display: 'block' }}>
                <img src={`/files/${fp.file_id}`} alt="" />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none">{fp.cells.map((x) => <polygon key={x.riser} points={polyStr(x.points)} className={x.riser === myCell?.riser ? 'z-here' : 'z-dim'} />)}</svg>
              </Link>
            ) : cur === 'plan' ? (planUrl(u.plan_file) ? <div className="planbox"><img src={planUrl(u.plan_file)!} alt="" /></div> : <div className="planbox muted" style={{ height: 300 }}>{T('План появится после загрузки от застройщика')}</div>)
              : <div className="ph"><img src={cur} alt="" /></div>}
          </div>
          {cur === 'floor' ? <div className="small muted mt8">{myCell ? T('Квартира на плане этажа — нажмите, чтобы открыть этаж целиком.') : T('План этажа — квартира на нём ещё не размечена.')}</div> : cur !== 'plan' && <div className="small muted mt8">{T('Визуализация. Квартиры сдаются без ремонта.')}</div>}
        </div>
          {/* калькулятор вариантов — под планировкой, на всю ширину левой колонки (место для сравнения вариантов) */}
          {u.usd && <VariantCalc key={u.id} list={u.usd} plans={plans} grid={grid} lang={L} fx={fx} promo={promo} mode={promoMode} options={opts} cond={calcCond ? { fix_pct: calcCond.fix_pct, pool_pct: calcCond.pool_pct, agent_fix_pct: calcCond.agent_fix_pct, agent_pool_pct: calcCond.agent_pool_pct, agent_our_pool_share: calcCond.agent_our_pool_share, seller_share_pct: calcCond.seller_share_pct } : null} ext={ext} cap={calcCond ? maxDiscount(role, calcCond) : 0} ceiling={calcCond && canBook(role) ? (ext ? maxDiscount(role, calcCond) : discountCeiling(role, calcCond)) : 0} ask={ext} self={calcSelf} unitId={u.id} variants={variants} clients={clients.map((x) => ({ id: x.id, name: x.name }))} canApprove={['owner', 'market_head'].includes(role)} ownerView={c.user.role === 'owner'} bookable={code === 'F' && canBook(c.user.role) && u.sales_status === 'sales'} />}
        </div>
        <div className="stack">
          <div className="card">
            {promo && <div className="row" style={{ gap: 6, marginBottom: 6 }}><Pill kind="ok">{promo.badge || T('Акция')}</Pill><span className="small muted">{promo.name}{promo.ends_on ? ' · ' + T('до {d}', { d: date(L, promo.ends_on) }) : ''}</span></div>}
            <div className="big num">{promoPrice ? <>{usd(L, promoPrice)} <s className="muted small">{usd(L, u.usd!)}</s></> : u.usd ? usd(L, u.usd) : T('Цена по запросу')}</div>
            {perM2 && <div className="small muted">{usd(L, perM2)}/{L === 'ru' ? 'м²' : 'm²'}{outdoor ? ' · ' + T('с учётом сада или террасы') : ''} · {T('прайс застройщика, USD')}{u.currency !== 'USD' ? <> (<bdi>{T('пересчёт из {c}', { c: u.currency })}</bdi>)</> : ''}</div>}
            <div className="mt16">
              <div className="kv"><span>{T('Общая площадь')}</span><span>{m2(L, u.area)}</span></div>
              {u.plot_area ? <div className="kv"><span>{T('Свой сад')}</span><span>{m2(L, u.plot_area)}</span></div> : null}
              {u.ext_area ? <div className="kv"><span>{T('Терраса')}</span><span>{m2(L, u.ext_area)}</span></div> : null}
              <div className="kv"><span>{T('Комнаты')}</span><span>{u.rooms ?? '—'}</span></div>
              <div className="kv"><span>{T('Этаж')}</span><span>{u.floor}</span></div>
              {u.layout_code && <div className="kv"><span>{T('Планировка')}</span><span>{u.layout_code}</span></div>}
              {oriText && <div className="kv"><span>{T('Вид из окон')}</span><span>{oriText}</span></div>}
              <div className="kv"><span>{T('Отделка')}</span><span>{T('без ремонта')}</span></div>
              <div className="kv"><span>{T('Сдача')}</span><span>{fmtDelivery(L, u.delivery) || T('уточняется у застройщика')}</span></div>
            </div>
            {searchParams.err && <div className="err mt16">{searchParams.err}</div>}
            {searchParams.held && <div className="okbox mt16">{T('Квартира придержана на 24 часа — за это время запросите бронь')}</div>}
            {code === 'F' && canBook(c.user.role) && u.sales_status === 'sales' && <Link className="btn btn--p btn--lg btn--block mt16" href={`/units/${u.id}/book`}>{T('Запросить бронь')}</Link>}
            {code === 'F' && canBook(c.user.role) && u.sales_status === 'sales' && clients.length > 0 && (
              <form action={holdUnit} className="row mt8"><input type="hidden" name="unit" value={u.id} />
                <select className="in" name="client" style={{ flex: 1 }}>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button className="btn">{T('Придержать 24 ч')}</button></form>
            )}
            {code === 'M' && u.booking_status === 'hold' && <Link className="btn btn--p btn--lg btn--block mt16" href={`/units/${u.id}/book`}>{T('Ваш холд до {d} · запросить бронь', { d: date(L, u.booking_ends) })}</Link>}
            {u.sales_status === 'stop' && <div className="note mt16">{T('Проект на стоп-продажах — новые брони не принимаются')}</div>}
            {code === 'M' && u.booking_status !== 'hold' && <Link className="btn btn--lg btn--block mt16" href="/bookings">{T('Ваша бронь до {d} →', { d: date(L, u.booking_ends) })}</Link>}
            {code === 'F' && clients.length > 0 && (
              <form action={addToSelection} className="row mt8">
                <input type="hidden" name="unit" value={u.id} />
                <select className="in" name="client" style={{ flex: 1 }}>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button className="btn">{T('В подборку')}</button>
              </form>
            )}
            {waitable && (
              <div className="mt16">
                {myWait.map((w, i) => <div key={i} className="note small">{T('Вы в листе ожидания: {n}-й', { n: w.pos })}{w.client ? ' · ' + w.client : ''}</div>)}
                <form action={joinWaitlist} className="row mt8">
                  <input type="hidden" name="unit" value={u.id} />
                  <select className="in" name="client" style={{ flex: 1 }}><option value="">{T('Без клиента')}</option>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <button className="btn">{T('В лист ожидания')}</button>
                </form>
                <div className="tiny muted mt8">{T('В очереди: {n}. Освободится — первый узнает сразу, следующий через паузу проекта.', { n: queue })}</div>
              </div>
            )}
            {code === 'F' && (
              <form action={startShow} className="mt8"><input type="hidden" name="to" value={`/show/unit/${u.id}`} /><input type="hidden" name="lang" value={L} /><button className="btn btn--b btn--block">{T('Показать клиенту')}</button></form>
            )}
          </div>
          {!ext && (
            <div className="card card--sand">
              <div className="label" style={{ color: 'var(--bronze)' }}>{T('Только для команды')}</div>
              {seesSource(c.user.role) && <>
                <div className="kv mt8"><span>{T('Источник')}</span><span className="small">{u.source_id}</span></div>
                <div className="kv"><span>{T('Статус в источнике')}</span><span>{u.external_status || u.status}</span></div>
                <div className="kv"><span>{T('Подтверждено')}</span><span>{dateTime(L, u.synced_at)}</span></div>
                <div className="kv"><span>{T('Ручные правки')}</span><span className="small">{u.locked.length ? '🔒 ' + u.locked.map((x) => T(x === 'price_list' ? 'цена' : x === 'status' ? 'статус' : x)).join(', ') + ' · ' + T('синхронизация не меняет') : T('нет · синхронизация может менять цену и статус')}</span></div>
                {u.locked.length > 0 && ['owner', 'office'].includes(c.user.role) && !c.impersonating && <form action={unlockUnits} className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <input type="hidden" name="unit" value={u.id} />
                  {u.locked.length > 1 && u.locked.map((x) => <button key={x} name="field" value={x} className="btn btn--sm">{T('Вернуть синхронизацию: {f}', { f: T(x === 'price_list' ? 'цена' : x === 'status' ? 'статус' : x) })}</button>)}
                  <button name="field" value="" className="btn btn--sm">{T(u.locked.length > 1 ? 'Вернуть синхронизацию: всё' : 'Вернуть синхронизацию')}</button>
                </form>}
              </>}
              {bk && <div className="kv"><span>{T('Бронь')}</span><span className="small">{bk.client} · {bk.agent} · {T('до {d}', { d: date(L, bk.ends_at) })} · {usd(L, bk.final_price)}</span></div>}
              {hist.length > 0 && <><div className="label mt16">{T('История: статус и цена')}</div>{hist.map((h, i) => {
                const money = (v: number | null) => (v == null ? '—' : (h.currency || '') + ' ' + num(L, Math.round(v)))
                const what = h.kind === 'status' ? `${T(ST_NAME[h.old_value || ''] || h.old_value || '—')} → ${T(ST_NAME[h.new_value || ''] || h.new_value || '—')}`
                  : h.kind === 'price' ? `${money(h.old_price)} → ${money(h.new_price)}${h.old_price && h.new_price ? ` (${h.new_price >= h.old_price ? '+' : ''}${((h.new_price / h.old_price - 1) * 100).toFixed(1)}%)` : ''}` : T('заведена') + (h.new_price ? ' · ' + money(h.new_price) : '')
                const who = h.list ? T('прайс-лист «{t}»', { t: h.list }) : h.source.startsWith('sync:') ? T('синхронизация') + ' ' + h.source.slice(5) : h.source === 'portal' ? T('портал') : T('вручную в базе')
                return <div key={i} className="kv"><span className="small">{dateTime(L, h.at)}</span><span className="small" style={{ textAlign: 'end' }}>{what}<div className="tiny muted">{[who, h.who].filter(Boolean).join(' · ')}</div></span></div>
              })}</>}
              <div className="kv"><span>{T('В подборках')}</span><span className="small">{inSel.length ? inSel.map((x) => x.client).join(', ') : '—'}</span></div>
            </div>
          )}
          {similar.length > 0 && (
            <div className="card">
              <div className="h3">{T('Похожие свободные')}</div>
              {similar.map((x) => <Link key={x.id} href={`/units/${x.id}`} className="kv"><span style={{ color: 'var(--ink)' }}>{unitNo(x)} · {T('{f} эт.', { f: x.floor })} · {m2(L, x.area)}</span><span>{x.usd ? usd(L, (() => { const pr = promoOf(x, simOffers); return pr ? priceChain(x.usd!, null, pr, promoMode).base : x.usd! })()) : ''}</span></Link>)}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
