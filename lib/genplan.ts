// Генплан проекта с ракурсами (Денис 11.11: «покрутить здание прям там»): основной вид + дополнительные из genplans.views
import { one } from './db'

export type GpPoly = { block: string; points: [number, number][]; label: [number, number] }
export type GpView = { title: string | null; image: string; polygons: GpPoly[] }
export async function genplanOf(projectId: string) {
  const g = await one<{ image: string; polygons: GpPoly[]; note: string | null; marks: unknown; title: string | null; views: GpView[] | null }>(
    'select image, polygons, note, marks, title, views from portal.genplans where project_id = $1', [projectId])
  if (!g) return null
  const views: GpView[] = [{ title: g.title, image: g.image, polygons: g.polygons || [] }, ...(g.views || []).filter((v) => v && v.image)]
  return { note: g.note, marks: g.marks, views }
}
// номер ракурса из адреса (?v=), в пределах списка
export const viewIndex = (raw: string | undefined, n: number) => Math.min(Math.max(0, Number(raw) || 0), Math.max(0, n - 1))
