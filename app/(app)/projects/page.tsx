import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { t, usd } from '@/lib/i18n'
import { listProjects } from '@/lib/catalog'
import { Top } from '@/components/ui'

const IMG: Record<string, string> = { 'premium-residence': '/img/pr-aerial.jpg', 'brabus-island-baku': '/img/brabus.jpg' }
export default async function Projects() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects(c.user)
  return (
    <>
      <Top title={T('Проекты')} sub={T('Открытые вашему рынку проекты Sea Breeze')} />
      <div className="page grid g2">
        {ps.map((p) => (
          <Link key={p.id} href={`/projects/${p.slug}`} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="ph" style={{ aspectRatio: '16/8', borderRadius: 0 }}><img src={IMG[p.slug] || '/img/pr-aerial.jpg'} alt="" /></div>
            <div style={{ padding: 18 }}>
              <div className="between"><div className="h2">{p.name}</div><span className="pill pill--ok">{T('{n} свободно', { n: p.free })}</span></div>
              <div className="small muted mt8">{p.developer} · {T('{b} корп.', { b: p.buildings })} · {T('{n} квартир', { n: p.units })} · {p.delivery || T('сдача уточняется')}</div>
              <div className="mt8"><b>{p.min_usd ? T('от {p}', { p: usd(L, p.min_usd) }) : '—'}</b> <span className="small muted">{p.slug === 'brabus-island-baku' ? T('тестовые цены, пересчёт из AZN') : T('по прайсу застройщика')}</span></div>
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
