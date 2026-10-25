import { q, one } from './db'
import type { User } from './auth'
import { seesAllStatuses } from './perm'
import { PLAN_COLS, type Plan } from './plans'

export type Project = { sales_status: string; id: string; slug: string; name: string; status: string; delivery: string | null; city: string | null; location: string | null; developer: string; units: number; free: number; min_usd: number | null; buildings: number }
export type Building = { id: string; name: string; external_id: string | null; floors_total: number | null; delivery: string | null; units: number; free: number; min_usd: number | null; sort: number }
export type Unit = {
  id: string; project_id: string; building_id: string; building: string; block: string; number: string; floor: number; unit_type: string; bedrooms: number | null
  rooms: number | null; area: number; ext_area: number | null; plot_area: number | null; status: string; external_status: string | null; price: number | null
  usd: number | null; currency: string; plan_file: string | null; layout_code: string | null; synced_at: string; source_id: string
  booking_id: string | null; booking_status: string | null; booking_agent: string | null; booking_ends: string | null; deal_id: string | null
  hidden: boolean; sales_status: string; locked: string[]; delivery: string | null
}
// Код статуса в шахматке: F свободно, B бронь застройщика, S продано, N не в продаже, SB квота SeaBreeze,
// O наша бронь, M моя бронь, D наша сделка, X недоступно (для агента и показа)
export type Code = 'F' | 'B' | 'S' | 'N' | 'SB' | 'O' | 'M' | 'D' | 'X'

let rateCache: { v: number; at: number } | null = null
export async function aznPerUsd() {
  if (rateCache && Date.now() - rateCache.at < 3600_000) return rateCache.v
  const r = await one<{ azn_per_unit: string }>(`select azn_per_unit from currency_rates where currency = 'USD' order by valid_from desc limit 1`)
  rateCache = { v: Number(r?.azn_per_unit || 1.7), at: Date.now() }
  return rateCache.v
}
export const toUsdSql = `case when u.price_currency = 'USD' then u.price_list when u.price_currency = 'AZN' then u.price_list / (select azn_per_unit from currency_rates where currency = 'USD' order by valid_from desc limit 1) end`

const UNIT_SELECT = `
  select u.id, u.project_id, u.building_id, b.name as building, coalesce(b.external_id, left(b.name, 1)) as block, u.number, u.floor, u.unit_type, u.bedrooms,
    coalesce((u.raw->>'rooms')::int, case u.unit_type when 'studio' then 1 when '1br' then 2 when '2br' then 3 when '3br' then 4 else u.bedrooms + 1 end) as rooms,
    u.area_total_m2::float as area, u.area_external_m2::float as ext_area, u.plot_area_m2::float as plot_area, u.status, u.external_status,
    u.price_list::float as price, (${toUsdSql})::float as usd, u.price_currency as currency, l.plan_file, l.code as layout_code, u.synced_at, u.source_id,
    bk.id as booking_id, bk.status as booking_status, bk.agent_id as booking_agent, bk.ends_at as booking_ends, dl.id as deal_id,
    exists (select 1 from portal.unit_hidden h where h.unit_id = u.id) as hidden, b.delivery,
    (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(u.locked_fields) x) as locked, coalesce(ps.sales_status, 'draft') as sales_status
  from units u
  left join portal.project_settings ps on ps.project_id = u.project_id
  join buildings b on b.id = u.building_id
  left join layouts l on l.id = u.layout_id
  left join lateral (select id, status, agent_id, ends_at from portal.bookings x where x.unit_id = u.id and x.status in ('requested','confirmed') order by created_at desc limit 1) bk on true
  left join lateral (select id from portal.deals d where d.unit_id = u.id and d.stage <> 'cancelled' limit 1) dl on true`

// Видимость для партнёров: статус «в продаже» или «стоп-продажи», рынок открыт или исключение «открыть»; исключение «закрыть» сильнее рынка.
// Команда видит все проекты, включая черновики.
export const visibleSql = (alias: string) => `exists (select 1 from portal.project_settings ps where ps.project_id = ${alias}.id and ps.sales_status in ('sales','stop')
  and not exists (select 1 from portal.project_exceptions x where x.project_id = ${alias}.id and not x.allow and (x.user_id = $1 or x.agency_id = $2))
  and ($3 = any(ps.agent_markets) or exists (select 1 from portal.project_exceptions x where x.project_id = ${alias}.id and x.allow and (x.user_id = $1 or x.agency_id = $2))))`
