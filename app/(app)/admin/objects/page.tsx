import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd } from '@/lib/i18n'
import { listProjects } from '@/lib/catalog'
import { Top, Pill, SALES } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { ActionForm } from '@/components/ActionForm'
import { saveProject } from '@/lib/objects'

// Объекты: проекты каталога, их статус и видимость. Новый проект создаётся черновиком — партнёры и сайты его не видят.
export default async function Objects() {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects(c.user)
  const access = await q<{ project_id: string; agent_markets: string[]; sites: string[] }>(`select ps.project_id, ps.agent_markets,
    coalesce((select array_agg(market_id) from project_markets pm where pm.project_id = ps.project_id and pm.visible), '{}') sites from portal.project_settings ps`)
  const devs = await q<{ id: string; name: string }>('select id, name from developers order by name')
  const owner = c.user.role === 'owner'
  return (
    <>
      <Top title={T('Админка')} sub={T('Объекты: проекты, блоки, планировки, квартиры, планы оплаты и видимость')} />
      <div className="page">
        <AdminTabs lang={L} on="objects" role={c.user.role} />
        <div className="split">
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{['Проект', 'Застройщик', 'Квартир', 'Свободно', 'Цена от', 'Статус продаж', 'Партнёрам', 'На сайтах'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{ps.map((p) => { const a = access.find((x) => x.project_id === p.id); return (
              <tr key={p.id}>
                <td><Link href={`/admin/objects/${p.id}`}><b>{p.name}</b></Link><div className="tiny muted">{p.city} · {p.delivery || '—'}</div></td>
                <td className="small">{p.developer}</td><td>{p.units}</td><td>{p.free}</td><td>{p.min_usd ? usd(L, p.min_usd) : '—'}</td>
                <td><Pill kind={(SALES[p.sales_status] || SALES.draft)[1]}>{T((SALES[p.sales_status] || SALES.draft)[0])}</Pill></td>
                <td className="small">{a?.agent_markets.length ? a.agent_markets.join(', ') : '—'}</td>
                <td className="small">{a?.sites.length ? a.sites.map((x) => x.toUpperCase()).join(', ') : '—'}</td>
              </tr>
            ) })}</tbody>
          </table></div>
          {owner && (
            <ActionForm action={saveProject} lang={L} className="card stack" style={{ gap: 10 }}>
              <div className="h3" style={{ margin: 0 }}>{T('Новый проект')}</div>
              <label className="field"><span>{T('Название')}</span><input className="in" name="name" required /></label>
              <label className="field"><span>{T('Адрес в портале (латиницей)')}</span><input className="in" name="slug" placeholder="marina-village" /></label>
              <label className="field"><span>{T('Застройщик')}</span><select className="in" name="developer" defaultValue={devs[0]?.id}>{devs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}<option value="new">+ {T('новый застройщик')}</option></select></label>
              <label className="field"><span>{T('Новый застройщик (если выбран «новый»)')}</span><input className="in" name="developer_name" /></label>
              <div className="row"><label className="field" style={{ flex: 1 }}><span>{T('Город')}</span><input className="in" name="city" defaultValue="Баку" /></label><label className="field" style={{ flex: 1 }}><span>{T('Сдача')}</span><input className="in" name="delivery" placeholder="IV кв. 2027" /></label></div>
              <button className="btn btn--p">{T('Создать черновик')}</button>
              <div className="tiny muted">{T('Дальше: блоки, планировки, квартиры и планы оплаты — затем откройте проект партнёрам и сайтам.')}</div>
            </ActionForm>
          )}
        </div>
      </div>
    </>
  )
}
