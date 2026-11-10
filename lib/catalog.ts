import { q, one } from './db'
import type { User } from './auth'
import { seesAllStatuses } from './perm'
import { PLAN_COLS, type Plan } from './plans'
import { t, type Lang } from './i18n'

export type Project = { sales_status: string; id: string; slug: string; name: string; status: string; delivery: string | null; block_deliveries: string[]; city: string | null; location: string | null; developer: string; units: number; free: number; min_usd: number | null; buildings: number }
export type Building = { id: string; name: string; external_id: string | null; floors_total: number | null; delivery: string | null; units: number; free: number; min_usd: number | null; sort: number }
export type Unit = {
  id: string; project_id: string; building_id: string; building: string; block: string; number: string; floor: number; unit_type: string; bedrooms: number | null
  rooms: number | null; area: number; ext_area: number | null; plot_area: number | null; status: string; external_status: string | null; price: number | null
  usd: number | null; currency: string; plan_file: string | null; layout_code: string | null; synced_at: string; source_id: string
  booking_id: string | null; booking_status: string | null; booking_agent: string | null; booking_client: string | null; booking_ends: string | null; deal_id: string | null
  hidden: boolean; sales_status: string; locked: string[]; delivery: string | null; view_side: string | null; is_corner: boolean | null; finish: string | null
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
// Комнаты как в каталоге и на сайтах: студия = 1, 1br = 2 … (спальни + 1), если застройщик не дал своё число
export const roomsSql = `coalesce((u.raw->>'rooms')::int, case u.unit_type when 'studio' then 1 when '1br' then 2 when '2br' then 3 when '3br' then 4 else u.bedrooms + 1 end)`
// Цена в USD по курсу ЦБ (через AZN), как lib/fx toUsd: USD как есть, AZN / курс USD, EUR × курс EUR / курс USD
const RATE = (cur: string) => `(select azn_per_unit from currency_rates where currency = '${cur}' order by valid_from desc limit 1)`
export const toUsdSql = `case when u.price_currency = 'USD' then u.price_list when u.price_currency = 'AZN' then u.price_list / ${RATE('USD')} when u.price_currency = 'EUR' then u.price_list * ${RATE('EUR')} / ${RATE('USD')} end`

const UNIT_SELECT = `
  select u.id, u.project_id, u.building_id, b.name as building, coalesce(b.external_id, '') as block, u.number, u.floor, u.unit_type, u.bedrooms,
    coalesce((u.raw->>'rooms')::int, case u.unit_type when 'studio' then 1 when '1br' then 2 when '2br' then 3 when '3br' then 4 else u.bedrooms + 1 end) as rooms,
    u.area_total_m2::float as area, u.area_external_m2::float as ext_area, u.plot_area_m2::float as plot_area, u.status, u.external_status,
    u.price_list::float as price, (${toUsdSql})::float as usd, u.price_currency as currency, l.plan_file, l.code as layout_code, u.synced_at, u.source_id,
    bk.id as booking_id, bk.status as booking_status, bk.agent_id as booking_agent, bk.client_id as booking_client, bk.ends_at as booking_ends, dl.id as deal_id,
    exists (select 1 from portal.unit_hidden h where h.unit_id = u.id) as hidden, b.delivery, u.view_side, u.is_corner, u.finish,
    (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(u.locked_fields) x) as locked, coalesce(ps.sales_status, 'draft') as sales_status
  from units u
  left join portal.project_settings ps on ps.project_id = u.project_id
  join buildings b on b.id = u.building_id
  left join layouts l on l.id = u.layout_id
  left join lateral (select id, status, agent_id, client_id, ends_at from portal.bookings x where x.unit_id = u.id and x.status in ('hold','queued','requested','confirmed','release_pending') order by created_at desc limit 1) bk on true
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
         and not exists (select 1 from portal.bookings x where x.unit_id = u.id and x.status in ('hold','queued','requested','confirmed','release_pending'))
         and not exists (select 1 from portal.deals dd where dd.unit_id = u.id and dd.stage <> 'cancelled')${f ? HIDDEN : ''}) as free,
      (select min(${toUsdSql})::float from units u where u.project_id = p.id and u.status = 'available' and u.price_list is not null${f ? HIDDEN : ''}) as min_usd,
      (select count(*)::int from buildings b where b.project_id = p.id) as buildings,
      (select coalesce(array_agg(b.delivery order by b.sort, b.name) filter (where b.delivery is not null), '{}') from buildings b where b.project_id = p.id) as block_deliveries
    from projects p join developers d on d.id = p.developer_id ${f ? 'where ' + visibleSql('p') : ''} order by p.sort, p.name`, f ? [viewer!.id, viewer!.agency_id, viewer!.market] : [])
}
export const projectBySlug = async (slug: string, viewer?: User | null) => (await listProjects(viewer)).find((p) => p.slug === slug)
export const projectVisible = async (projectId: string, viewer: User) => (await listProjects(viewer)).some((p) => p.id === projectId)

