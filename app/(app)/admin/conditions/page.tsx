import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date, pct } from '@/lib/i18n'
import { listProjects, conditionVersions, unitsOfProject, marketOverflow, type Conditions } from '@/lib/catalog'
import { canEditConditions } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { CondForm } from './form'
import { developerOfProject } from '@/lib/developers'
import { saveAgentRate, saveAgentRateState } from '@/lib/actions'
import { ActionForm } from '@/components/ActionForm'

// Первая версия условий нового проекта: значения по умолчанию как у Premium (5% + пул 20%, партнёру 2% + 10%), правятся перед публикацией
const defaults = (projectId: string): Conditions => ({ id: '', project_id: projectId, version: 1, status: 'draft', valid_from: new Date().toISOString().slice(0, 10), fix_pct: 5, pool_pct: 20,
  agent_fix_pct: 2, agent_pool_pct: 10, agent_our_pool_share: 0, seller_share_pct: 15, seller_self_disc: 10, seller_max_disc: 20, booking_days: 14, booking_ext_days: 14, protect_months: 3,
  max_bookings_client: 3, max_bookings_agent: 3, max_bookings_total: 10, pay_timing: 'after_first_payment', payment_plans: [], note: null, created_at: '', booking_fee: 0, booking_fee_currency: 'USD', head_bonus_pct: 0, escort_fix_usd: 500, referrer_pct: 2, consultant_pct: 1, vat_rate: 18 })