// Скрытые от партнёров квартиры не входят в «свободно» и «цена от» у партнёров
const HIDDEN = ' and not exists (select 1 from portal.unit_hidden h where h.unit_id = u.id)'
const ext = (v?: User | null) => !!v && (v.role === 'agent' || v.role === 'agency_head')

export async function listProjects(viewer?: User | null): Promise<Project[]> {
  const f = ext(viewer)
  return q<Project>(`
    select coalesce((select sales_status from portal.project_settings ps where ps.project_id = p.id), 'draft') as sales_status, p.id, p.slug, p.name, p.status, p.delivery, p.city, p.location, d.name as developer,
      (select count(*)::int from units u where u.project_id = p.id) as units,
      (select count(*)::int from units u where u.project_id = p.id and u.status = 'available' and u.price_list is not null
         and not exists (select 1 from portal.bookings x where x.unit_id = u.id and x.status in ('requested','confirmed'))
         and not exists (select 1 from portal.deals dd where dd.unit_id = u.id and dd.stage <> 'cancelled')${f ? HIDDEN : ''}) as free,
      (select min(${toUsdSql})::float from units u where u.project_id = p.id and u.status = 'available' and u.price_list is not null${f ? HIDDEN : ''}) as min_usd,
      (select count(*)::int from buildings b where b.project_id = p.id) as buildings
    from projects p join developers d on d.id = p.developer_id ${f ? 'where ' + visibleSql('p') : ''} order by p.sort, p.name`, f ? [viewer!.id, viewer!.agency_id, viewer!.market] : [])
}
export const projectBySlug = async (slug: string, viewer?: User | null) => (await listProjects(viewer)).find((p) => p.slug === slug)
export const projectVisible = async (projectId: string, viewer: User) => (await listProjects(viewer)).some((p) => p.id === projectId)

export async function buildingsOf(projectId: string, viewer?: User | null): Promise<Building[]> {
  const f = ext(viewer)
  return q<Building>(`
    select b.id, b.name, b.external_id, b.floors_total, b.delivery, b.sort, count(u.*)::int as units,
      count(*) filter (where u.status = 'available' and u.price_list is not null
        and not exists (select 1 from portal.bookings x where x.unit_id = u.id and x.status in ('requested','confirmed'))
        and not exists (select 1 from portal.deals dd where dd.unit_id = u.id and dd.stage <> 'cancelled')${f ? HIDDEN : ''})::int as free,
      min(${toUsdSql}) filter (where u.status = 'available' and u.price_list is not null)::float as min_usd
    from buildings b left join units u on u.building_id = b.id where b.project_id = $1 group by b.id order by b.sort, b.name`, [projectId])
}

export const unitsOfBuilding = (buildingId: string) => q<Unit>(`${UNIT_SELECT} where u.building_id = $1 order by u.floor desc, u.number`, [buildingId])
export const unitsOfProject = (projectId: string) => q<Unit>(`${UNIT_SELECT} where u.project_id = $1 order by b.sort, b.name, u.floor, u.number`, [projectId])
export const unitById = (id: string) => one<Unit>(`${UNIT_SELECT} where u.id = $1`, [id])
export const unitsByIds = (ids: string[]) => (ids.length ? q<Unit>(`${UNIT_SELECT} where u.id = any($1)`, [ids]) : Promise.resolve([] as Unit[]))

export function codeFor(u: Unit, viewer: User | null, mode: 'team' | 'agent' | 'show'): Code {
  const free = u.status === 'available' && u.price != null
  if (mode === 'show') return free && !u.hidden && !u.booking_id && !u.deal_id ? 'F' : 'X'
  if (mode === 'agent') {
    if (u.hidden) return 'X'
    if (u.booking_id && viewer && u.booking_agent === viewer.id) return 'M'
    return free && !u.booking_id && !u.deal_id ? 'F' : 'X'
  }
  if (u.deal_id) return 'D'
  if (u.booking_id) return viewer && u.booking_agent === viewer.id ? 'M' : 'O'
  if (free) return 'F'
  if (u.status === 'reserved') return 'B'
  if (u.status === 'sold') return 'S'
  if (u.external_status === 'SeaBreeze') return 'SB'
  return 'N'
}
export const viewMode = (u: User, show: boolean): 'team' | 'agent' | 'show' => (show ? 'show' : seesAllStatuses(u.role) ? 'team' : 'agent')