export async function buildingsOf(projectId: string, viewer?: User | null): Promise<Building[]> {
  const f = ext(viewer)
  return q<Building>(`
    select b.id, b.name, b.external_id, b.floors_total, b.delivery, b.sort, count(u.*)::int as units,
      count(*) filter (where u.status = 'available' and u.price_list is not null
        and not exists (select 1 from portal.bookings x where x.unit_id = u.id and x.status in ('hold','queued','requested','confirmed','release_pending'))
        and not exists (select 1 from portal.deals dd where dd.unit_id = u.id and dd.stage <> 'cancelled')${f ? HIDDEN : ''})::int as free,
      min(${toUsdSql}) filter (where u.status = 'available' and u.price_list is not null)::float as min_usd
    from buildings b left join units u on u.building_id = b.id where b.project_id = $1 group by b.id order by b.sort, b.name`, [projectId])
}

export const unitsOfBuilding = (buildingId: string) => q<Unit>(`${UNIT_SELECT} where u.building_id = $1 order by u.floor desc, u.number`, [buildingId])
export const unitsOfProjects = (ids: string[]) => (ids.length ? q<Unit>(`${UNIT_SELECT} where u.project_id = any($1) order by b.sort, b.name, u.floor, u.number`, [ids]) : Promise.resolve([] as Unit[]))
export const unitsOfProject = (projectId: string) => q<Unit>(`${UNIT_SELECT} where u.project_id = $1 order by b.sort, b.name, u.floor, u.number`, [projectId])
export const unitById = (id: string) => one<Unit>(`${UNIT_SELECT} where u.id = $1`, [id])
export const unitsByIds = (ids: string[]) => (ids.length ? q<Unit>(`${UNIT_SELECT} where u.id = any($1)`, [ids]) : Promise.resolve([] as Unit[]))

