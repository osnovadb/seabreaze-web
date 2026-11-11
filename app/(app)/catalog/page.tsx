import { embedClient } from '@/lib/embed'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { requireCtx } from '@/lib/auth'
import { t, usd, m2, m2u } from '@/lib/i18n'
import { listProjects, unitsOfProjects, viewMode, codeFor, unitNo, planUrl, TYPE_NAME, VIEW_NAME, isLiving, type Code } from '@/lib/catalog'
import { offersFor, promoOf, promoBadge } from '@/lib/promo'
import { normFilter, matchUnit } from '@/lib/unitMatch.mjs'
import { Top, Pill } from '@/components/ui'
import { saveSearch } from '@/lib/waitActions'

type SP = Record<string, string | undefined>
const PER = 48
const STATUS: Partial<Record<Code, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ours' | 'ink']>> = { F: ['свободно', 'ok'], M: ['ваша бронь', 'ours'], O: ['наша бронь', 'ours'], D: ['сделка', 'ink'], B: ['бронь застройщика', 'warn'], S: ['продано', 'bad'] }

// Каталог (М12): все открытые проекты сразу, фильтры диапазонами, карточки с планировкой или таблица, по 48 на страницу.
// Фильтр общий с сохранёнными поисками (lib/unitMatch.mjs): что видно здесь, то и придёт уведомлением.
export default async function Catalog(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  // Галочки (тип, комнаты) приходят повторяющимися параметрами — склеиваем через запятую
  const sp: SP = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]))
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects(c.user)
  const p = ps.find((x) => x.slug === sp.p) || null
  const mode = viewMode(c.user, false)
  // внутри Bitrix24 подбор идёт для клиента вкладки: «бронь клиента» — только его брони
  const cur = await embedClient()
  const all = mode === 'team' && sp.all === '1'
  const k = (v?: string) => (v && Number(v) ? Number(v) * 1000 : undefined) // цена в фильтре — в тысячах долларов
  const nf = normFilter({ project: p?.id, building: sp.b, types: sp.t, rooms: sp.r, pmin: k(sp.pmin), pmax: k(sp.pmax ?? sp.max), amin: sp.amin, amax: sp.amax, fmin: sp.fmin, fmax: sp.fmax, view: sp.v, outdoor: sp.o, corner: sp.c, promo: sp.promo })
  const offers = new Map(await Promise.all(ps.map(async (x) => [x.id, await offersFor(x.id)] as const)))
  const base = (await unitsOfProjects((p ? [p] : ps).map((x) => x.id))).map((u) => { const promo = promoOf(u, offers.get(u.project_id) || []); return { ...u, code: codeFor(u, c.user, mode, cur), promo, net: u.usd != null ? u.usd - (promo?.usd || 0) : null } })
  const pool = base.filter((u) => all || u.code === 'F' || u.code === 'M')
  const units = pool.filter((u) => matchUnit(u, nf))
  const out = (u: (typeof units)[number]) => (u.plot_area || 0) + (u.ext_area || 0)
  // Цена для сортировки, фильтра и $/м² — с акцией, как показана в карточке
  const per = (u: (typeof units)[number]) => (u.net ? u.net / u.area : 0)
  const sort = sp.s || 'price'
  units.sort((a, b) => (sort === 'price' ? (a.net || 0) - (b.net || 0) : sort === 'm2' ? per(a) - per(b) : sort === 'area' ? b.area - a.area : sort === 'floor' ? b.floor - a.floor : (b.promo?.usd || 0) - (a.promo?.usd || 0)))
  const view = sp.view === 'table' ? 'table' : 'cards'
  const pages = Math.max(1, Math.ceil(units.length / PER)), page = Math.min(pages, Math.max(1, Number(sp.pg) || 1))
  const shown = units.slice((page - 1) * PER, page * PER)
  const qs = (o: SP) => '?' + new URLSearchParams(Object.entries({ ...sp, pg: undefined, ...o } as SP).filter((e): e is [string, string] => e[1] != null && e[1] !== '')).toString()
  // Варианты фильтров — из того, что реально есть в выборке проекта
  const blocks = p ? Array.from(new Map(pool.map((u) => [u.building_id, u.building])).entries()) : []
  const types = Array.from(new Set(pool.map((u) => u.unit_type))).sort((a, b) => Object.keys(TYPE_NAME).indexOf(a) - Object.keys(TYPE_NAME).indexOf(b))
  const views = Array.from(new Set(pool.map((u) => u.view_side).filter(Boolean))) as string[]
  const prices = pool.map((u) => u.net || 0).filter(Boolean)
  const kpi = units.length ? { min: Math.min(...units.map((u) => u.net || Infinity)), m2: units.reduce((a, u) => a + per(u), 0) / units.length } : null
  const chk = (name: string, val: string) => (sp[name] || '').split(',').includes(val)
  const roomsOn = (sp.r || '').split(',').filter(Boolean)
  return (
    <>
      <Top title={T('Каталог')} sub={T('{n} по фильтру', { n: units.length }) + (kpi ? ' · ' + T('от {p}', { p: usd(L, kpi.min) }) + ' · ' + T('в среднем {p}/м²', { p: usd(L, kpi.m2) }) : '')}
        right={<>
          <div className="chips">{[['cards', 'Карточки'], ['table', 'Таблица']].map(([v, l]) => <Link key={v} href={qs({ view: v === 'cards' ? undefined : v })} className={'chip' + (view === v ? ' on' : '')}>{T(l)}</Link>)}</div>
          <form action={saveSearch}>{Object.entries({ p: p?.slug, b: sp.b, t: sp.t, r: sp.r, pmin: sp.pmin, pmax: sp.pmax ?? sp.max, amin: sp.amin, amax: sp.amax, fmin: sp.fmin, fmax: sp.fmax, v: sp.v, o: sp.o, c: sp.c, promo: sp.promo }).map(([n, v]) => v ? <input key={n} type="hidden" name={n} value={v} /> : null)}
            <button className="btn" disabled={!p} title={p ? '' : T('Выберите проект, чтобы сохранить поиск')}>{T('Сохранить поиск')}</button></form>
        </>} />
      <div className="page cat">
        <form className="card stack cat__f" style={{ gap: 12 }}>
          {view === 'table' && <input type="hidden" name="view" value="table" />}
          {sp.s && <input type="hidden" name="s" value={sp.s} />}
          <label className="field"><span>{T('Проект')}</span>
            <select key={`p:${String(p?.slug || '')}`} className="in" name="p" defaultValue={p?.slug || ''}><option value="">{T('Все проекты')}</option>{ps.map((x) => <option key={x.id} value={x.slug}>{x.name} · {x.free}</option>)}</select></label>
          {p && blocks.length > 1 && <label className="field"><span>{T('Корпус')}</span>
            <select key={`b:${String(sp.b || '')}`} className="in" name="b" defaultValue={sp.b || ''}><option value="">{T('Все корпуса')}</option>{blocks.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>}
          {types.length > 1 && <div className="field"><span>{T('Тип')}</span><div className="chips">{types.map((x) => <label key={x} className="chip chk"><input type="checkbox" name="t" value={x} defaultChecked={chk('t', x)} /> {T(TYPE_NAME[x] || x)}</label>)}</div></div>}
          <div className="field"><span>{T('Комнат')}</span><div className="chips">{[1, 2, 3, 4].map((r) => <label key={r} className="chip chk"><input type="checkbox" name="r" value={r} defaultChecked={roomsOn.includes(String(r))} /> {r === 4 ? '4+' : r}</label>)}</div></div>
          <div className="field"><span>{T('Цена, тыс. $')}{prices.length ? <i className="tiny muted"> · <bdi dir="ltr">{Math.floor(Math.min(...prices) / 1000)}–{Math.ceil(Math.max(...prices) / 1000)}</bdi></i> : null}</span>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input className="in" name="pmin" inputMode="numeric" placeholder={T('от')} defaultValue={sp.pmin} /><input className="in" name="pmax" inputMode="numeric" placeholder={T('до')} defaultValue={sp.pmax ?? sp.max} /></div></div>
          <div className="field"><span>{T('Площадь, м²')}</span>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input className="in" name="amin" inputMode="decimal" placeholder={T('от')} defaultValue={sp.amin} /><input className="in" name="amax" inputMode="decimal" placeholder={T('до')} defaultValue={sp.amax} /></div></div>
          <div className="field"><span>{T('Этаж')}</span>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input className="in" name="fmin" inputMode="numeric" placeholder={T('от')} defaultValue={sp.fmin} /><input className="in" name="fmax" inputMode="numeric" placeholder={T('до')} defaultValue={sp.fmax} /></div></div>
          {views.length > 0 && <label className="field"><span>{T('Вид из окон')}</span>
            <select key={`v:${String(sp.v || '')}`} className="in" name="v" defaultValue={sp.v || ''}><option value="">{T('любой')}</option>{views.map((v) => <option key={v} value={v}>{T(VIEW_NAME[v] || v)}</option>)}</select></label>}
          <div className="stack" style={{ gap: 4 }}>
            <label className="check"><input type="radio" name="o" value="" defaultChecked={!sp.o} /> <span>{T('Сад или терраса — неважно')}</span></label>
            <label className="check"><input type="radio" name="o" value="g" defaultChecked={sp.o === 'g'} /> <span>{T('С садом')}</span></label>
            <label className="check"><input type="radio" name="o" value="t" defaultChecked={sp.o === 't'} /> <span>{T('С террасой')}</span></label>
            <label className="check mt8"><input type="checkbox" name="c" value="1" defaultChecked={!!sp.c} /> <span>{T('Угловая')}</span></label>
            <label className="check"><input type="checkbox" name="promo" value="1" defaultChecked={!!sp.promo} /> <span>{T('Только с акцией')}</span></label>
            {mode === 'team' && <label className="check"><input type="checkbox" name="all" value="1" defaultChecked={all} /> <span>{T('Все статусы, не только свободные')}</span></label>}
          </div>
          <div className="row" style={{ gap: 6 }}><button className="btn btn--p">{T('Показать')}</button><Link className="btn" href="/catalog">{T('Сбросить')}</Link></div>
        </form>
        <div style={{ minWidth: 0 }}>
          <div className="chips">{[['price', 'дешевле'], ['m2', 'по $/м²'], ['area', 'больше площадь'], ['floor', 'выше этаж'], ['promo', 'больше скидка']].map(([s, l]) => <Link key={s} href={qs({ s: s === 'price' ? undefined : s })} className={'chip' + (sort === s ? ' on' : '')}>{T(l)}</Link>)}</div>
          {units.length === 0 && <div className="card muted mt16">{T('Под фильтр ничего не подошло. Ослабьте условия или сохраните поиск — придёт уведомление, когда появится подходящая квартира.')}</div>}
          {view === 'cards' ? (
            <div className="ucards mt16">
              {shown.map((u) => (
                <Link key={u.id} href={`/units/${u.id}`} className="ucard">
                  <div className="ucard__img">{planUrl(u.plan_file) ? <img src={planUrl(u.plan_file)!} alt="" loading="lazy" /> : <span className="muted tiny">{T('планировка не загружена')}</span>}
                    {u.promo && <span className="ucard__promo">{promoBadge(u.promo, T('Акция'))}</span>}</div>
                  <div className="ucard__b">
                    <div className="between"><b>{unitNo(u)}</b>{STATUS[u.code] ? <Pill kind={STATUS[u.code]![1]}>{T(u.code === 'M' && cur ? 'бронь клиента' : STATUS[u.code]![0])}</Pill> : <Pill kind="off">{T('не в продаже')}</Pill>}</div>
                    <div className="tiny muted">{!p ? ps.find((x) => x.id === u.project_id)?.name + ' · ' : ''}{u.building} · {T('{f} этаж', { f: u.floor })}</div>
                    <div className="small mt8">{isLiving(u.unit_type) && u.rooms ? T('{r} комн.', { r: u.rooms }) + ' · ' : T(TYPE_NAME[u.unit_type] || u.unit_type) + ' · '}{m2(L, u.area)}{out(u) ? ` + ${u.plot_area ? T('сад') : T('терраса')} ${m2(L, out(u))}` : ''}</div>
                    {u.view_side && <div className="tiny muted">{T('Вид')} {T(VIEW_NAME[u.view_side] || u.view_side)}{u.is_corner ? ' · ' + T('угловая') : ''}</div>}
                    <div className="between mt8"><span className="h3" style={{ margin: 0 }}>{u.usd ? usd(L, u.promo ? u.usd - u.promo.usd : u.usd) : '—'}</span><span className="tiny muted">{u.usd ? usd(L, per(u)) + '/' + m2u(L) : ''}</span></div>
                    {u.promo && u.usd && <div className="tiny muted"><s>{usd(L, u.usd)}</s></div>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="tbl-wrap mt16">
              <table className="tbl">
                <thead><tr>{['Квартира', 'Корпус', 'Тип', 'Этаж', 'Комнаты', 'Площадь', 'Вид', 'Цена', '$/м²', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id}>
                      <td><Link href={`/units/${u.id}`}><b>{unitNo(u)}</b></Link>{u.promo && <div className="tiny bronze">{promoBadge(u.promo, T('Акция'))}</div>}</td>
                      <td>{u.building}</td><td className="small">{T(TYPE_NAME[u.unit_type] || u.unit_type)}</td><td>{u.floor}</td><td>{isLiving(u.unit_type) ? u.rooms ?? '—' : '—'}</td>
                      <td>{m2(L, u.area)}{out(u) ? <div className="tiny muted">+ {u.plot_area ? T('сад') : T('терраса')} {m2(L, out(u))}</div> : null}</td>
                      <td className="small">{u.view_side ? T(VIEW_NAME[u.view_side] || u.view_side) : '—'}</td>
                      <td className="num"><b>{u.usd ? usd(L, u.promo ? u.usd - u.promo.usd : u.usd) : '—'}</b>{u.promo && u.usd ? <div className="tiny muted"><s>{usd(L, u.usd)}</s></div> : null}</td>
                      <td className="num small muted">{u.usd ? usd(L, per(u)) : ''}</td>
                      <td>{STATUS[u.code] ? <Pill kind={STATUS[u.code]![1]}>{T(u.code === 'M' && cur ? 'бронь клиента' : STATUS[u.code]![0])}</Pill> : <Pill kind="off">{T('не в продаже')}</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && <div className="chips mt16">{Array.from({ length: pages }, (_, i) => i + 1).map((n) => <Link key={n} href={qs({ pg: n === 1 ? undefined : String(n) })} className={'chip' + (n === page ? ' on' : '')}>{n}</Link>)}</div>}
        </div>
      </div>
    </>
  )
}
