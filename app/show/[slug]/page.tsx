import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one, q } from '@/lib/db'
import { t, usd } from '@/lib/i18n'
import { projectBySlug, buildingsOf, unitsOfBuilding, codeFor } from '@/lib/catalog'
import { Chess } from '@/components/Chess'
import { UnitPanel } from '@/components/UnitPanel'
import { FacadeView } from '@/components/FacadeView'
import { Legend } from '@/components/ui'

export default async function ShowProject({ params, searchParams }: { params: { slug: string }; searchParams: { b?: string; r?: string; u?: string; view?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p || !['sales', 'stop'].includes(p.sales_status)) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const b = bs.find((x) => x.id === searchParams.b)
  const gp = await one<{ image: string; polygons: { block: string; points: [number, number][]; label: [number, number] }[] }>('select image, polygons from portal.genplans where project_id = $1', [p.id])
  const byExt = Object.fromEntries(bs.map((x) => [x.external_id || x.name, x]))
  const units = b ? await unitsOfBuilding(b.id) : []
  const rooms = Number(searchParams.r) || undefined
  // Материалы с пометкой «можно клиенту» на языке показа (или для всех языков)
  const files = await q<{ id: string; title: string; kind: string; file_id: string | null; url: string | null }>(`select id, title, kind, file_id, url from portal.project_files
    where project_id = $1 and audience = 'client' and lang in ('all', $2) order by kind, sort, created_at`, [p.id, L])
  const sel = units.find((u) => u.id === searchParams.u && codeFor(u, null, 'show') === 'F')
  const facade = b ? await one<{ file_id: string; risers: string[]; floor_from: number; floor_to: number; quad: number[][] }>('select file_id, risers, floor_from, floor_to, quad from portal.facades where building_id = $1 and quad is not null order by sort, created_at limit 1', [b.id]) : null
  const qs = (o: Record<string, string | number | undefined>) => '?' + new URLSearchParams(Object.entries({ b: b?.id, r: rooms, view: searchParams.view, u: sel?.id, ...o }).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
  return (
    <div className="page">
      <h1 className="h2" style={{ fontSize: 30 }}>{p.name}{b ? ' · ' + b.name : ''}</h1>
      <p className="muted">{T('Цены застройщика в USD, расходы на сделку отдельно · визуализации')}</p>
      <div className="chips mt16">{bs.map((x) => <Link key={x.id} href={`?b=${x.id}`} className={'chip' + (x.id === b?.id ? ' on' : '')}>{x.name} <span className="n">{x.free}</span></Link>)}</div>
      {!b && gp && (
        <div className="gp mt16">
          <img src={gp.image} alt="" />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none">{gp.polygons.map((g) => byExt[g.block] && <a key={g.block} href={`?b=${byExt[g.block].id}`}><polygon points={g.points.map((x) => x.join(',')).join(' ')} /></a>)}</svg>
          {gp.polygons.map((g) => byExt[g.block] && <div key={g.block} className="tag" style={{ left: `${g.label[0] * 100}%`, top: `${g.label[1] * 100}%` }}><b>{byExt[g.block].name}</b>{T('{n} доступно', { n: byExt[g.block].free })}{byExt[g.block].min_usd ? ' · ' + T('от {p}', { p: usd(L, byExt[g.block].min_usd!) }) : ''}</div>)}
        </div>
      )}
      {!b && files.length > 0 && (
        <div className="card mt16">
          <div className="h3">{T('Материалы')}</div>
          {files.map((f) => <a key={f.id} className="kv" href={f.file_id ? `/files/${f.file_id}` : f.url!} target="_blank" rel="noopener"><span style={{ color: 'var(--ink)' }}>{f.title}</span><span className="small muted">{f.kind === 'video' ? T('видео') : f.file_id ? 'PDF / ZIP' : '↗'}</span></a>)}
        </div>
      )}
      {b && (
        <>
          <div className="between mt16">
            <div className="chips"><Link href={`?b=${b.id}`} className={'chip' + (!rooms ? ' on' : '')}>{T('Комнаты: все')}</Link>{[1, 2, 3].map((r) => <Link key={r} href={`?b=${b.id}&r=${r}`} className={'chip' + (rooms === r ? ' on' : '')}>{r}</Link>)}</div>
            <div className="legend"><span><i className="c-F" />{T('Доступно')}</span><span><i className="c-X" />{T('Недоступно')}</span></div>
          </div>
          {facade && <div className="chips mt16"><Link href={qs({ view: '' })} className={'chip' + (searchParams.view !== 'facade' ? ' on' : '')}>{T('Шахматка')}</Link><Link href={qs({ view: 'facade' })} className={'chip' + (searchParams.view === 'facade' ? ' on' : '')}>{T('Фасад')}</Link></div>}
          <div className="chess-wrap mt16">
            {facade && searchParams.view === 'facade' ? <FacadeView facade={facade} units={units} viewer={null} mode="show" selected={sel?.id} hrefFor={(u) => qs({ u: u.id })} /> : <Chess units={units} viewer={null} mode="show" lang={L} cellMode="price" rooms={rooms} selected={sel?.id} hrefFor={(u) => qs({ u: u.id })} />}
            {sel ? <UnitPanel u={sel} code="F" lang={L} mode="show" closeHref={qs({ u: '' })} />
              : <div className="card upanel small muted">{T('Нажмите на квартиру в шахматке — она откроется здесь.')}</div>}
          </div>
        </>
      )}
    </div>
  )
}
