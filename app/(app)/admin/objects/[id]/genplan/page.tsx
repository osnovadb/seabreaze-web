import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { Top } from '@/components/ui'
import { MarkupEditor } from '@/components/MarkupEditor'
import { saveGenplan } from '@/lib/markup'

// Разметка генплана: контур на каждый дом (блок)
export default async function GenplanEditor({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  if (c.user.role !== 'owner') redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const p = await one<{ id: string; name: string }>('select id, name from projects where id = $1', [params.id])
  if (!p) notFound()
  const gp = await one<{ image: string; polygons: { block: string; points: number[][] }[] }>('select image, polygons from portal.genplans where project_id = $1', [p.id])
  if (!gp) redirect(`/admin/objects/${p.id}?tab=markup`)
  const bs = await q<{ id: string; name: string; external_id: string | null }>('select id, name, external_id from buildings where project_id = $1 order by sort, name', [p.id])
  return (
    <>
      <Top crumbs={[[T('Объекты'), '/admin/objects'], [p.name, `/admin/objects/${p.id}?tab=markup`], [T('Генплан')]]} title={T('Разметка генплана')} sub={T('Обведите каждый дом по контуру крыши или фасада — так, как его увидит партнёр.')} />
      <div className="page">
        <MarkupEditor lang={L} src={gp.image} action={saveGenplan} hidden={{ project: p.id }}
          items={bs.map((b) => ({ key: b.external_id || b.name, label: b.name }))}
          initial={(gp.polygons || []).map((x) => ({ key: x.block, points: x.points }))} />
      </div>
    </>
  )
}
