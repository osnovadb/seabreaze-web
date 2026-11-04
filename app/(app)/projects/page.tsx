import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd } from '@/lib/i18n'
import { listProjects, toUsdSql, roomsSql } from '@/lib/catalog'
import { isExternal } from '@/lib/perm'
import { Top, Pill, SALES } from '@/components/ui'

// Картинки по умолчанию, пока в админке не загружена обложка (только свои фото проекта)
const DEFAULT_COVER: Record<string, string> = { 'premium-residence': '/img/pr-aerial.jpg', 'brabus-island-baku': '/img/brabus.jpg' }
// Проекты: обложка из админки (Объекты → Основное), свободные по комнатам, цены «от — до», действующие акции
export default async function Projects() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects(c.user)
  const ext = isExternal(c.user.role)
  const ids = ps.map((p) => p.id)
  const extra = new Map((await q<{ id: string; cover: string | null; gp: string | null; max_usd: number | null; mix: Record<string, number> | null; promos: number }>(`
    select p.id, (select '/files/' || ps.cover_file_id from portal.project_settings ps where ps.project_id = p.id and ps.cover_file_id is not null) cover,
      (select image from portal.genplans g where g.project_id = p.id) gp,
      (select max(${toUsdSql})::float from units u where u.project_id = p.id and u.status = 'available' and u.price_list is not null) max_usd,
      (select jsonb_object_agg(r, n) from (select least(${roomsSql}, 4) r, count(*)::int n from units u where u.project_id = p.id and u.status = 'available' and u.price_list is not null
         and not exists (select 1 from portal.bookings x where x.unit_id = u.id and x.status in ('requested','confirmed'))
         and not exists (select 1 from portal.deals d where d.unit_id = u.id and d.stage <> 'cancelled')
         ${ext ? 'and not exists (select 1 from portal.unit_hidden h where h.unit_id = u.id)' : ''} and ${roomsSql} is not null group by 1) m) mix,
      (select count(*)::int from portal.special_offers o where o.project_id = p.id and o.active and (o.starts_on is null or o.starts_on <= current_date) and (o.ends_on is null or o.ends_on >= current_date)) promos
    from projects p where p.id = any($1)`, [ids])).map((r) => [r.id, r]))
  return (
    <>
      <Top title={T('Проекты')} sub={ext ? T('Проекты, открытые вашему рынку') : T('{n} проектов в портале', { n: ps.length })} />
      <div className="page grid g2">
        {ps.length === 0 && <div className="card muted">{T('Пока нет открытых вам проектов.')}</div>}
        {ps.map((p) => {
          const x = extra.get(p.id), st = SALES[p.sales_status] || SALES.draft
          return (
            <Link key={p.id} href={`/projects/${p.slug}`} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="ph" style={{ aspectRatio: '16/8', borderRadius: 0, position: 'relative' }}>
                {x?.cover || x?.gp || DEFAULT_COVER[p.slug] ? <img src={x?.cover || x?.gp || DEFAULT_COVER[p.slug]} alt="" /> : <div className="muted" style={{ display: 'grid', placeItems: 'center', height: '100%', background: 'var(--sand)', fontFamily: 'var(--serif)', fontSize: 22 }}>{p.name}</div>}
                {x?.promos ? <span className="ucard__promo">{T('Акций: {n}', { n: x.promos })}</span> : null}
              </div>
              <div style={{ padding: 18 }}>
                <div className="between"><div className="h2">{p.name}</div><span className="row" style={{ gap: 6 }}>{!ext && p.sales_status !== 'sales' && <Pill kind={st[1]}>{T(st[0])}</Pill>}<span className="pill pill--ok">{T('{n} свободно', { n: p.free })}</span></span></div>
                <div className="small muted mt8">{p.developer} · {p.city || 'Баку'} · {T('{b} корп.', { b: p.buildings })} · {T('сдача')} {p.delivery || T('уточняется')}</div>
                <div className="mt8"><b>{p.min_usd ? (x?.max_usd && x.max_usd > p.min_usd ? <bdi dir="ltr">{usd(L, p.min_usd)} – {usd(L, x.max_usd)}</bdi> : T('от {p}', { p: usd(L, p.min_usd) })) : '—'}</b></div>
                {x?.mix && <div className="chips mt8">{Object.entries(x.mix).sort(([a], [b]) => Number(a) - Number(b)).map(([r, n]) => <span key={r} className="chip" style={{ height: 24 }}>{Number(r) >= 4 ? '4+' : r}{T('к')} <span className="n">{n}</span></span>)}</div>}
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}
