'use server'
// Сохранение плана продаж (М10): поля формы вида <scope>:<id>:<поле>; пустые поля — «плана нет»
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { period, canEditPlan, type Scope, type PeriodKind } from './planfact'

export async function savePlans(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1') return { error: 'read-only' }
  const kind = (String(f.get('kind')) === 'quarter' ? 'quarter' : 'month') as PeriodKind
  const p = period(kind, String(f.get('key') || ''))
  const rows = new Map<string, Record<string, number | null>>()
  for (const [k, v] of f.entries()) {
    const m = k.match(/^(market|user|agency):([^:]+):(units|area|revenue|commission)$/)
    if (!m) continue
    const val = String(v).replace(/\s/g, '').replace(',', '.')
    const key = m[1] + ':' + m[2]
    rows.set(key, { ...(rows.get(key) || {}), [m[3]]: val === '' ? null : Number(val) })
  }
  // сначала проверяем всё, потом пишем — без частичного сохранения
  for (const vals of rows.values()) {
    if (Object.values(vals).some((x) => x != null && (!Number.isFinite(x) || x < 0))) return { error: 'Числа в плане — неотрицательные' }
    if (vals.units != null && !Number.isInteger(vals.units)) return { error: 'Штуки — целым числом' }
  }
  let n = 0
  for (const [key, vals] of rows) {
    const [scope, id] = key.split(':') as [Scope, string]
    const market = scope === 'market' ? id : (await one<{ market: string | null }>(`select market from portal.${scope === 'user' ? 'users' : 'agencies'} where id = $1`, [id]))?.market ?? null
    if (!canEditPlan(c.user, scope, market)) continue
    if (Object.values(vals).every((x) => x == null)) { await q('delete from portal.sales_plans where period_kind = $1 and period_start = $2 and scope = $3 and scope_id = $4', [kind, p.start, scope, id]); continue }
    // поле, которого нет в запросе, остаётся как было (форма шлёт все четыре; прямой запрос — какие есть)
    const has = (k: string) => (k in vals ? 'true' : 'false')
    await q(`insert into portal.sales_plans (period_kind, period_start, scope, scope_id, units, area, revenue, commission, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (period_kind, period_start, scope, scope_id) do update set units = case when ${has('units')} then $5 else sales_plans.units end, area = case when ${has('area')} then $6 else sales_plans.area end,
        revenue = case when ${has('revenue')} then $7 else sales_plans.revenue end, commission = case when ${has('commission')} then $8 else sales_plans.commission end, updated_by = $9, updated_at = now()`,
      [kind, p.start, scope, id, vals.units ?? null, vals.area ?? null, vals.revenue ?? null, vals.commission ?? null, c.user.id])
    n++
  }
  await audit(c.real.id, 'plan.save', 'sales_plan', p.key, { kind, rows: n })
  revalidatePath('/reports/plan')
  return { ok: true }
}
