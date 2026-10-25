import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date, pct } from '@/lib/i18n'
import { listProjects, conditionVersions, unitsOfProject, type Conditions } from '@/lib/catalog'
import { canEditConditions } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { CondForm } from './form'
import { saveAgentRate } from '@/lib/actions'

// Первая версия условий нового проекта: значения по умолчанию как у Premium (5% + пул 20%, партнёру 2% + 10%), правятся перед публикацией
const defaults = (projectId: string): Conditions => ({ id: '', project_id: projectId, version: 1, status: 'draft', valid_from: new Date().toISOString().slice(0, 10), fix_pct: 5, pool_pct: 20,
  agent_fix_pct: 2, agent_pool_pct: 10, agent_our_pool_share: 0, seller_share_pct: 15, seller_self_disc: 10, seller_max_disc: 20, booking_days: 14, booking_ext_days: 14, protect_months: 3,
  max_bookings_client: 3, max_bookings_agent: 3, max_bookings_total: 10, pay_timing: 'after_first_payment', payment_plans: [], note: null, created_at: '' })

export default async function Conditions({ searchParams }: { searchParams: { p?: string } }) {
  const c = await requireCtx()
  if (!['owner', 'market_head', 'finance'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects()
  const p = ps.find((x) => x.slug === searchParams.p) || ps.find((x) => x.slug === 'premium-residence') || ps[0]
  const vers = await conditionVersions(p.id)
  const cur = vers.find((v) => v.status === 'draft') || vers.find((v) => v.status === 'published')
  const rates = await q<{ id: string; who: string; agent_fix_pct: number; agent_pool_pct: number; note: string | null }>(`select r.id, coalesce(a.name, u.name, r.market, '—') who, r.agent_fix_pct::float, r.agent_pool_pct::float, r.note from portal.agent_rates r left join portal.agencies a on a.id = r.agency_id left join portal.users u on u.id = r.agent_id where r.project_id = $1`, [p.id])
  const edit = canEditConditions(c.user.role)
  const whoList = edit ? await q<{ v: string; l: string }>(`select 'agency:' || id v, name l from portal.agencies union all select 'user:' || id, name from portal.users where active and role in ('agent','agency_head') order by 2`) : []
  const units = await unitsOfProject(p.id)
  const ex = units.find((u) => u.block === 'D' && u.number === '806') || units.find((u) => u.status === 'available' && u.usd)
  return (
    <>
      <Top title={T('Админка')} sub={T('Коммерческие условия проекта: версии с датой вступления, брони запоминают условия на дату брони')} />
      <div className="page">
        <AdminTabs lang={L} on="conditions" role={c.user.role} />
        <div className="chips">{ps.map((x) => <Link key={x.id} href={`?p=${x.slug}`} className={'chip' + (x.id === p.id ? ' on' : '')}>{x.name}</Link>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 16, alignItems: 'start' }} className="mt16">
          <div className="card stack" style={{ gap: 8 }}>
            <div className="label">{T('Версии условий')}</div>
            {vers.map((v) => <div key={v.id} className="kv"><span style={{ color: 'var(--ink)' }}>v{v.version} · {T('с {d}', { d: date(L, v.valid_from) })}<div className="tiny muted">{T('фикс {f} · пул {p} · агенту {a}+{b}', { f: pct(L, v.fix_pct), p: pct(L, v.pool_pct), a: pct(L, v.agent_fix_pct), b: pct(L, v.agent_pool_pct) })}</div></span><Pill kind={v.status === 'published' ? 'ok' : 'warn'}>{T(v.status === 'published' ? 'действует' : 'черновик')}</Pill></div>)}
            <div className="label mt16">{T('Исключения для агентов')}</div>
            {rates.length === 0 && <div className="small muted">—</div>}
            {rates.map((r) => <div key={r.id} className="kv"><span style={{ color: 'var(--ink)' }}>{r.who}<div className="tiny muted">{r.note}</div></span><span className="small row" style={{ gap: 6 }}>{pct(L, r.agent_fix_pct)} + {pct(L, r.agent_pool_pct)}{edit && <form action={saveAgentRate}><input type="hidden" name="project" value={p.id} /><input type="hidden" name="delete" value={r.id} /><button className="btn btn--sm" title={T('Удалить')}>×</button></form>}</span></div>)}
            {edit && (
              <form action={saveAgentRate} className="stack mt8" style={{ gap: 6 }}>
                <input type="hidden" name="project" value={p.id} />
                <select className="in" name="who" required defaultValue=""><option value="" disabled>{T('Агент, агентство или рынок')}</option><option value="market:DE">{T('Рынок')} DE</option><option value="market:IL">{T('Рынок')} IL</option>{whoList.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}</select>
                <div className="row" style={{ gap: 6 }}><input className="in" name="fix" placeholder={T('фикс, %')} inputMode="decimal" required style={{ flex: 1 }} /><input className="in" name="pool" placeholder={T('пул, %')} inputMode="decimal" required style={{ flex: 1 }} /></div>
                <input className="in" name="note" placeholder={T('комментарий')} />
                <button className="btn btn--sm">{T('Добавить исключение')}</button>
              </form>
            )}
            <div className="label mt16">{T('Уровни')}</div>
            <div className="tiny muted">{T('Договор застройщика → проект → блок → квартира. В MVP условия задаются на проект; блоки и квартиры — следующий шаг.')}</div>
          </div>
          {(cur || canEditConditions(c.user.role)) && <CondForm lang={L} projectId={p.id} cur={cur || defaults(p.id)} canEdit={canEditConditions(c.user.role)} example={ex ? { no: `${ex.block}-${ex.number}`, usd: ex.usd! } : null} />}
        </div>
      </div>
    </>
  )
}
