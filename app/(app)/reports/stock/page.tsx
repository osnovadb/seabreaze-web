import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, num, monthName } from '@/lib/i18n'
import { roomsSql, toUsdSql, TYPE_NAME } from '@/lib/catalog'
import { Top } from '@/components/ui'

type St = { key: string; total: number; free: number; ours: number; hold: number; sold: number; off: number; free_m2: number; free_usd: number; sold_m2: number; sold_usd: number }
type Mo = { m: string; sold: number; bookings: number; deals: number; total: number; up: number; down: number; avg_chg: number | null }

// Остатки и темп продаж (группа 4, «дашборд РОП» у Profitbase): что свободно по корпусам и комнатам, цена за м²,
// сколько продаётся в месяц и на сколько месяцев хватит остатка. Продажи застройщика — из журнала квартиры (с 04.11.2026),
// наши брони и сделки — из портала.
export default async function Stock(props: { searchParams: Promise<{ p?: string; by?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!['owner', 'market_head', 'seller', 'office'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await q<{ id: string; slug: string; name: string }>('select id, slug, name from projects order by sort, name')
  const p = ps.find((x) => x.slug === searchParams.p) || null
  const by = searchParams.by === 'rooms' ? 'rooms' : 'building'
  const where = p ? 'u.project_id = $1' : 'true', args = p ? [p.id] : []
  const key = by === 'rooms' ? `case when ${roomsSql} is null then u.unit_type else least(${roomsSql}, 4)::text end` : `${p ? '' : "pr.name || ' · ' || "}b.name`
  const rows = await q<St>(`with x as (
      select ${key} key, u.status, u.area_total_m2::float area, (${toUsdSql})::float usd, b.sort bs, pr.sort ps,
        exists (select 1 from portal.bookings bk where bk.unit_id = u.id and bk.status in ('hold','queued','requested','confirmed','release_pending')) or exists (select 1 from portal.deals d where d.unit_id = u.id and d.stage <> 'cancelled') ours
      from units u join buildings b on b.id = u.building_id join projects pr on pr.id = u.project_id where ${where})
    select key, count(*)::int total,
      count(*) filter (where status = 'available' and usd is not null and not ours)::int free, count(*) filter (where ours)::int ours,
      count(*) filter (where status = 'reserved' and not ours)::int hold, count(*) filter (where status = 'sold' and not ours)::int sold,
      count(*) filter (where status = 'unavailable' and not ours or (status = 'available' and usd is null and not ours))::int off,
      coalesce(sum(area) filter (where status = 'available' and usd is not null and not ours), 0) free_m2, coalesce(sum(usd) filter (where status = 'available' and usd is not null and not ours), 0) free_usd,
      coalesce(sum(area) filter (where status = 'sold' and usd is not null), 0) sold_m2, coalesce(sum(usd) filter (where status = 'sold' and usd is not null), 0) sold_usd
    from x group by key order by min(ps), min(bs), key`, args)
  const tot = rows.reduce((a, r) => { for (const k of Object.keys(r) as (keyof St)[]) if (k !== 'key') (a as any)[k] = ((a as any)[k] || 0) + (r[k] as number); return a }, { key: T('Итого') } as St)
  const months = await q<Mo>(`with m as (select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date m)
    select to_char(m.m, 'YYYY-MM') m,
      (select count(distinct e.unit_id)::int from portal.unit_events e join units u on u.id = e.unit_id where ${where} and e.kind = 'status' and e.new_value = 'sold' and date_trunc('month', e.at)::date = m.m) sold,
      (select count(*)::int from portal.bookings bk join units u on u.id = bk.unit_id where ${where} and date_trunc('month', bk.created_at)::date = m.m) bookings,
      (select count(*)::int from portal.deals d join units u on u.id = d.unit_id where ${where} and d.stage <> 'cancelled' and date_trunc('month', d.created_at)::date = m.m) deals,
      /* продано всего без двойного счёта: наша сделка по квартире потом становится «продана» и у застройщика */
      (select count(distinct x.unit_id)::int from (select e.unit_id from portal.unit_events e join units u on u.id = e.unit_id where ${where} and e.kind = 'status' and e.new_value = 'sold' and date_trunc('month', e.at)::date = m.m
         union select d.unit_id from portal.deals d join units u on u.id = d.unit_id where ${where} and d.stage <> 'cancelled' and date_trunc('month', d.created_at)::date = m.m) x) total,
      (select count(*)::int from portal.unit_events e join units u on u.id = e.unit_id where ${where} and e.kind = 'price' and e.old_price > 0 and e.new_price > e.old_price and date_trunc('month', e.at)::date = m.m) up,
      (select count(*)::int from portal.unit_events e join units u on u.id = e.unit_id where ${where} and e.kind = 'price' and e.old_price > 0 and e.new_price < e.old_price and date_trunc('month', e.at)::date = m.m) down,
      (select avg(e.new_price / e.old_price - 1)::float * 100 from portal.unit_events e join units u on u.id = e.unit_id where ${where} and e.kind = 'price' and e.old_price > 0 and e.new_price > 0 and date_trunc('month', e.at)::date = m.m) avg_chg
    from m order by m.m desc`, args)
  // Темп — средние продажи за 3 последних полных месяца (разные квартиры: продано у застройщика или нашей сделкой); запас = свободно / темп
  const last3 = months.slice(1, 4), pace = last3.reduce((a, m) => a + m.total, 0) / 3
  const ppm = (usdSum: number, m2: number) => (m2 ? usd(L, usdSum / m2) : '—')
  const label = (k: string) => (by === 'rooms' ? (/^\d$/.test(k) ? (k === '4' ? '4+' : k) + ' ' + T('комн.') : T(TYPE_NAME[k] || k)) : k)
  const qs = (o: Record<string, string>) => '?' + new URLSearchParams(Object.entries({ p: p?.slug || '', by, ...o }).filter(([, v]) => v)).toString()
  return (
    <>
      <Top crumbs={[[T('Отчёты'), '/reports'], [T('Остатки и темп')]]} title={T('Остатки и темп продаж')} sub={T('Свободно, бронь, продано и цена за м² по корпусам или комнатам; продажи по месяцам и запас в месяцах')}
        right={<Link className="btn" href="/reports/team">{T('Команда')} →</Link>} />
      <div className="page">
        <div className="between">
          <div className="chips"><Link href={qs({ p: '' })} className={'chip' + (!p ? ' on' : '')}>{T('Все проекты')}</Link>{ps.map((x) => <Link key={x.id} href={qs({ p: x.slug })} className={'chip' + (p?.id === x.id ? ' on' : '')}>{x.name}</Link>)}</div>
          <div className="chips">{[['building', 'По корпусам'], ['rooms', 'По комнатам']].map(([k, l]) => <Link key={k} href={qs({ by: k })} className={'chip' + (by === k ? ' on' : '')}>{T(l)}</Link>)}</div>
        </div>
        <div className="grid g4 mt16">
          {[[num(L, tot.free), T('свободно из {n}', { n: num(L, tot.total) })], [usd(L, tot.free_usd), T('стоимость свободных по прайсу')], [ppm(tot.free_usd, tot.free_m2), T('средняя цена м² свободных')],
            [pace > 0 ? T('{n} мес.', { n: Math.round(tot.free / pace) }) : '—', pace > 0 ? T('запас при темпе {p} кв./мес.', { p: num(L, pace, 1) }) : T('темп ещё не набран — журнал продаж ведётся с 04.11.2026')]].map(([a, b]) => (
            <div key={b} className="card card--tight kpi"><div className="v" style={{ fontSize: 22 }}>{a}</div><div className="small muted">{b}</div></div>))}
        </div>
        <div className="tbl-wrap mt16"><table className="tbl">
          <thead><tr>{[by === 'rooms' ? 'Комнаты / тип' : 'Корпус', 'Всего', 'Свободно', 'Наша бронь и сделки', 'Бронь застройщика', 'Продано', 'Не в продаже', 'Свободно, м²', 'Свободно, $', '$/м² свободных', '$/м² проданных'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{[...rows, tot].map((r, i) => (
            <tr key={r.key} style={i === rows.length ? { fontWeight: 600 } : undefined}>
              <td>{i === rows.length ? r.key : label(r.key)}</td><td className="num">{r.total}</td><td className="num okc">{r.free}</td><td className="num">{r.ours}</td><td className="num">{r.hold}</td><td className="num">{r.sold}</td><td className="num muted">{r.off}</td>
              <td className="num small">{num(L, r.free_m2)}</td><td className="num small">{usd(L, r.free_usd)}</td><td className="num small">{ppm(r.free_usd, r.free_m2)}</td><td className="num small muted">{ppm(r.sold_usd, r.sold_m2)}</td>
            </tr>))}</tbody>
        </table></div>
        <div className="tiny muted mt8">{T('«$/м² проданных» — по последней цене прайса, не по цене сделки застройщика. Наши брони и сделки считаются отдельно от статуса в каталоге.')}</div>
        <div className="h3 mt24">{T('По месяцам')}</div>
        <div className="tbl-wrap mt8"><table className="tbl">
          <thead><tr>{['Месяц', 'Продано всего', 'Продано у застройщика', 'Наши брони', 'Наши сделки', 'Цены вверх', 'Цены вниз', 'Среднее изменение цены'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>{months.map((m) => (
            <tr key={m.m}><td>{monthName(L, m.m)}</td><td className="num"><b>{m.total || '—'}</b></td><td className="num">{m.sold || '—'}</td><td className="num">{m.bookings || '—'}</td><td className="num">{m.deals || '—'}</td>
              <td className="num okc">{m.up || '—'}</td><td className="num badc">{m.down || '—'}</td><td className="num small">{m.avg_chg != null ? (m.avg_chg >= 0 ? '+' : '') + m.avg_chg.toFixed(1) + '%' : '—'}</td></tr>))}</tbody>
        </table></div>
      </div>
    </>
  )
}
