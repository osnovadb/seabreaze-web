import Link from 'next/link'
import { REG_ST } from '@/lib/stages'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { decideRegistration, renewRegistration, massEnqueue } from '@/lib/regActions'
import { loadRegistrations, groupOf, type RegParams } from '@/lib/regFilter'
import { RegBulk, CheckAll } from './bulk'

// 2.2 · Регистрации у застройщиков (§7, экран Бэк-офис 01): пакет на сегодня, ждём ответа, молчание, истекают, все.
// 09.11 (Денис): фильтры (застройщик, проект, рынок, источник, согласие, период, поиск) и выгрузка в xlsx — файлом сразу застройщику
const ST = REG_ST
const WHY: Record<string, string> = { developer_client: 'клиент застройщика', other_agency: 'за другим агентством', other: 'другое' }
const KEYS = ['f', 'd', 'p', 'm', 'src', 's', 'from', 'to', 'by', 'flag', 'cons'] as const

export default async function Registrations(props: { searchParams: Promise<RegParams> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!['owner', 'office', 'market_head'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const rows = await loadRegistrations({ ...searchParams, ids: undefined }, c.user)
  const devs = await q<{ id: string; name: string }>('select id, name from portal.developers where active order by name')
  const projects = await q<{ id: string; name: string; developer_id: string }>(`select distinct p.id, p.name, r.developer_id::text from portal.registrations r join public.projects p on p.id = r.project_id order by p.name`)
  const today = new Date().toISOString().slice(0, 10)
  const groups: [string, string][] = [['today', 'К отправке'], ['wait', 'Ждём ответа'], ['silence', 'Молчание'], ['expiring', 'Истекают'], ['confirmed', 'Подтверждены'], ['rejected', 'Отказы'], ['all', 'Все']]
  const f = groups.some(([k]) => k === searchParams.f) ? searchParams.f! : 'today'
  const shown = rows.filter((r) => groupOf(r, today)[f])
  const edit = ['owner', 'office'].includes(c.user.role)
  // текущие фильтры — в ссылки вкладок и в выгрузку
  const qs = (over: Partial<Record<(typeof KEYS)[number], string>>) => {
    const u = new URLSearchParams()
    for (const k of KEYS) { const v = k in over ? over[k] : searchParams[k]; if (v) u.set(k, v) }
    return u.toString()
  }
  const active = KEYS.filter((k) => k !== 'f' && searchParams[k]).length
  const projOpts = projects.filter((p) => !searchParams.d || p.developer_id === searchParams.d)
  const sel = (name: string, label: string, opts: [string, string][], all = 'все') => (
    <label className="field"><span>{T(label)}</span><select key={`name:${String(searchParams[name as keyof RegParams] || '')}`} className="in in--sm" name={name} defaultValue={searchParams[name as keyof RegParams] || ''}><option value="">{T(all)}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)
  return (
    <>
      <Top title={T('Регистрации у застройщиков')} sub={T('Пакет на сегодня собирается в 9:00 по Баку; SLA передачи — 1 рабочий день, для массовой регистрации — 10')} />
      <div className="page">
        <div className="chips">{groups.map(([k, l]) => <Link key={k} href={`?${qs({ f: k })}`} className={'chip' + (f === k ? ' on' : '')}>{T(l)} · {rows.filter((r) => groupOf(r, today)[k]).length}</Link>)}</div>
        <form className="card card--tight mt8 row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="f" value={f} />
          <label className="field" style={{ minWidth: 220, flex: 1 }}><span>{T('Поиск')}</span><input className="in in--sm" name="s" defaultValue={searchParams.s || ''} placeholder={T('Имя, телефон, e-mail, R-номер, партнёр')} /></label>
          {sel('d', 'Застройщик', devs.map((d) => [d.id, d.name]), 'все застройщики')}
          {sel('p', 'Проект', projOpts.map((p) => [p.id, p.name]), 'все проекты')}
          {c.user.role !== 'market_head' && sel('m', 'Рынок', [['DE', 'DE'], ['IL', 'IL'], ['GLOBAL', 'Global']])}
          {sel('src', 'Источник', [['team', T('команда')], ['partner', T('партнёры')], ['referrer', T('рекомендатели')]])}
          {sel('cons', 'Согласие клиента', [['yes', T('есть')], ['no', T('нет')]])}
          {sel('flag', 'Отметка', [['priority', T('вне очереди')], ['mass', T('массовая')]])}
          {sel('by', 'Период по дате', [['sent', T('отправки')], ['decided', T('решения')]], 'постановки в очередь')}
          <label className="field"><span>{T('с')}</span><input className="in in--sm" type="date" name="from" defaultValue={searchParams.from || ''} /></label>
          <label className="field"><span>{T('по')}</span><input className="in in--sm" type="date" name="to" defaultValue={searchParams.to || ''} /></label>
          <button className="btn btn--sm btn--p">{T('Показать')}</button>
          {active > 0 && <Link className="btn btn--sm btn--ghost" href={`?f=${f}`}>{T('Сбросить ({n})', { n: active })}</Link>}
        </form>
        <RegBulk lang={L} query={qs({})} edit={edit} canSend={f === 'today' || shown.some((r) => ['to_send', 'expired'].includes(r.status))} />
        <div className="tbl-wrap mt16">
          <table className="tbl">
            <thead><tr><th><CheckAll /></th>{['Клиент', 'Застройщик · проект', 'Источник', 'Статус', 'Срок', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="muted">{T('Пусто')}</td></tr>}
              {shown.map((r) => {
                const [lab, kind] = ST[r.status]
                const term = r.status === 'to_send' ? (r.due_send ? T('передать до {d}', { d: date(L, r.due_send) }) : '') : r.status === 'sent' ? T('ответ до {d}', { d: date(L, r.answer_due!) }) + (r.answer_due! < today ? ' · ' + T(r.silence_rule === 'confirm' ? 'молчание = да' : 'напомнить') : '') : r.valid_until ? T('до {d}', { d: date(L, r.valid_until) }) : ''
                return (
                  <tr key={r.id}>
                    <td><input type="checkbox" name="rid" value={r.id} defaultChecked={f === 'today'} aria-label={r.client} /></td>
                    <td><Link href={`/clients/${r.client_id}`}>{r.client}</Link><div className="tiny muted">{r.reg_no}{r.country ? ' · ' + r.country : ''}{r.consent_status !== 'given' ? ' · ' : ''}{r.consent_status !== 'given' && <span className="warnc">{T('нет согласия')}</span>}</div>
                      {r.priority && <div className="tiny bronze">{T('вне очереди — выбрал квартиру')}</div>}{r.mass && <div className="tiny muted">{T('массовая регистрация')}</div>}</td>
                    <td>{r.developer} · {r.project}</td>
                    <td className="small muted">{r.owner_type === 'partner' ? r.owner + (r.agency ? ' · ' + r.agency : '') : r.owner_type === 'referrer' ? T('рекомендатель') + ' · ' + r.owner : T('команда')}{r.market ? ' · ' + r.market : ''}</td>
                    <td><Pill kind={kind}>{T(lab)}</Pill>{r.reject_reason && <div className="tiny muted">{T(WHY[r.reject_reason])}</div>}</td>
                    <td className="small">{term}</td>
                    <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {edit && r.status === 'sent' && <>
                        <form action={decideRegistration}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="verdict" value="confirmed" /><button className="btn btn--sm btn--p">{T('Подтверждено')}</button></form>
                        <form action={decideRegistration} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="verdict" value="rejected" />
                          <select className="in in--sm" name="reason" defaultValue="developer_client">{Object.entries(WHY).map(([k, v]) => <option key={k} value={k}>{T(v)}</option>)}</select><button className="btn btn--sm">{T('Отказ')}</button></form>
                      </>}
                      {edit && ['confirmed', 'confirmed_silence', 'expired', 'rejected'].includes(r.status) && <form action={renewRegistration}><input type="hidden" name="id" value={r.id} /><button className="btn btn--sm">{T('Продлить')}</button></form>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {c.user.role === 'owner' && (
          <form action={massEnqueue} className="card mt24 row" style={{ gap: 12 }}>
            <div className="label">{T('Новый застройщик: вся база в регистрацию')}</div>
            <select className="in" name="developer" required defaultValue="">{[<option key="" value="" disabled>{T('Застройщик')}</option>, ...devs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)]}</select>
            <button className="btn">{T('Поставить в очередь (10 р. дней)')}</button>
          </form>
        )}
      </div>
    </>
  )
}