// client — «текущий клиент» вкладки Bitrix24: своя бронь для ДРУГОГО клиента — не «ваша бронь» (QA 09.11: у Tom Weiss висела бронь Anna)
export function codeFor(u: Unit, viewer: User | null, mode: 'team' | 'agent' | 'show', client?: string | null): Code {
  const mine = !!u.booking_id && !!viewer && u.booking_agent === viewer.id && (!client || u.booking_client === client)
  const free = u.status === 'available' && u.price != null
  if (mode === 'show') return free && !u.hidden && !u.booking_id && !u.deal_id ? 'F' : 'X'
  if (mode === 'agent') {
    if (u.hidden) return 'X'
    if (mine) return 'M'
    return free && !u.booking_id && !u.deal_id ? 'F' : 'X'
  }
  if (u.deal_id) return 'D'
  if (u.booking_id) return mine ? 'M' : 'O'
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
// Номер для показа — как portal.unit_no в базе: с префиксом корпуса, если его ещё нет в номере (BRABUS «A-0305» как есть)
export const unitNo = (u: { block: string; number: string }) => (/^[A-ZА-Я]{1,3}-/i.test(u.number) || !u.block ? u.number : `${u.block}-${u.number}`).toUpperCase()
export const planUrl = (fileId: string | null) => (fileId ? `/plan/${fileId}` : null)

// Коммерческие условия: последняя опубликованная версия на дату, плюс индивидуальная ставка агента
export type Conditions = {
  id: string; project_id: string; version: number; status: string; valid_from: string; fix_pct: number; pool_pct: number
  agent_fix_pct: number; agent_pool_pct: number; agent_our_pool_share: number; seller_share_pct: number; seller_self_disc: number; seller_max_disc: number
  booking_days: number; booking_ext_days: number; protect_months: number; max_bookings_client: number; max_bookings_agent: number; max_bookings_total: number
  pay_timing: string; payment_plans: { name: string; note: string }[]; note: string | null; created_at: string; booking_fee: number; booking_fee_currency: string
  // 2.2 · условия договора на проект
  reg_method?: string; reg_response_days?: number; silence_rule?: string; silence_extra_days?: number; reg_protect_months?: number; reg_protect_months_sub?: number | null
  renew_remind_days?: number; booking_write_api?: boolean; rates_by_market?: Record<string, number>; vat_mode?: string; options_in_base?: boolean; fx_rule?: string | null
  clawback_months?: number; clawback_offset?: string; payment_wait_days?: number; sells_to_az?: boolean
  // 2.2 · §8 ставки ролей
  head_bonus_pct?: number; escort_fix_usd?: number; referrer_pct?: number; consultant_pct?: number; vat_rate?: number; consultant_name?: string | null
}
const COND = `id, project_id, version, status, valid_from::text valid_from, fix_pct::float, pool_pct::float, agent_fix_pct::float, agent_pool_pct::float, agent_our_pool_share::float, seller_share_pct::float,
  seller_self_disc::float, seller_max_disc::float, booking_days, booking_ext_days, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing, payment_plans, note, created_at, booking_fee::float, booking_fee_currency,
  reg_method, reg_response_days, silence_rule, silence_extra_days, reg_protect_months, reg_protect_months_sub, renew_remind_days, booking_write_api, rates_by_market, vat_mode,
  options_in_base, fx_rule, clawback_months, clawback_offset, payment_wait_days, sells_to_az,
  head_bonus_pct::float, escort_fix_usd::float, referrer_pct::float, consultant_pct::float, vat_rate::float, consultant_name`
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
// Ориентация конкретной квартиры. Вид квартиры (units.view_side) главнее стояка: на этажах с другой нарезкой
// (1–2-й, 12-й у Premium) тот же номер стояка стоит в другом месте плана. Сторону света и примечание стояка
// показываем, только если вид квартиры с ним совпадает.
export function orientOf(u: { number: string; floor: number; view_side: string | null }, ri: Map<string, RiserInfo>) {
  const r = ri.get(riser(u)), view = u.view_side ?? r?.view_side ?? null
  const same = !!r && (!u.view_side || r.view_side === u.view_side)
  return { view, direction: same ? r!.direction : null, note: same ? r!.note : null }
}
export const orientText = (lang: Lang, o: ReturnType<typeof orientOf>) =>
  [o.view ? t(lang, VIEW_NAME[o.view]) : '', o.direction ? t(lang, 'окна на {d}', { d: t(lang, DIR_NAME[o.direction]) }) : ''].filter(Boolean).join(' · ')
// Типы помещений (14 у Profitbase → наши 12): квартиры, дома, коммерция, машиноместа и кладовки
export const TYPE_NAME: Record<string, string> = { studio: 'Студия', '1br': '1 спальня', '2br': '2 спальни', '3br': '3 спальни', '4br': '4 спальни', duplex: 'Дуплекс', penthouse: 'Пентхаус',
  townhouse: 'Таунхаус', villa: 'Вилла', commercial: 'Коммерция', parking: 'Машиноместо', storage: 'Кладовка' }
export const UNIT_TYPES = Object.keys(TYPE_NAME)
// Жильё — то, у чего есть комнаты; машиноместа, кладовки и коммерция в «квартиры» не считаются
export const isLiving = (t: string) => !['commercial', 'parking', 'storage'].includes(t)
export const VIEW_NAME: Record<string, string> = { sea: 'на море', marina: 'на марину', park: 'на парк', yard: 'во двор', city: 'на улицу', mixed: 'на две стороны' }
export const DIR_NAME: Record<string, string> = { N: 'север', NE: 'северо-восток', E: 'восток', SE: 'юго-восток', S: 'юг', SW: 'юго-запад', W: 'запад', NW: 'северо-запад' }

// Планы оплаты квартиры: весь проект или её блок, действующие сегодня
export const plansFor = (projectId: string, buildingId: string | null) => q<Plan>(`select ${PLAN_COLS} from payment_plans
  where project_id = $1 and (building_id is null or building_id = $2) and (valid_from is null or valid_from <= current_date) and (valid_to is null or valid_to >= current_date) order by sort, name`, [projectId, buildingId])
