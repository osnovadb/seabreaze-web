import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, date } from '@/lib/i18n'
import { listProjects, buildingsOf } from '@/lib/catalog'
import { Top, Pill } from '@/components/ui'
import { bookingAction, dealPaid, refuseClient } from '@/lib/actions'
import { kycLink } from '@/lib/kycActions'
import { B24_LOST } from '@/lib/stages'
import { canApproveDiscount, canConfirmBooking } from '@/lib/perm'
import { setEscort } from '@/lib/moneyActions'
import { ConsentBox } from '@/components/ConsentBox'
import { clientScope } from '@/lib/scope'
import { unitById, codeFor, viewMode } from '@/lib/catalog'
import { canBook } from '@/lib/perm'
import { calcViewProps } from '@/lib/calcView'
import { VariantCalc } from '@/components/VariantCalc'

// 2.2 · Units в Bitrix24 (вариант B, экраны Сейлз 02–04): подбор по шахматке → квартиры клиента → условия покупки
type U = { unit_id: string; no: string; project: string; slug: string; status: string | null; booking_id: string | null; ends_at: string | null; final: number | null; liked: boolean; in_sel: boolean; usd: number | null; mine: boolean; spa_approval_at: string | null; approval?: string | null; plan_pool?: number | null; disc?: number; dev_no?: string | null; deal_id?: string | null; paid?: number | null; escort_id?: string | null }
const ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { hold: ['холд 24 ч', 'ink'], queued: ['в очереди у застройщика', 'warn'], requested: ['запрос брони', 'warn'], confirmed: ['бронь', 'ok'], release_pending: ['снять у застройщика', 'warn'], converted: ['договор', 'ok'] }

