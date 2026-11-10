import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import type { VariantParams } from '@/lib/variants'
import { t, m2 } from '@/lib/i18n'
import { activeGrid } from '@/lib/calc'
import { downGridFor, unitById, conditionsFor, viewMode, codeFor, planUrl, unitNo, projectVisible, plansFor } from '@/lib/catalog'
import { isExternal, maxDiscount, canBook, discountCeiling } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { Top } from '@/components/ui'
import { BookForm } from './form'
import { fxFor } from '@/lib/fx'
import { promoForUnit } from '@/lib/promo'
import { optionsFor } from '@/lib/options'

export default async function Book(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ client?: string; variant?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const u = await unitById(params.id)
  if (!u || !(codeFor(u, c.user, viewMode(c.user, false)) === 'F' || (u.booking_status === 'hold' && u.booking_agent === c.user.id)) || !canBook(c.user.role) || u.sales_status !== 'sales' || (isExternal(c.user.role) && !(await projectVisible(u.project_id, c.user)))) notFound()
  const ext = isExternal(c.user.role)
  const cond = await conditionsFor(u.project_id, ext ? c.user : null)
  if (!cond) return <><Top title={T('Бронь {n}', { n: unitNo(u) })} /><div className="page"><div className="note">{T('Для проекта не заведены условия')}. {T('Брони откроются, когда владелец опубликует коммерческие условия проекта.')}</div></div></>
  const cs = clientScope(c.user)
  const clients = await q<{ id: string; name: string; reg_no: string }>(`select id, name, reg_no from portal.clients cl where ${cs.sql} and stage not in ('handed') and cl.anonymized_at is null and (protected_until is null or protected_until >= current_date) order by last_activity_at desc`, cs.params)
  const proj = (await q<{ name: string }>('select name from projects where id = $1', [u.project_id]))[0]
  const plans = await plansFor(u.project_id, u.building_id)
  const fx = await fxFor(c.user.market, L)
  const { promo, mode } = await promoForUnit(u)
  const options = await optionsFor(u)
  // Этап 3 калькулятора: бронь из варианта — переносим план, скидку, взнос и срок; несогласованный вариант не переносим
  const vr = searchParams.variant && /^[0-9a-f-]{36}$/.test(searchParams.variant) ? await one<{ id: string; name: string; params: VariantParams; client_id: string | null }>(
    `select id, name, params, client_id from portal.calc_variants where id = $1 and unit_id = $2 and (not needs_approval or approved_at is not null)
       and (author_id = $3 or $4 or (not $5 and client_id in (select id from portal.clients cl where ${cs.sql.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + 5))})))`, [searchParams.variant, u.id, c.user.id, ['owner', 'market_head'].includes(c.user.role), ext, ...cs.params]) : null
  // Активные брони тех же клиентов — к ним можно добавить эту квартиру пакетом (одним договором)
  const pkgs = clients.length ? await q<{ id: string; client_id: string; unit: string }>(`select b.id, b.client_id, portal.unit_no(bl.external_id, un.number) unit from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id
    where b.client_id = any($1) and b.status in ('requested','confirmed') and b.unit_id <> $2 order by b.created_at`, [clients.map((x) => x.id), u.id]) : []
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [proj.name], [unitNo(u), `/units/${u.id}`], [T('Бронь')]]} title={T('Бронь {n}', { n: unitNo(u) })}
        sub={`${T('{r} комн.', { r: u.rooms ?? '—' })} · ${m2(L, u.area)} · ${T('{f} этаж', { f: u.floor })} · ${T('условия проекта, версия {v}', { v: cond.version })}`} />
      <div className="page split-l">
        <div className="card">{planUrl(u.plan_file) ? <div className="planbox" style={{ border: 0 }}><img src={planUrl(u.plan_file)!} alt="" /></div> : <div className="muted">{T('План появится позже')}</div>}</div>
        <BookForm lang={L} unitId={u.id} list={u.usd!} ext={ext} cap={maxDiscount(c.user.role, cond)} ceiling={discountCeiling(c.user.role, cond)} cond={{ fix_pct: cond.fix_pct, pool_pct: cond.pool_pct, agent_fix_pct: cond.agent_fix_pct, agent_pool_pct: cond.agent_pool_pct, agent_our_pool_share: cond.agent_our_pool_share, seller_share_pct: cond.seller_share_pct, fix_base: cond.fix_base || 'final' }}
          grid={activeGrid(await downGridFor(u.project_id), new Date().toISOString().slice(0, 10), u.building_id)}
          days={cond.booking_days} ext_days={cond.booking_ext_days} clients={clients} plans={plans} fx={fx} promo={promo} mode={mode} options={options} pkgs={pkgs} fee={cond.booking_fee > 0 ? { amount: cond.booking_fee, cur: cond.booking_fee_currency } : null} preset={searchParams.client || vr?.client_id || (await cookies()).get('ge_client')?.value}
          variant={vr ? { id: vr.id, name: vr.name, disc: Number(vr.params.disc) || 0, planId: vr.params.planId || null, downPct: vr.params.downPct, months: vr.params.months, start: vr.params.start || null } : null} showOurs={c.user.role === 'owner' || c.user.role === 'market_head'} />
      </div>
    </>
  );
}
