import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { t, usd, m2 } from '@/lib/i18n'
import { listProjects, unitsOfProject, viewMode, codeFor, unitNo } from '@/lib/catalog'
import { Top, Pill } from '@/components/ui'

export default async function Catalog({ searchParams }: { searchParams: { p?: string; r?: string; max?: string; o?: string; all?: string; s?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects(c.user)
  const p = ps.find((x) => x.slug === searchParams.p) || ps.find((x) => x.slug === 'premium-residence') || ps[0]
  const mode = viewMode(c.user, false)
  const rooms = Number(searchParams.r) || 0, max = Number(searchParams.max) || 0
  let units = (await unitsOfProject(p.id)).map((u) => ({ ...u, code: codeFor(u, c.user, mode) }))
  const all = mode === 'team' && searchParams.all === '1'
  units = units.filter((u) => (all ? true : u.code === 'F' || u.code === 'M') && (!rooms || u.rooms === rooms) && (!max || (u.usd || 0) <= max * 1000) && (!searchParams.o || (searchParams.o === 'g' ? u.plot_area : u.ext_area)))
  const sort = searchParams.s || 'price'
  units.sort((a, b) => (sort === 'price' ? (a.usd || 0) - (b.usd || 0) : sort === 'm2' ? (a.usd || 0) / a.area - (b.usd || 0) / b.area : sort === 'area' ? b.area - a.area : b.floor - a.floor))
  const qs = (o: Record<string, string | number>) => '?' + new URLSearchParams(Object.entries({ p: p.slug, r: rooms || '', max: max || '', o: searchParams.o || '', all: all ? '1' : '', s: sort, ...o }).filter(([, v]) => v !== '' && v !== 0).map(([k, v]) => [k, String(v)])).toString()
  return (
    <>
      <Top title={T('Каталог')} sub={T('{n} квартир по фильтру', { n: units.length })} />
      <div className="page">
        <div className="chips">{ps.map((x) => <Link key={x.id} href={`?p=${x.slug}`} className={'chip' + (x.id === p.id ? ' on' : '')}>{x.name} <span className="n">{x.free}</span></Link>)}</div>
        <div className="between mt16">
          <div className="chips">
            <Link href={qs({ r: '' })} className={'chip' + (!rooms ? ' on' : '')}>{T('Комнаты: все')}</Link>
            {[1, 2, 3, 4].map((r) => <Link key={r} href={qs({ r })} className={'chip' + (rooms === r ? ' on' : '')}>{r}</Link>)}
            <Link href={qs({ o: searchParams.o === 'g' ? '' : 'g' })} className={'chip' + (searchParams.o === 'g' ? ' on' : '')}>{T('С садом')}</Link>
            <Link href={qs({ o: searchParams.o === 't' ? '' : 't' })} className={'chip' + (searchParams.o === 't' ? ' on' : '')}>{T('С террасой')}</Link>
            {[150, 200, 300].map((m) => <Link key={m} href={qs({ max: max === m ? '' : m })} className={'chip' + (max === m ? ' on' : '')}>{T('до ${m} тыс.', { m })}</Link>)}
            {mode === 'team' && <Link href={qs({ all: all ? '' : '1' })} className={'chip' + (all ? ' on' : '')}>{T('Все статусы')}</Link>}
          </div>
          <div className="chips">{[['price', 'по цене'], ['m2', 'по $/м²'], ['area', 'по площади'], ['floor', 'по этажу']].map(([k, l]) => <Link key={k} href={qs({ s: k })} className={'chip' + (sort === k ? ' on' : '')}>{T(l)}</Link>)}</div>
        </div>
        <div className="tbl-wrap mt16">
          <table className="tbl">
            <thead><tr>{['Квартира', 'Корпус', 'Этаж', 'Комнаты', 'Площадь', 'Цена', '$/м²', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>
              {units.slice(0, 300).map((u) => {
                const out = (u.plot_area || 0) + (u.ext_area || 0)
                return (
                  <tr key={u.id}>
                    <td><Link href={`/units/${u.id}`}><b>{unitNo(u)}</b></Link></td><td>{u.building}</td><td>{u.floor}</td><td>{u.rooms ?? '—'}</td>
                    <td>{m2(L, u.area)}{out ? <div className="tiny muted">+ {u.plot_area ? T('сад') : T('терраса')} {m2(L, out)}</div> : null}</td>
                    <td className="num"><b>{u.usd ? usd(L, u.usd) : '—'}</b></td><td className="num small muted">{u.usd ? usd(L, u.usd / (u.area + out)) : ''}</td>
                    <td>{u.code === 'F' ? <Pill kind="ok">{T('свободно')}</Pill> : u.code === 'M' ? <Pill kind="ours">{T('ваша бронь')}</Pill> : u.code === 'O' ? <Pill kind="ours">{T('наша бронь')}</Pill> : u.code === 'D' ? <Pill kind="ink">{T('сделка')}</Pill> : u.code === 'B' ? <Pill kind="warn">{T('бронь застройщика')}</Pill> : u.code === 'S' ? <Pill kind="bad">{T('продано')}</Pill> : <Pill kind="off">{T('не в продаже')}</Pill>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {units.length > 300 && <div className="small muted mt8">{T('Показаны первые 300 — уточните фильтр')}</div>}
      </div>
    </>
  )
}
