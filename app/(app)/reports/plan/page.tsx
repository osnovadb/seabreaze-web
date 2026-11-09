import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, usd, num, pct } from '@/lib/i18n'
import { planFact, monthly, projectDynamics, periodKeys, canSeePlanFact, canEditPlan, type Line, type PeriodKind } from '@/lib/planfact'
import { savePlans } from '@/lib/planActions'
import { ActionForm } from '@/components/ActionForm'
import { Top } from '@/components/ui'

// План и факт агентства (М10): по рынкам, менеджерам и агентствам, за месяц или квартал; помесячно; динамика цен проекта; xlsx
export default async function PlanFact(
  props: { searchParams: Promise<{ kind?: string; p?: string; project?: string }> }
) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!canSeePlanFact(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const kind: PeriodKind = searchParams.kind === 'quarter' ? 'quarter' : 'month'
  const { period, lines } = await planFact(c.user, kind, searchParams.p)
  const months = await monthly(c.user)
  const projects = await q<{ id: string; name: string }>('select id, name from projects order by sort, name')
  const proj = projects.find((p) => p.id === searchParams.project) || projects[0]
  const dyn = proj ? await projectDynamics(proj.id) : []
  const done = (pl: number | undefined, f: number) => (pl ? pct(L, Math.round((f / pl) * 1000) / 10) : '—')
  const cell = (l: Line & { market: string | null }, k: 'units' | 'area' | 'revenue' | 'commission', fmt: (n: number) => string) => {
    const edit = canEditPlan(c.user, l.scope, l.market)
    return (
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        {edit ? <input className="in" name={`${l.scope}:${l.id}:${k}`} defaultValue={l.plan?.[k] ?? ''} inputMode="decimal" style={{ width: 92, height: 28, textAlign: 'end' }} /> : <span className="muted">{l.plan?.[k] != null ? fmt(l.plan[k]!) : '—'}</span>}
        <div className="small">{fmt(l.fact[k])}</div>
      </td>
    )
  }
  const Table = ({ title, rows }: { title: string; rows: (Line & { market: string | null })[] }) => (
    <div className="card">
      <div className="h3">{title}</div>
      <div className="tbl-wrap mt8"><table className="tbl">
        <thead><tr><th /><th>{T('Штук')}</th><th>{T('Площадь, м²')}</th><th>{T('Объём продаж')}</th><th>{T('Наш доход')}</th><th>{T('Выполнение')}</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={6} className="muted">{T('Пока нет')}</td></tr> : rows.map((l) => (
          <tr key={l.id}><td>{l.name}</td>{cell(l, 'units', (n) => num(L, n))}{cell(l, 'area', (n) => num(L, n, 0))}{cell(l, 'revenue', (n) => usd(L, n))}{cell(l, 'commission', (n) => usd(L, n))}
            <td className="num">{done(l.plan?.revenue, l.fact.revenue)}</td></tr>))}</tbody>
      </table></div>
    </div>
  )
  const anyEdit = Object.values(lines).flat().some((l) => canEditPlan(c.user, l.scope, l.market))
  return (
    <>
      <Top crumbs={[[T('Отчёты'), '/reports'], [T('План и факт')]]} title={T('План и факт')} sub={T('Факт — сделки по дате договора, без расторгнутых. В ячейке: сверху план, снизу факт.')}
        right={<a className="btn" href={`/reports/plan/xlsx?kind=${kind}&p=${period.key}`}>{T('Скачать xlsx')}</a>} />
      <div className="page stack">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(['month', 'quarter'] as PeriodKind[]).map((k) => <Link key={k} href={`?kind=${k}`} className={'chip' + (kind === k ? ' on' : '')}>{T(k === 'month' ? 'Месяц' : 'Квартал')}</Link>)}
          <span className="muted">·</span>
          {periodKeys(kind).slice(0, 8).map((k) => <Link key={k} href={`?kind=${kind}&p=${k}`} className={'chip' + (period.key === k ? ' on' : '')}>{k}</Link>)}
        </div>
        <ActionForm action={savePlans} lang={L} className="stack" okText={T('План сохранён')}>
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={period.key} />
          <Table title={T('По рынкам')} rows={lines.market} />
          <Table title={T('По менеджерам')} rows={lines.user} />
          <Table title={T('По агентствам')} rows={lines.agency} />
          {anyEdit && <div><button className="btn btn--p">{T('Сохранить план на {p}', { p: period.key })}</button></div>}
        </ActionForm>
        <div className="card">
          <div className="h3">{T('Помесячно за 12 месяцев')}</div>
          <div className="tbl-wrap mt8"><table className="tbl">
            <thead><tr><th>{T('Месяц')}</th><th>{T('Штук')}</th><th>{T('Площадь, м²')}</th><th>{T('Объём продаж')}</th><th>{T('Наш доход')}</th></tr></thead>
            <tbody>{months.length === 0 ? <tr><td colSpan={5} className="muted">{T('Сделок пока нет')}</td></tr> : months.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{m.units}</td><td className="num">{num(L, m.area)}</td><td className="num">{usd(L, m.revenue)}</td><td className="num">{usd(L, m.commission)}</td></tr>)}</tbody>
          </table></div>
        </div>
        {proj && (
          <div className="card">
            <div className="between"><div className="h3">{T('Динамика цен и продаж')}</div>
              <div className="chips">{projects.map((p) => <Link key={p.id} href={`?kind=${kind}&p=${period.key}&project=${p.id}`} className={'chip' + (p.id === proj.id ? ' on' : '')}>{p.name}</Link>)}</div></div>
            <div className="tbl-wrap mt8"><table className="tbl">
              <thead><tr><th>{T('Месяц')}</th><th>{T('Средняя цена м², USD')}</th><th>{T('Изменений цен')}</th><th>{T('Сделок')}</th></tr></thead>
              <tbody>{dyn.map((d) => <tr key={d.month}><td>{d.month}</td><td className="num">{d.per_m2 ? usd(L, d.per_m2) : '—'}</td><td className="num">{d.changes}</td><td className="num">{d.deals}</td></tr>)}</tbody>
            </table></div>
            <div className="tiny muted mt8">{T('Средняя — по последней известной цене каждой квартиры на конец месяца; AZN пересчитаны по текущему курсу.')}</div>
          </div>
        )}
      </div>
    </>
  )
}
