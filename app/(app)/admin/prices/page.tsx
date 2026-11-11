import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { RuleForm, PL_STATUS } from './form'
import { normRule } from '@/lib/priceRule'


// Прайс-листы проекта: список и новый черновик
export default async function Prices(props: { searchParams: Promise<{ p?: string; units?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!['owner', 'office', 'finance'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await q<{ id: string; name: string }>('select id, name from projects order by sort, name')
  const p = ps.find((x) => x.id === searchParams.p) || ps[0]
  const lists = p ? await q<{ id: string; title: string; status: string; n: number; applied: number; by: string; created_at: string; published_at: string | null }>(`
    select pl.id, pl.title, pl.status, (select count(*)::int from portal.price_list_items i where i.list_id = pl.id) n,
      (select count(*)::int from portal.price_list_items i where i.list_id = pl.id and i.applied) applied, us.name by, pl.created_at, pl.published_at
    from portal.price_lists pl join portal.users us on us.id = pl.created_by where pl.project_id = $1 order by pl.created_at desc`, [p.id]) : []
  return (
    <>
      <Top crumbs={[[T('Объекты'), '/admin/objects'], [T('Прайс-листы')]]} title={T('Прайс-листы')} sub={T('Массовое изменение цен: черновик → проверка «было → стало» → публикация. Опубликованный можно откатить.')} />
      <div className="page">
        <div className="chips">{ps.map((x) => <Link key={x.id} href={`?p=${x.id}`} className={'chip' + (x.id === p?.id ? ' on' : '')}>{x.name}</Link>)}</div>
        <div className="split mt16">
          <div className="card">
            {lists.length === 0 && <div className="small muted">{T('Прайс-листов по проекту ещё нет.')}</div>}
            {lists.length > 0 && <table className="tbl"><thead><tr>{['Название', 'Статус', 'Квартир', 'Автор', 'Создан', 'Опубликован'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
              <tbody>{lists.map((l) => <tr key={l.id}><td><Link href={`/admin/prices/${l.id}`}><b>{l.title}</b></Link></td><td><Pill kind={PL_STATUS[l.status][1]}>{T(PL_STATUS[l.status][0])}</Pill></td>
                <td className="num">{l.status === 'draft' ? l.n : `${l.applied} / ${l.n}`}</td><td className="small">{l.by}</td><td className="small muted">{dateTime(L, l.created_at)}</td><td className="small muted">{l.published_at ? dateTime(L, l.published_at) : '—'}</td></tr>)}</tbody></table>}
          </div>
          {p && <RuleForm lang={L} projectId={p.id} rule={searchParams.units ? normRule({ units: searchParams.units.split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500) }) : undefined} />}
        </div>
      </div>
    </>
  );
}
