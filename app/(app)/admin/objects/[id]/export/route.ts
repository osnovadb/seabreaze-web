import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { makeXlsx } from '@/lib/xlsx'
import { COLS } from '@/lib/chessImport'
import { TYPE_NAME } from '@/lib/catalog'
import { isUuid } from '@/lib/ids'

// Шахматка проекта в xlsx — она же шаблон для импорта: поправили цены или статусы и загрузили обратно
export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isUuid(params.id)) return new Response('not found', { status: 404 })
  const c = await requireCtx()
  if (c.user.role !== 'owner') return new Response('forbidden', { status: 403 })
  const p = await one<{ slug: string }>('select slug from projects where id = $1', [params.id])
  if (!p) return new Response('not found', { status: 404 })
  const T = (s: string) => t(c.lang, s)
  const rows = await q<any>(`select coalesce(b.external_id, b.name) block, u.floor, u.number, u.unit_type, u.bedrooms, u.area_total_m2::float area, u.area_external_m2::float terrace, u.plot_area_m2::float garden,
      l.code layout, u.price_list::float price, u.price_currency currency, u.status, u.view_side, u.is_corner from units u join buildings b on b.id = u.building_id left join layouts l on l.id = u.layout_id
    where u.project_id = $1 order by b.sort, b.name, u.floor desc, u.number`, [params.id])
  const ST: Record<string, string> = { available: 'свободна', reserved: 'бронь', sold: 'продана', unavailable: 'не в продаже' }
  const buf = makeXlsx([{ name: T('Шахматка'), rows: [COLS.map(([, ru]) => ru), ...rows.map((r) => [r.block, r.floor, r.number, TYPE_NAME[r.unit_type]?.toLowerCase() || r.unit_type, r.bedrooms, r.area, r.terrace, r.garden, r.layout, r.price, r.currency, ST[r.status] || r.status, r.view_side || '', r.is_corner ? 'да' : ''])] }])
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="chess-${p.slug}-${new Date().toISOString().slice(0, 10)}.xlsx"` } })
}
