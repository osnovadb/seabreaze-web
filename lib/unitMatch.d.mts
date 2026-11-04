export type UnitFilter = {
  project: string | null; building: string | null; types: string[]; rooms: number[]
  pmin: number | null; pmax: number | null; amin: number | null; amax: number | null; fmin: number | null; fmax: number | null
  view: string | null; outdoor: 'g' | 't' | null; corner: boolean; promo: boolean
}
export function normFilter(f?: Record<string, unknown>): UnitFilter
export function matchUnit(u: { project_id: string; building_id: string; unit_type: string; rooms: number | null; usd: number | null; net?: number | null; area: number; floor: number; view_side: string | null; plot_area: number | null; ext_area: number | null; is_corner?: boolean | null; promo?: unknown }, f: UnitFilter): boolean
