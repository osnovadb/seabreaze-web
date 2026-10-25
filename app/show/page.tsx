import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { t, usd } from '@/lib/i18n'
import { listProjects } from '@/lib/catalog'

const IMG: Record<string, string> = { 'premium-residence': '/img/pr-aerial.jpg', 'brabus-island-baku': '/img/brabus.jpg' }
export default async function ShowHome() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = (await listProjects(c.user)).filter((p) => ['sales', 'stop'].includes(p.sales_status))
  return (
    <div className="page">
      <h1 className="h2" style={{ fontSize: 30 }}>{T('Проекты в Sea Breeze')}</h1>
      <p className="muted">{T('Цены застройщика в долларах США · визуализации')}</p>
      <div className="grid g2 mt16">
        {ps.map((p) => (
          <Link key={p.id} href={`/show/${p.slug}`} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="ph" style={{ aspectRatio: '16/8', borderRadius: 0 }}><img src={IMG[p.slug]} alt="" /></div>
            <div style={{ padding: 18 }}><div className="h2">{p.name}</div><div className="muted">{T('{n} квартир доступно', { n: p.free })}{p.min_usd ? ' · ' + T('от {p}', { p: usd(L, p.min_usd) }) : ''}</div></div>
          </Link>
        ))}
      </div>
    </div>
  )
}