export default async function Units(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; created?: string; u?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound()
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  // QA 09.11: только команда и только клиенты в её видимости (партнёр по прямой ссылке открывал Units чужого клиента)
  if (!['owner', 'market_head', 'seller', 'office'].includes(c.user.role)) notFound()
  const cs = clientScope(c.user)
  const visible = await one(`select 1 from portal.clients cl where cl.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, params.id])
  if (!visible) notFound()
  const cl = await one<{ id: string; name: string; attach_status: string; protected_until: string | null; b24_deal_id: number | null; market: string | null; kyc_status: string; kyc_token: string | null
    consent_status: string; consent_token: string | null; consent_at: string | null; marketing_consent_at: string | null; phone_norm: string | null; email: string | null; language: string | null; do_not_contact: boolean }>(
    `select id, name, attach_status, protected_until::text, b24_deal_id, market, kyc_status, kyc_token, consent_status, consent_token, consent_at, marketing_consent_at, phone_norm, email, language, do_not_contact
     from portal.clients where id = $1`, [params.id])
  if (!cl) notFound()
  const units = await q<U>(`with b as (select distinct on (unit_id) * from portal.bookings where client_id = $1 and status in ('hold','queued','requested','confirmed','release_pending','converted') order by unit_id, created_at desc),
      s as (select si.unit_id, bool_or(coalesce(si.liked, false)) liked from portal.selection_items si join portal.selections x on x.id = si.selection_id where x.client_id = $1 group by si.unit_id)
    select u.id unit_id, portal.unit_no(bl.external_id, u.number) no, p.name project, p.slug, b.status, b.id booking_id, b.ends_at::text, b.final_price::float final,
      coalesce(s.liked, false) liked, s.unit_id is not null in_sel, u.price_list::float usd, b.agent_id = $2 mine, b.approval, (b.snapshot->>'plan_pool')::float plan_pool, b.discount_pct::float disc, b.dev_booking_no dev_no, b.escort_id, b.spa_approval_at,
      d.id deal_id, d.paid_pct::float paid
    from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id left join b on b.unit_id = u.id left join s on s.unit_id = u.id
      left join portal.deals d on d.booking_id = b.id and d.stage <> 'cancelled'
    where b.id is not null or s.unit_id is not null order by b.status is null, p.name, no`, [cl.id, c.user.id]).catch(async () =>
      q<U>(`select u.id unit_id, portal.unit_no(bl.external_id, u.number) no, p.name project, p.slug, b.status, b.id booking_id, b.ends_at::text, b.final_price::float final, false liked, true in_sel, u.price_list::float usd, b.agent_id = $2 mine
        from portal.bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id where b.client_id = $1 and b.status in ('hold','queued','requested','confirmed','release_pending','converted')`, [cl.id, c.user.id]))
  const regs = await one<{ ok: number; all: number }>(`select count(*) filter (where status in ('confirmed','confirmed_silence'))::int ok, count(*)::int "all" from portal.registrations where client_id = $1`, [cl.id])
  const tab = searchParams.tab || (units.length ? 'units' : 'pick')
  const ps = tab === 'pick' ? await listProjects(c.user) : []
  const blds = tab === 'pick' ? await Promise.all(ps.map(async (p) => ({ p, bs: await buildingsOf(p.id, c.user) }))) : []
  const active = units.filter((u) => u.status)
  // этап 4 калькулятора: вкладка «Расчёт» — варианты по квартирам клиента, сохраняются сразу на этого клиента
  const priced = units.filter((x) => x.usd != null)
  const calcUnit = tab === 'calc' && priced.length ? await unitById(priced.some((x) => x.unit_id === searchParams.u) ? searchParams.u! : priced[0].unit_id) : null
  const calcProps = calcUnit ? await calcViewProps(calcUnit, c, { clients: [{ id: cl.id, name: cl.name }], clientId: cl.id,
    bookable: codeFor(calcUnit, c.user, viewMode(c.user, false)) === 'F' && canBook(c.user.role) && calcUnit.sales_status === 'sales' }) : null
  // сопровождающий в Баку (§8): назначает бэк-офис при Reserved; фикс — из условий проекта
  const staff = canConfirmBooking(c.user.role) && active.some((u) => ['confirmed', 'converted'].includes(u.status!)) ? await q<{ id: string; name: string }>(`select id, name from portal.users where active and role in ('office','seller','market_head') order by name`) : []
  return (
    <>
      <Top title={cl.name} sub={[cl.attach_status === 'candidate' ? T('кандидат партнёра') : cl.protected_until ? T('закреплён до {d}', { d: date(L, cl.protected_until) }) : '', regs?.all ? T('регистрации у застройщиков: {a} из {b}', { a: regs.ok, b: regs.all }) : '', cl.b24_deal_id ? T('сделка Bitrix24 № {n}', { n: cl.b24_deal_id }) : ''].filter(Boolean).join(' · ')}
        right={<Link className="btn" href={`/clients/${cl.id}`}>{T('Карточка клиента')}</Link>} />
      <div className="page">
        {cl.consent_status !== 'given' && <div className="card card--tight" style={{ marginBottom: 12 }}><div className="small" style={{ marginBottom: 6 }}><b>{T('Согласие клиента')}</b> · {T('отправьте ссылку при первом контакте — без согласия клиент не попадает в рекламу')}</div><ConsentBox lang={L} cl={cl} /></div>}
        {searchParams.created && <div className="okbox" style={{ marginBottom: 12 }}>{T('Запрос брони отправлен бэк-офису — статус появится в сделке Bitrix24')}</div>}
        <div className="chips">{[['pick', 'Подбор'], ['units', `${T('Квартиры клиента')} · ${units.length}`], ['terms', `${T('Условия покупки')} · ${active.length}`], ['calc', T('Расчёт')]].map(([k, l]) => <a key={k} href={`?tab=${k}`} className={'chip' + (tab === k ? ' on' : '')}>{k === 'pick' ? T(l) : l}</a>)}</div>
        {tab === 'pick' && <div className="grid g3 mt16">{blds.map(({ p, bs }) => (
          <div key={p.id} className="card stack" style={{ gap: 8 }}>
            <div className="h3">{p.name}</div>
            <div className="small muted">{T('свободно {n}', { n: p.free })}{p.min_usd ? ' · ' + T('от') + ' ' + usd(L, p.min_usd) : ''}</div>
            <div className="chips">{bs.map((b) => <Link key={b.id} className="chip" href={`/projects/${p.slug}/chess?b=${b.id}`}>{b.name} <span className="n">{b.free}</span></Link>)}</div>
            <div className="row" style={{ gap: 6 }}><Link className="btn btn--sm" href={`/projects/${p.slug}/chess?b=${bs[0]?.id || ''}&side=sea`}>{T('Сторона моря')}</Link><Link className="btn btn--sm" href={`/catalog?p=${p.slug}`}>{T('Списком')}</Link></div>
          </div>))}</div>}
        {tab === 'units' && <div className="tbl-wrap mt16"><table className="tbl">
          <thead><tr>{['Квартира', 'Проект', 'Отметка', 'Холд / бронь', 'Цена', ''].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {units.length === 0 && <tr><td colSpan={6} className="muted">{T('Пока пусто — выберите квартиры во вкладке «Подбор»')}</td></tr>}
            {units.map((u) => <tr key={u.unit_id}>
              <td><Link href={`/units/${u.unit_id}`}><b>{u.no}</b></Link></td>
              <td className="small">{u.project}</td>
              <td>{u.liked ? <Pill kind="ok">♥ {T('нравится')}</Pill> : u.in_sel ? <span className="small muted">{T('в подборке')}</span> : ''}</td>
              <td>{u.status ? <><Pill kind={ST[u.status][1]}>{T(ST[u.status][0])}</Pill>{u.ends_at && <div className="tiny muted">{T('до {d}', { d: date(L, u.ends_at) })}</div>}</> : <span className="small muted">—</span>}</td>
              <td className="num">{usd(L, u.final ?? u.usd ?? 0)}</td>
              <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {(!u.status || (u.status === 'hold' && u.mine)) && <Link className="btn btn--sm btn--p" href={`/units/${u.unit_id}/book?client=${cl.id}`}>{T('Условия покупки →')}</Link>}
                {u.status === 'hold' && u.mine && <form action={bookingAction}><input type="hidden" name="id" value={u.booking_id!} /><input type="hidden" name="act" value="release_hold" /><button className="btn btn--sm">{T('Снять холд')}</button></form>}
              </td>
            </tr>)}
          </tbody></table></div>}
        {tab === 'calc' && <div className="stack mt16">
          {priced.length === 0 ? <div className="muted">{T('Добавьте квартиры клиенту во вкладке «Подбор» — расчёт делается по его квартирам')}</div> : <>
            <div className="chips">{priced.map((x) => <a key={x.unit_id} href={`?tab=calc&u=${x.unit_id}`} className={'chip' + (x.unit_id === calcUnit?.id ? ' on' : '')}>{x.no} · {x.project}</a>)}</div>
            {calcProps && <VariantCalc key={calcUnit!.id} lang={L} {...calcProps} />}
          </>}
        </div>}
        {tab === 'terms' && <div className="stack mt16">
          {active.length === 0 && <div className="muted">{T('Нет холдов и запросов брони')}</div>}
          {active.map((u) => {
            const h = (act: string) => <><input type="hidden" name="id" value={u.booking_id!} /><input type="hidden" name="act" value={act} /></>
            const approve = u.status === 'requested' && u.approval === 'pending' && canApproveDiscount(c.user.role)
            const overPool = u.plan_pool != null && (u.disc || 0) > u.plan_pool + 1e-9 // 361: больше максимума по плану — только отказ
            const confirm = u.status === 'requested' && u.approval !== 'pending' && canConfirmBooking(c.user.role)
            const office = canConfirmBooking(c.user.role)
            return <div key={u.unit_id} className="card stack" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><b>{u.no}</b> · {u.project} · <Pill kind={ST[u.status!][1]}>{T(ST[u.status!][0])}</Pill>{u.ends_at && <span className="small muted"> · {T('до {d}', { d: date(L, u.ends_at) })}</span>}
                  {u.dev_no && <span className="small muted"> · {T('№ брони застройщика')} {u.dev_no}</span>}
                  {u.approval === 'pending' && <span className="small warnc"> · {T('скидка {p}% ждёт согласования', { p: u.disc || 0 })}</span>}</span>
                <span className="row" style={{ gap: 8 }}><b>{usd(L, u.final ?? 0)}</b>{u.status === 'hold' && u.mine && <Link className="btn btn--sm btn--p" href={`/units/${u.unit_id}/book?client=${cl.id}`}>{T('Запросить бронь')}</Link>}</span>
              </div>
              {approve && <div className="row" style={{ gap: 8 }}>
                {overPool ? <span className="small bad">{T('Скидка больше максимума по плану — согласовать нельзя')}</span> : <form action={bookingAction}>{h('approve')}<button className="btn btn--sm btn--p">{T('Согласовать скидку')}</button></form>}
                <form action={bookingAction}>{h('decline')}<button className="btn btn--sm">{T('Не согласовать')}</button></form></div>}
              {confirm && <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <form action={bookingAction} className="row" style={{ gap: 6, alignItems: 'flex-end' }}>{h('confirm')}
                  <label className="field"><span>{T('№ брони застройщика')}</span><input name="dev_no" className="in" style={{ width: 140 }} /></label>
                  <label className="field"><span>{T('до какого числа у застройщика')}</span><input name="until" type="date" className="in" /></label>
                  <button className="btn btn--sm btn--p">{T('Подтвердить бронь')}</button></form>
                <form action={bookingAction} className="row" style={{ gap: 6, alignItems: 'flex-end' }}>{h('reject')}
                  <label className="field"><span>{T('Причина отказа')}</span><select name="reason" className="in">{[['sold', 'Sold'], ['developer_refused', 'Developer refused'], ['registration_failed', 'Registration failed'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <button className="btn btn--sm">{T('Отклонить')}</button></form></div>}
              {/* гл. 6 (решение 341): стадии после Selection двигает портал — кнопки по шагам: KYC → SPA approval → SPA signed */}
              {u.status === 'confirmed' && office && <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {!['pending', 'passed'].includes(cl.kyc_status) && (cl.kyc_token
                  ? <span className="small muted">{T('Документы KYC запрошены — ждём загрузку клиентом')}</span>
                  : <form action={kycLink}><input type="hidden" name="client" value={cl.id} /><button className="btn btn--sm btn--p">{T('Запросить документы')}</button></form>)}
                {cl.kyc_status === 'pending' && <span className="small muted">{T('KYC на проверке')} · <Link href={`/clients/${cl.id}?tab=kyc`}>KYC</Link></span>}
                {cl.kyc_status === 'passed' && !u.spa_approval_at && <form action={bookingAction}>{h('spa_approval')}<button className="btn btn--sm">{T('Договор на согласовании')}</button></form>}
                {cl.kyc_status === 'passed' && u.spa_approval_at && <span className="small okc">{T('Договор на согласовании с {d}', { d: date(L, u.spa_approval_at) })}</span>}
                {cl.kyc_status === 'passed'
                  ? <form action={bookingAction}>{h('contract')}<button className="btn btn--sm btn--p">{T('Договор подписан')}</button></form>
                  : <span className="small muted">{T('«Договор на согласовании» и «Договор подписан» — после пройденного KYC')}</span>}
              </div>}
              {['confirmed', 'converted'].includes(u.status!) && office && staff.length > 0 && <form action={setEscort} className="row" style={{ gap: 6, alignItems: 'flex-end' }}><input type="hidden" name="id" value={u.booking_id!} />
                <label className="field"><span>{T('Сопровождающий в Баку')}</span><select key={`escort:${String(u.escort_id || '')}`} name="escort" className="in" defaultValue={u.escort_id || ''}><option value="">{T('без сопровождающего')}</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <button className="btn btn--sm">{T('Сохранить')}</button></form>}
              {u.status === 'release_pending' && office && <form action={bookingAction}>{h('release_confirm')}<button className="btn btn--sm btn--p">{T('Снято у застройщика')}</button></form>}
              {u.status === 'converted' && u.deal_id && (['owner', 'finance'].includes(c.user.role)
                ? <form action={dealPaid} className="row" style={{ gap: 6, alignItems: 'flex-end' }}><input type="hidden" name="id" value={u.deal_id} />
                    <label className="field"><span>{T('Оплачено клиентом, %')}</span><input name="paid" type="number" min={0} max={100} step="0.01" defaultValue={u.paid ?? 0} className="in" style={{ width: 90 }} /></label>
                    <button className="btn btn--sm btn--p">{T('Сохранить оплату')}</button></form>
                : <div className="small muted">{T('Оплачено клиентом')}: {u.paid ?? 0}%</div>)}
            </div>
          })}
          {['owner', 'market_head', 'seller', 'office'].includes(c.user.role) && <form action={refuseClient} className="card card--tight row noprint" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <input type="hidden" name="client" value={cl.id} />
            <label className="field"><span>{T('Отказ клиента — причина')}</span><select name="reason" className="in" defaultValue="Price">{B24_LOST.filter((x) => x !== 'Compliance').map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
            <button className="btn btn--sm">{T('Отказ')}</button>
            <span className="tiny muted">{T('Сделка в Bitrix24 уйдёт в Lost с этой причиной; руками стадии после Selection в Bitrix24 не двигаются.')}</span>
          </form>}
        </div>}
      </div>
    </>
  )
}