// Позиция на этаже: 808 → «08», 808d → «08d», A-0305 → «05», A-D01 → «D01»
export function riser(u: { number: string; floor: number }) {
  const n = u.number.replace(/^[A-Z]-/, '')
  const m = n.match(/^(\d+)(.*)$/)
  if (m && m[1].length >= 3) return m[1].slice(-2) + m[2]
  return n
}
export const unitNo = (u: { block: string; number: string }) => (u.number.startsWith(u.block + '-') ? u.number : `${u.block}-${u.number}`).toUpperCase()
export const planUrl = (fileId: string | null) => (fileId ? `/plan/${fileId}` : null)

// Коммерческие условия: последняя опубликованная версия на дату, плюс индивидуальная ставка агента
export type Conditions = {
  id: string; project_id: string; version: number; status: string; valid_from: string; fix_pct: number; pool_pct: number
  agent_fix_pct: number; agent_pool_pct: number; agent_our_pool_share: number; seller_share_pct: number; seller_self_disc: number; seller_max_disc: number
  booking_days: number; booking_ext_days: number; protect_months: number; max_bookings_client: number; max_bookings_agent: number; max_bookings_total: number
  pay_timing: string; payment_plans: { name: string; note: string }[]; note: string | null; created_at: string
}
const COND = `id, project_id, version, status, valid_from, fix_pct::float, pool_pct::float, agent_fix_pct::float, agent_pool_pct::float, agent_our_pool_share::float, seller_share_pct::float,
  seller_self_disc::float, seller_max_disc::float, booking_days, booking_ext_days, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing, payment_plans, note, created_at`
export async function conditionsFor(projectId: string, agent?: User | null): Promise<Conditions | undefined> {
  const c = await one<Conditions>(`select ${COND} from portal.conditions where project_id = $1 and status = 'published' and valid_from <= current_date order by valid_from desc, version desc limit 1`, [projectId])
  if (!c || !agent) return c
  const r = await one<{ agent_fix_pct: number; agent_pool_pct: number }>(`select agent_fix_pct::float, agent_pool_pct::float from portal.agent_rates
    where project_id = $1 and (agent_id = $2 or (agency_id is not null and agency_id = $3) or (market is not null and market = $4)) order by (agent_id is not null) desc, (agency_id is not null) desc limit 1`,
    [projectId, agent.id, agent.agency_id, agent.market])
  return r ? { ...c, ...r } : c
}
export const conditionVersions = (projectId: string) => q<Conditions>(`select ${COND} from portal.conditions where project_id = $1 order by version desc`, [projectId])

export { split } from './money'

// Ориентация стояков блока: вид из окон и сторона света (Объекты → Ориентация)
export type RiserInfo = { view_side: string | null; direction: string | null; note: string | null }
export async function riserInfo(buildingId: string) {
  const rows = await q<RiserInfo & { riser: string }>('select riser, view_side, direction, note from portal.riser_info where building_id = $1', [buildingId])
  return new Map(rows.map((r) => [r.riser, r]))
}
export const VIEW_NAME: Record<string, string> = { sea: 'на море', marina: 'на марину', park: 'на парк', yard: 'во двор', city: 'на улицу', mixed: 'на две стороны' }
export const DIR_NAME: Record<string, string> = { N: 'север', NE: 'северо-восток', E: 'восток', SE: 'юго-восток', S: 'юг', SW: 'юго-запад', W: 'запад', NW: 'северо-запад' }

// Планы оплаты квартиры: весь проект или её блок, действующие сегодня
export const plansFor = (projectId: string, buildingId: string | null) => q<Plan>(`select ${PLAN_COLS} from payment_plans
  where project_id = $1 and (building_id is null or building_id = $2) and (valid_from is null or valid_from <= current_date) and (valid_to is null or valid_to >= current_date) order by sort, name`, [projectId, buildingId])
