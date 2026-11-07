import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { listDevelopers, type Developer } from '@/lib/developers'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { DevForm } from './form'

// 2.2 · Карточка условий застройщика (ТЗ §7): регистрация и молчание, защита, бронь и лимит, комиссия, клаубэк, НДС
const blank: Developer = { id: '', name: '', catalog_id: null, reg_method: 'email', reg_email: null, reg_response_days: 3, silence_rule: 'remind', silence_extra_days: 0,
  protect_months: 6, protect_months_sub: null, renew_remind_days: 7, booking_days: 14, booking_ext_days: 14, max_bookings_total: 10, booking_write_api: false,
  commission_pct: null, rates_by_market: {}, vat_mode: 'over', options_in_base: false, pay_timing: 'after_first_payment', fx_rule: null, clawback_months: 3,
  clawback_offset: 'any', payment_wait_days: 10, sells_to_az: false, tz: 'Asia/Baku', contacts: null, note: null, active: true }

export default async function Developers({ searchParams }: { searchParams: { d?: string } }) {
  const c = await requireCtx()
  if (!['owner', 'market_head', 'office', 'finance'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ds = await listDevelopers()
  const cur = searchParams.d === 'new' ? blank : ds.find((x) => x.id === searchParams.d) || ds[0] || blank
  const edit = c.user.role === 'owner'
  return (
    <>
      <Top title={T('Застройщики')} sub={T('Справочник застройщиков и значения по умолчанию для первой версии условий нового проекта. Действующие условия — на проект: «Коммерческие условия».')} />
      <div className="page">
        <AdminTabs lang={L} on="developers" role={c.user.role} />
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0,1fr)', gap: 16, alignItems: 'start' }} className="mt16">
          <div className="card stack" style={{ gap: 8 }}>
            <div className="label">{T('Застройщики')}</div>
            {ds.map((d) => (
              <Link key={d.id} href={`?d=${d.id}`} className="kv" style={{ textDecoration: 'none', fontWeight: d.id === cur.id ? 600 : 400 }}>
                <span style={{ color: 'var(--ink)' }}>{d.name}<div className="tiny muted">{d.projects || T('нет проектов')}</div></span>
                <Pill kind={d.active ? 'ok' : 'warn'}>{T(d.silence_rule === 'confirm' ? 'молчание = да' : 'напоминание')}</Pill>
              </Link>
            ))}
            {edit && <Link href="?d=new" className="btn btn--sm mt8">{T('+ Застройщик')}</Link>}
          </div>
          <DevForm key={cur.id || 'new'} lang={L} cur={cur} canEdit={edit} />
        </div>
      </div>
    </>
  )
}
