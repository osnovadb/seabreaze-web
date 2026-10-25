import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { Top } from '@/components/ui'
import { FacadeEditor } from '@/components/FacadeEditor'
import { saveFacade } from '@/lib/markup'

// Калибровка фасада: четыре угла сетки окон, стояки и этажи
export default async function FacadeCal({ params }: { params: { id: string; fid: string } }) {
  const c = await requireCtx()
  if (c.user.role !== 'owner') redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const f = await one<{ id: string; title: string; risers: string[]; floor_from: number; floor_to: number; quad: number[][] | null; file_id: string; building: string; project: string; pname: string }>(
    `select f.id, f.title, f.risers, f.floor_from, f.floor_to, f.quad, f.file_id, b.name building, p.id project, p.name pname from portal.facades f join buildings b on b.id = f.building_id join projects p on p.id = b.project_id where f.id = $1`, [params.fid])
  if (!f) notFound()
  return (
    <>
      <Top crumbs={[[T('Объекты'), '/admin/objects'], [f.pname, `/admin/objects/${f.project}?tab=markup`], [`${f.building} · ${f.title}`]]} title={T('Калибровка фасада')} sub={T('Сетка должна лечь на окна: тогда партнёр увидит квартиры прямо на фото дома.')} />
      <div className="page">
        <FacadeEditor lang={L} src={`/files/${f.file_id}`} id={f.id} project={f.project} action={saveFacade}
          initial={{ title: f.title, risers: f.risers, floor_from: f.floor_from, floor_to: f.floor_to, quad: f.quad }} />
      </div>
    </>
  )
}
