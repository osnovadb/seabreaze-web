// План и факт агентства (М10). Факт — сделки (не расторгнутые) по дате договора: штуки, площадь, объём продаж, наш доход.
// Рынок сделки — рынок клиента; менеджер — seller_id сделки; агентство — агентство партнёра, который вёл бронь.
import { q } from './db'
import type { User } from './auth'

export type Scope = 'market' | 'user' | 'agency'
export type PeriodKind = 'month' | 'quarter'
export type Nums = { units: number; area: number; revenue: number; commission: number }
export type Line = { scope: Scope; id: string; name: string; plan: Partial<Nums> | null; fact: Nums }

export const canSeePlanFact = (role: string) => ['owner', 'market_head', 'finance'].includes(role)
export const canEditPlan = (u: Pick<User, 'role' | 'market'>, scope: Scope, market: string | null) => u.role === 'owner' || (u.role === 'market_head' && !!market && market === u.market)

// Период: месяц 'YYYY-MM' или квартал 'YYYY-Qn' → [начало, конец)
export function period(kind: PeriodKind, key?: string) {
  const now = new Date()
  let y = now.getUTCFullYear(), m = now.getUTCMonth()
  if (kind === 'quarter') {
    const mt = key?.match(/^(\d{4})-Q([1-4])$/); if (mt) { y = +mt[1]; m = (+mt[2] - 1) * 3 } else m = Math.floor(m / 3) * 3
  } else { const mt = key?.match(/^(\d{4})-(\d{2})$/); if (mt) { y = +mt[1]; m = +mt[2] - 1 } }
  const start = new Date(Date.UTC(y, m, 1)), end = new Date(Date.UTC(y, m + (kind === 'quarter' ? 3 : 1), 1))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { kind, start: iso(start), end: iso(end), key: kind === 'quarter' ? `${y}-Q${m / 3 + 1}` : `${y}-${String(m + 1).padStart(2, '0')}` }
}
export function periodKeys(kind: PeriodKind) {
  const out: string[] = [], now = new Date()
  for (let i = -12; i <= 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (kind === 'quarter' ? i * 3 : i), 1))
    const k = kind === 'quarter' ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    if (!out.includes(k)) out.push(k)
  }
  return out.reverse()
}

const DIM: Record<Scope, string> = { market: 'cl.market', user: 'd.seller_id::text', agency: 'ag.agency_id::text' }
async function facts(scope: Scope, start: string, end: string, market: string | null) {
  return q<Nums & { key: string }>(`select ${DIM[scope]} key, count(*)::int units, coalesce(sum(un.area_total_m2), 0)::float area, coalesce(sum(d.final_price), 0)::float revenue, coalesce(sum(d.our_amount), 0)::float commission
    from portal.deals d join portal.clients cl on cl.id = d.client_id join units un on un.id = d.unit_id left join portal.users ag on ag.id = d.agent_id
    where d.stage <> 'cancelled' and d.created_at >= $1 and d.created_at < $2 and ($3::text is null or cl.market = $3) and ${DIM[scope]} is not null group by 1`, [start, end, market])
}
// Строки отчёта: все рынки / менеджеры / агентства в зоне пользователя, даже без факта (чтобы было куда вписать план)
export async function planFact(u: User, kind: PeriodKind, key?: string) {
  const p = period(kind, key)
  const market = u.role === 'market_head' ? u.market : null
  const plans = await q<{ scope: Scope; scope_id: string; units: number | null; area: number | null; revenue: number | null; commission: number | null }>(
    `select scope, scope_id, units, area::float, revenue::float, commission::float from portal.sales_plans where period_kind = $1 and period_start = $2`, [kind, p.start])
  const who: Record<Scope, { id: string; name: string; market: string | null }[]> = {
    market: (market ? [market] : ['DE', 'IL', 'GLOBAL']).map((m) => ({ id: m, name: m, market: m })),
    // менеджеры: действующие продавцы и руководители рынка + все, у кого есть сделки периода (чтобы разрезы сходились)
    user: await q(`select id::text, name, market from portal.users u where ((active and role in ('seller','market_head')) or exists (select 1 from portal.deals d join portal.clients cl on cl.id = d.client_id
        where d.seller_id = u.id and d.stage <> 'cancelled' and d.created_at >= $2 and d.created_at < $3 and ($1::text is null or cl.market = $1))) and ($1::text is null or market = $1 or role not in ('seller','market_head')) order by name`, [market, p.start, p.end]),
    agency: await q(`select id::text, name, market from portal.agencies where ($1::text is null or market = $1) order by name`, [market]),
  }
  const out: Record<Scope, (Line & { market: string | null })[]> = { market: [], user: [], agency: [] }
  for (const scope of ['market', 'user', 'agency'] as Scope[]) {
    const f = new Map((await facts(scope, p.start, p.end, market)).map((r) => [r.key, r]))
    out[scope] = who[scope].map((w) => {
      const pl = plans.find((x) => x.scope === scope && x.scope_id === w.id)
      const fr = f.get(w.id)
      return { scope, id: w.id, name: w.name, market: w.market, plan: pl ? { units: pl.units ?? undefined, area: pl.area ?? undefined, revenue: pl.revenue ?? undefined, commission: pl.commission ?? undefined } : null,
        fact: { units: fr?.units || 0, area: fr?.area || 0, revenue: fr?.revenue || 0, commission: fr?.commission || 0 } }
    })
  }
  return { period: p, lines: out }
}
// Помесячный факт за 12 месяцев
export function monthly(u: User) {
  const market = u.role === 'market_head' ? u.market : null
  return q<Nums & { month: string }>(`select to_char(date_trunc('month', d.created_at), 'YYYY-MM') as month, count(*)::int units, coalesce(sum(un.area_total_m2), 0)::float area,
      coalesce(sum(d.final_price), 0)::float revenue, coalesce(sum(d.our_amount), 0)::float commission
    from portal.deals d join portal.clients cl on cl.id = d.client_id join units un on un.id = d.unit_id
    where d.stage <> 'cancelled' and d.created_at >= date_trunc('month', now()) - interval '11 months' and ($1::text is null or cl.market = $1) group by 1 order by 1`, [market])
}
// Динамика по проекту: средняя цена м² всех квартир проекта с ценой (и проданных) по последней цене месяца (USD, AZN — по курсу) и продажи по месяцам
export function projectDynamics(projectId: string) {
  return q<{ month: string; per_m2: number | null; changes: number; deals: number }>(`with m as (select generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') as m),
    usd as (select azn_per_unit from currency_rates where currency = 'USD' order by valid_from desc limit 1)
    select to_char(m.m, 'YYYY-MM') as month,
      (select avg(case when ph.currency = 'AZN' then ph.price / (select azn_per_unit from usd) else ph.price end / nullif(u.area_total_m2, 0))::float
         from price_history ph join units u on u.id = ph.unit_id where u.project_id = $1 and ph.price is not null and ph.changed_at < m.m + interval '1 month'
           and ph.changed_at = (select max(p2.changed_at) from price_history p2 where p2.unit_id = ph.unit_id and p2.changed_at < m.m + interval '1 month')) per_m2,
      (select count(*)::int from price_history ph join units u on u.id = ph.unit_id where u.project_id = $1 and ph.changed_at >= m.m and ph.changed_at < m.m + interval '1 month') changes,
      (select count(*)::int from portal.deals d where d.project_id = $1 and d.stage <> 'cancelled' and d.created_at >= m.m and d.created_at < m.m + interval '1 month') deals
    from m order by 1`, [projectId])
}
