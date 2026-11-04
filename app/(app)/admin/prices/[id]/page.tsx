import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, dateTime, num } from '@/lib/i18n'
import { normRule } from '@/lib/priceRule'
import { publishPriceList, revertPriceList, deletePriceList } from '@/lib/priceActions'
import { Top, Pill } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { RuleForm, PL_STATUS } from '../form'

type Item = { unit_id: string; no: string; building: string; floor: number; area: number | null; old_price: number | null; new_price: number; currency: string; applied: boolean | null; now: number | null; now_cur: string }

// Прайс-лист: черновик — правило и предпросмотр «было → стало»; опубликованный — что применено, что пропущено, откат
export default async function PriceList({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const l = await one<{ id: string; project_id: string; pname: string; title: string; status: string; rule: Record<string, unknown>; note: string | null; by: string; created_at: string; pub: string | null; published_at: string | null; rev: string | null; reverted_at: string | null }>(`
    select pl.id, pl.project_id, p.name pname, pl.title, pl.status, pl.rule, pl.note, a.name by, pl.created_at, b.name pub, pl.published_at, r.name rev, pl.reverted_at
    from portal.price_lists pl join projects p on p.id = pl.project_id join portal.users a on a.id = pl.created_by left join portal.users b on b.id = pl.published_by left join portal.users r on r.id = pl.reverted_by where pl.id = $1`, [params.id])
  if (!l) notFound()
  const items = await q<Item>(`select i.unit_id, case when u.number ilike coalesce(bl.external_id, '') || '-%' then u.number else coalesce(bl.external_id || '-', '') || u.number end no, bl.name building, u.floor, u.area_total_m2::float area, i.old_price::float, i.new_price::float, i.currency, i.applied,
      u.price_list::float now, u.price_currency now_cur from portal.price_list_items i join units u on u.id = i.unit_id join buildings bl on bl.id = u.building_id where i.list_id = $1 order by bl.sort, bl.name, u.floor, u.number`, [l.id])
  const money = (v: number, cur: string) => `${cur} ${num(L, Math.round(v))}`
  const byCur = Array.from(new Set(items.map((i) => i.currency))).map((cur) => {
    const xs = items.filter((i) => i.currency === cur && (l.status === 'draft' || i.applied))
    const o = xs.reduce((a, i) => a + (i.old_price || 0), 0), n = xs.reduce((a, i) => a + i.new_price, 0)
    return { cur, n: xs.length, o, d: n - o, pct: o ? (n / o - 1) * 100 : 0 }
  })
  const stale = l.status === 'draft' ? items.filter((i) => i.now !== i.old_price || i.now_cur !== i.currency).length : 0
  const st = PL_STATUS[l.status]
  return (
    <>
      <Top crumbs={[[T('Прайс-листы'), `/admin/prices?p=${l.project_id}`], [l.title]]} title={l.title}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}><Pill kind={st[1]}>{T(st[0])}</Pill><span className="small muted">{l.pname} · {l.by} · {dateTime(L, l.created_at)}{l.pub ? ' · ' + T('опубликовал {u} {d}', { u: l.pub, d: dateTime(L, l.published_at!) }) : ''}{l.rev ? ' · ' + T('откатил {u} {d}', { u: l.rev, d: dateTime(L, l.reverted_at!) }) : ''}</span></span>} />
      <div className="page split">
        <div className="stack">
          <div className="grid g3">{byCur.map((x) => <div key={x.cur} className="card card--tight kpi"><div className="v" style={{ fontSize: 22 }}>{x.d >= 0 ? '+' : '−'}{money(Math.abs(x.d), x.cur)}</div><div className="small muted">{T('{n} кв. · {p} к сумме прайса', { n: x.n, p: (x.pct >= 0 ? '+' : '') + x.pct.toFixed(2) + '%' })}</div></div>)}
            {items.length === 0 && <div className="card small muted">{T('Под правило не попала ни одна квартира — или цена у всех уже такая.')}</div>}</div>
          {stale > 0 && <div className="card card--tight warnc small">{T('У {n} кв. цена изменилась после расчёта — нажмите «Пересчитать», иначе при публикации они будут пропущены.', { n: stale })}</div>}
          {l.status === 'draft' && items.length > 0 && <div className="row" style={{ gap: 8 }}>
            <ActionForm action={publishPriceList} lang={L} okText={T('Опубликовано, квартир')}><input type="hidden" name="id" value={l.id} /><button className="btn btn--p">{T('Опубликовать — цены изменятся сразу')}</button></ActionForm>
          </div>}
          {l.status === 'published' && <ActionForm action={revertPriceList} lang={L} okText={T('Откатано, квартир')}><input type="hidden" name="id" value={l.id} /><button className="btn">{T('Откатить: вернуть прежние цены')}</button>
            <div className="tiny muted mt8">{T('Вернутся цены только у квартир, где с публикации цену никто не менял.')}</div></ActionForm>}
          {items.length > 0 && <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{['Квартира', 'Корпус', 'Этаж', 'Площадь', 'Было', 'Стало', 'Разница', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>{items.slice(0, 600).map((i) => { const d = i.old_price ? (i.new_price / i.old_price - 1) * 100 : 0; return (
              <tr key={i.unit_id}><td><Link href={`/units/${i.unit_id}`}><b>{i.no}</b></Link></td><td className="small">{i.building}</td><td>{i.floor}</td><td className="small">{i.area ?? '—'}</td>
                <td className="num small">{i.old_price ? money(i.old_price, i.currency) : '—'}</td><td className="num"><b>{money(i.new_price, i.currency)}</b></td>
                <td className={'num small ' + (d >= 0 ? 'okc' : 'badc')}>{i.old_price ? (d >= 0 ? '+' : '') + d.toFixed(1) + '%' : ''}</td>
                <td className="tiny">{i.applied === false ? <span className="warnc">{T('пропущено: цена или статус изменились')}</span> : l.status === 'draft' && (i.now !== i.old_price || i.now_cur !== i.currency) ? <span className="warnc">{T('цена уже другая')}</span> : ''}</td></tr>) })}</tbody>
          </table>{items.length > 600 && <div className="tiny muted mt8">{T('Показаны первые 600 из {n}', { n: items.length })}</div>}</div>}
        </div>
        <div className="stack">
          {l.status === 'draft' ? <>
            <RuleForm lang={L} projectId={l.project_id} id={l.id} title={l.title} note={l.note} rule={normRule(l.rule)} />
            <form action={deletePriceList}><input type="hidden" name="id" value={l.id} /><button className="btn btn--sm">{T('Удалить черновик')}</button></form>
          </> : <div className="card small">{l.note && <div className="mt8">{l.note}</div>}<div className="muted">{T('Правило опубликованного прайс-листа не меняется. Для новых цен создайте новый прайс-лист.')}</div></div>}
        </div>
      </div>
    </>
  )
}