export default async function Conditions(props: { searchParams: Promise<{ p?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!['owner', 'market_head', 'finance'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ps = await listProjects()
  const p = ps.find((x) => x.slug === searchParams.p) || ps.find((x) => x.slug === 'premium-residence') || ps[0]
  const vers = await conditionVersions(p.id)
  const cur = vers.find((v) => v.status === 'draft') || vers.find((v) => v.status === 'published')
  // Первая версия нового проекта — значения из карточки застройщика
  const dv = cur ? null : await developerOfProject(p.id)
  const fresh = (): Conditions => ({ ...defaults(p.id), ...(dv ? { reg_method: dv.reg_method, reg_response_days: dv.reg_response_days, silence_rule: dv.silence_rule, silence_extra_days: dv.silence_extra_days,
    reg_protect_months: dv.protect_months, reg_protect_months_sub: dv.protect_months_sub, renew_remind_days: dv.renew_remind_days, booking_days: dv.booking_days, booking_ext_days: dv.booking_ext_days,
    max_bookings_total: dv.max_bookings_total, booking_write_api: dv.booking_write_api, rates_by_market: dv.rates_by_market, vat_mode: dv.vat_mode, options_in_base: dv.options_in_base, fx_rule: dv.fx_rule,
    clawback_months: dv.clawback_months, clawback_offset: dv.clawback_offset, payment_wait_days: dv.payment_wait_days, sells_to_az: dv.sells_to_az, fix_pct: dv.commission_pct ?? 5 } : {}) })
  const rates = await q<{ id: string; who: string; agent_fix_pct: number; agent_pool_pct: number; referrer_pct: number | null; note: string | null }>(`select r.id, coalesce(a.name, u.name, r.market, '—') who, r.agent_fix_pct::float, r.agent_pool_pct::float, r.referrer_pct::float, r.note from portal.agent_rates r left join portal.agencies a on a.id = r.agency_id left join portal.users u on u.id = r.agent_id where r.project_id = $1`, [p.id])
  // 344 (11.11): на каком рынке партнёр + консультант + рекомендатель больше нашего фикса (по действующей версии)
  const live = vers.find((v) => v.status === 'published')
  const over = live ? marketOverflow(live, await q<{ market: string | null; agent_fix_pct: number; referrer_pct: number | null }>(`select market, agent_fix_pct::float, referrer_pct::float from portal.agent_rates where project_id = $1 and market is not null and agent_id is null and agency_id is null`, [p.id])) : []
  const edit = canEditConditions(c.user.role)
  const whoList = edit ? await q<{ v: string; l: string }>(`select 'agency:' || id v, name l from portal.agencies union all select 'user:' || id, name from portal.users where active and role in ('agent','agency_head') order by 2`) : []
  const units = await unitsOfProject(p.id)
  const ex = units.find((u) => u.block === 'D' && u.number === '806') || units.find((u) => u.status === 'available' && u.usd)
  return (
    <>
      <Top title={T('Админка')} sub={T('Условия договора по проекту: версии с датой вступления; до SPA signed действует последняя версия, после — условия сделки фиксируются')} />
      <div className="page">
        <AdminTabs lang={L} on="conditions" role={c.user.role} />
        {over.length > 0 && <div className="note mt8">{T('Доли больше нашего фикса')}: {over.map((o) => T('{m} — партнёр + консультант + рекомендатель {t} при фиксе {f}', { m: o.market, t: pct(L, o.total), f: pct(L, o.fix) })).join('; ')}. {T('Задайте ставку рынка в исключениях — иначе новую версию условий сохранить нельзя.')}</div>}
        <div className="chips">{ps.map((x) => <Link key={x.id} href={`?p=${x.slug}`} className={'chip' + (x.id === p.id ? ' on' : '')}>{x.name}</Link>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 16, alignItems: 'start' }} className="mt16">
          <div className="card stack" style={{ gap: 8 }}>
            <div className="label">{T('Версии условий')}</div>
            {vers.map((v) => <div key={v.id} className="kv"><span style={{ color: 'var(--ink)' }}>v{v.version} · {T('с {d}', { d: date(L, v.valid_from) })}<div className="tiny muted">{T('фикс {f} · пул {p} · агенту {a}+{b}', { f: pct(L, v.fix_pct), p: pct(L, v.pool_pct), a: pct(L, v.agent_fix_pct), b: pct(L, v.agent_pool_pct) })}</div></span><Pill kind={v.status === 'published' ? 'ok' : 'warn'}>{T(v.status === 'published' ? 'действует' : 'черновик')}</Pill></div>)}
            <div className="label mt16">{T('Исключения для агентов')}</div>
            {rates.length === 0 && <div className="small muted">—</div>}
            {rates.map((r) => <div key={r.id} className="stack" style={{ gap: 2, paddingBottom: 8, borderBottom: '1px solid var(--line-2)' }}>
              <div className="between" style={{ gap: 6 }}><b className="small">{r.who}</b>{edit && <form action={saveAgentRate}><input type="hidden" name="project" value={p.id} /><input type="hidden" name="delete" value={r.id} /><button className="btn btn--sm" title={T('Удалить')}>×</button></form>}</div>
              <div className="small">{T('партнёру')} {pct(L, r.agent_fix_pct)} + {pct(L, r.agent_pool_pct)}{r.referrer_pct != null ? ` · ${T('рекоменд.')} ${pct(L, r.referrer_pct)}` : ''}</div>
              {r.note && <div className="tiny muted">{r.note}</div>}</div>)}
            {edit && (
              <ActionForm action={saveAgentRateState} lang={L} reset className="stack mt8" style={{ gap: 6 }}>
                <input type="hidden" name="project" value={p.id} />
                <select className="in" name="who" required defaultValue=""><option value="" disabled>{T('Агент, агентство или рынок')}</option><option value="market:DE">{T('Рынок')} DE</option><option value="market:IL">{T('Рынок')} IL</option><option value="market:GLOBAL">{T('Рынок')} Global</option>{whoList.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}</select>
                <div className="row" style={{ gap: 6 }}><input className="in" name="fix" placeholder={T('фикс, %')} title={T('Фикс партнёра, % от цены')} inputMode="decimal" required style={{ flex: 1 }} /><input className="in" name="pool" placeholder={T('пул, %')} title={T('Часть пула партнёра, % от прайса')} inputMode="decimal" required style={{ flex: 1 }} /><input className="in" name="ref" placeholder={T('рекоменд., %')} title={T('Рекомендатель на этом рынке, % от цены (пусто — как в условиях)')} inputMode="decimal" style={{ flex: 1 }} /></div>
                <input className="in" name="note" placeholder={T('комментарий')} />
                <button className="btn btn--sm">{T('Добавить исключение')}</button>
              </ActionForm>
            )}
            <div className="label mt16">{T('Уровни')}</div>
            <div className="tiny muted">{T('Договор застройщика → проект → блок → квартира. В MVP условия задаются на проект; блоки и квартиры — следующий шаг.')}</div>
          </div>
          {(cur || canEditConditions(c.user.role)) && <CondForm key={p.id} lang={L} projectId={p.id} cur={cur || fresh()} canEdit={canEditConditions(c.user.role)} example={ex ? { no: `${ex.block}-${ex.number}`, usd: ex.usd! } : null} />}
        </div>
      </div>
    </>
  )
}
