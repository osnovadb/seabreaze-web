import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { Top } from '@/components/ui'
import { MarkupEditor } from '@/components/MarkupEditor'
import { saveGenplan, saveMarks } from '@/lib/markup'
import { MarksEditor } from '@/components/MarksEditor'
import { cleanMarks } from '@/lib/surround'
import Link from 'next/link'

// Разметка генплана: контур на каждый дом (блок)
export default async function GenplanEditor({ params, searchParams }: { params: { id: string }; searchParams: { m?: string } }) {
  const c = await requireCtx()
  if (c.user.role !== 'owner') redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const p = await one<{ id: string; name: string }>('select id, name from projects where id = $1', [params.id])
  if (!p) notFound()
  const gp = await one<{ image: string; polygons: { block: string; points: number[][] }[]; marks: unknown }>('select image, polygons, marks from portal.genplans where project_id = $1', [p.id])
  if (!gp) redirect(`/admin/objects/${p.id}?tab=markup`)
  const bs = await q<{ id: string; name: string; external_id: string | null }>('select id, name, external_id from buildings where project_id = $1 order by sort, name', [p.id])
  return (
    <>
      <Top crumbs={[[T('Объекты'), '/admin/objects'], [p.name, `/admin/objects/${p.id}?tab=markup`], [T('Генплан')]]} title={T('Разметка генплана')} sub={T('Обведите каждый дом по контуру крыши или фасада — так, как его увидит партнёр.')} />
      <div className="page">
        <div className="tabs">{[['', 'Дома'], ['marks', 'Окружение']].map(([k, l]) => <Link key={k} href={k ? '?m=' + k : '?'} className={(searchParams.m || '') === k ? 'on' : ''}>{T(l)}</Link>)}</div>
        {searchParams.m === 'marks' ? <MarksEditor lang={L} src={gp.image} action={saveMarks} hidden={{ project: p.id, target: 'genplan' }}
          initial={cleanMarks(gp.marks)} overlay={(gp.polygons || []).map((x) => ({ points: x.points }))} /> :
        <MarkupEditor lang={L} src={gp.image} action={saveGenplan} hidden={{ project: p.id }}
          items={bs.map((b) => ({ key: b.external_id || b.name, label: b.name }))}
          initial={(gp.polygons || []).map((x) => ({ key: x.block, points: x.points }))} />}
      </div>
    </>
  )
}
