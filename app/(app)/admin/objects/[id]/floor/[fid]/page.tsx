import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { riser } from '@/lib/catalog'
import { Top } from '@/components/ui'
import { MarkupEditor } from '@/components/MarkupEditor'
import { saveFloorPlan } from '@/lib/markup'

// Разметка плана этажа: контур на каждый стояк (на всех этажах диапазона квартира стояка занимает то же место)
export default async function FloorEditor({ params }: { params: { id: string; fid: string } }) {
  const c = await requireCtx()
  if (c.user.role !== 'owner') redirect('/')
  const L = c.lang, T = (s: string) => t(L, s)
  const f = await one<{ id: string; title: string; floor_from: number; floor_to: number; north_deg: number; file_id: string; cells: { riser: string; points: number[][] }[]; building_id: string; building: string; project: string; pname: string }>(
    `select f.id, f.title, f.floor_from, f.floor_to, f.north_deg, f.file_id, f.cells, f.building_id, b.name building, p.id project, p.name pname from portal.floor_plans f join buildings b on b.id = f.building_id join projects p on p.id = b.project_id where f.id = $1`, [params.fid])
  if (!f) notFound()
  const us = await q<{ number: string; floor: number; unit_type: string; area: number | null }>('select number, floor, unit_type, area_total_m2::float area from units where building_id = $1 and floor between $2 and $3', [f.building_id, f.floor_from, f.floor_to])
  const rs = Array.from(new Set(us.map((u) => riser(u)))).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) || a.localeCompare(b))
  return (
    <>
      <Top crumbs={[[T('Объекты'), '/admin/objects'], [f.pname, `/admin/objects/${f.project}?tab=markup`], [`${f.building} · ${f.title}`]]} title={T('Разметка плана этажа')} sub={T('Обведите квартиру каждого стояка. Этажи') + ` ${f.floor_from}–${f.floor_to}`} />
      <div className="page">
        <MarkupEditor lang={L} src={`/files/${f.file_id}`} action={saveFloorPlan}
          hidden={{ project: f.project, id: f.id, title: f.title, floor_from: String(f.floor_from), floor_to: String(f.floor_to), north: String(f.north_deg) }}
          items={rs.map((r) => { const u = us.find((x) => riser(x) === r); return { key: r, label: `${r} · ${u?.unit_type || ''}${u?.area ? ' · ' + u.area + ' m²' : ''}` } })}
          initial={(f.cells || []).map((x) => ({ key: x.riser, points: x.points }))} />
      </div>
    </>
  )
}
