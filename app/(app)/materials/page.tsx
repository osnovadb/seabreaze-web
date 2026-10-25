import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { listProjects } from '@/lib/catalog'
import { isExternal } from '@/lib/perm'
import { Top } from '@/components/ui'

// Материалы и документы по всем проектам: сводка со ссылками на вкладки проектов (там же загрузка для владельца и контента)
export default async function Materials() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects(c.user)
  const ext = isExternal(c.user.role)
  const stat = await q<{ project_id: string; kind: string; n: number; last: string }>(`select project_id, case kind when 'document' then 'document' else 'material' end kind, count(*)::int n, max(created_at) last
    from portal.project_files ${ext ? "where audience <> 'team'" : ''} group by 1, 2`)
  const get = (pid: string, k: string) => stat.find((x) => x.project_id === pid && x.kind === k)
  return (
    <>
      <Top title={T('Материалы')} sub={T('Материалы для партнёров и клиентов по проектам. Контент и новости сайтов — в CMS (Payload).')} />
      <div className="page grid g2">
        {ps.map((p) => { const m = get(p.id, 'material'), d = get(p.id, 'document'); return (
          <div key={p.id} className="card">
            <div className="h3">{p.name}</div>
            <Link className="kv" href={`/projects/${p.slug}?tab=materials`}><span style={{ color: 'var(--ink)' }}>{T('Материалы для клиента')}</span><span className="small">{m ? `${m.n} · ${date(L, m.last)}` : '—'} →</span></Link>
            <Link className="kv" href={`/projects/${p.slug}?tab=docs`}><span style={{ color: 'var(--ink)' }}>{T('Документы')}</span><span className="small">{d ? `${d.n} · ${date(L, d.last)}` : '—'} →</span></Link>
          </div>
        ) })}
      </div>
    </>
  )
}
