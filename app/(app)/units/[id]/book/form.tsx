'use client'
import { startTransition, useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { createBooking } from '@/lib/actions'
import { split, planCond, type SplitCond } from '@/lib/money'
import { planPool, type DownStep } from '@/lib/calc'
import { priceChain, isFull, termUnknown, hasSchedule, planLabel, type Plan, type PromoView, type PromoMode } from '@/lib/plans'
import { ScheduleTable, type FxView } from '@/components/Calculator'
import { t, usd, pct, num, date, type Lang } from '@/lib/i18n'
import type { Opt } from '@/lib/options'

function Submit({ label, pending }: { label: string; pending: boolean }) {
  return <button className="btn btn--p btn--lg btn--block" disabled={pending}>{label}</button>
}
export function BookForm({ lang, unitId, list: priceList, ext, cap, ceiling, cond, days, ext_days, clients, plans, fx, promo, mode, preset, showOurs, options = [], pkgs = [], fee = null, variant = null, grid = [] }: {
  lang: Lang; unitId: string; list: number; ext: boolean; cap: number; ceiling: number; cond: SplitCond; days: number; ext_days: number
  clients: { id: string; name: string; reg_no: string }[]; plans: Plan[]; fx: FxView; promo: PromoView | null; mode: PromoMode; preset?: string; showOurs: boolean; options?: Opt[]; pkgs?: { id: string; client_id: string; unit: string }[]; fee?: { amount: number; cur: string } | null
  variant?: { id: string; name: string; disc: number; planId: string | null; downPct: number; months: number; start: string | null } | null
  grid?: DownStep[]
}) {
  const [cid, setCid] = useState(preset || '')
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  // Этап 3: бронь из варианта расчёта — его план и скидка (согласованная скидка варианта не уходит на повторное согласование)
  const [disc, setDisc] = useState(variant?.disc || 0)
  const [planId, setPlanId] = useState((variant?.planId && plans.some((p) => p.id === variant.planId) ? variant.planId : '') || plans[0]?.id || '')
  const plan = plans.find((p) => p.id === planId)
  // 361: скидка за 100 % — максимум (пул плана), цену не снижает; акция застройщика — снижает
  const ch = priceChain(priceList, plan, promo, mode)
  const list = ch.base
  // 10.11 (Денис): партнёру ползунок — до его части пула; больше — «Попросить больше» без показа нашей части и всего пула
  // 361/349: максимум скидки — пул выбранного плана (по взносу и сроку варианта или плана); у партнёра — его доля этого пула
  const pDown = variant ? variant.downPct : plan ? (isFull(plan) ? 100 : Number(plan.down_payment_pct) || 0) : 0
  const pMonths = variant ? variant.months : plan && !isFull(plan) ? Number(plan.months) || 0 : 0
  const pool = planPool({ grid, plans, poolPct: Number(cond.pool_pct) || 0, downPct: pDown, months: pMonths }).pct
  const pc = planCond(cond, pool)
  const capP = ext ? pc.agent_pool_pct : Math.min(cap, pool), ceilP = Math.min(ceiling, pool)
  const maxDisc = ch.poolAllowed ? Math.max(ext ? capP : ceilP, variant?.disc || 0) : 0
  const [ask, setAsk] = useState(false)
  const [askPct, setAskPct] = useState('')
  useEffect(() => { if (disc > maxDisc) setDisc(maxDisc) }, [maxDisc]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false)
  const [st, act, pending] = useActionState(createBooking, null)
  const askN = Number(askPct.replace(',', '.')) || 0
  const eff = ext && ask && askN > disc ? askN : disc // скидка, с которой уходит бронь
  const sp = split(pc, list, eff, ext, priceList)
  // QA 10.11: запрос сверх своей части — цену и доход показываем по согласуемой скидке, запрошенная — «на согласовании»
  const asking = ext && ask && askN > disc
  const shown = asking ? split(pc, list, disc, ext, priceList) : sp
  // QA 10.11: React 19 сбрасывал <form action> после ошибки — список показывал «Выберите клиента», а уходил прежний. Отправляем без автосброса
  const submit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => act(fd)) }
  const [picked, setPicked] = useState<string[]>([])
  // Опции — сверху итоговой цены, без скидок и вне раздела денег (комиссия считается с квартиры)
  const optSum = options.filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.usd, 0)
  return (
    <form method="post" onSubmit={submit} className="stack">
      {variant && <div className="note">{T('Бронь по варианту «{n}»: взнос {p}', { n: variant.name, p: pct(lang, variant.downPct) })}{variant.months ? ' · ' + T('{m} мес.', { m: variant.months }) : ''}{variant.disc > 0 ? ' · ' + T('скидка {p}', { p: pct(lang, variant.disc) }) : ''}{variant.start ? ' · ' + T('первый взнос {d}', { d: date(lang, variant.start) }) : ''}
        <input type="hidden" name="variant" value={variant.id} /></div>}
      <div className="card">
        {plans.length > 0 && (
          <div className="mt0" style={{ marginBottom: 16 }}>
            <div className="h3">{T('План оплаты')}</div>
            <div className="chips mt8">{plans.map((p) => <button type="button" key={p.id} className={'chip' + (p.id === planId ? ' on' : '')} onClick={() => setPlanId(p.id)}>{planLabel(T, p.name, p)}</button>)}</div>
            <input type="hidden" name="plan" value={planId} />
            {plan && <div className="small muted mt8">{isFull(plan) ? (Number(plan.full_payment_discount_pct) && !ext ? T('Полная оплата — максимальная скидка по плану {p}', { p: pct(lang, Number(plan.full_payment_discount_pct)) }) : T('Полная оплата'))
              : termUnknown(plan) ? T('Первый взнос {p}; срок и платежи — по графику застройщика', { p: pct(lang, Number(plan.down_payment_pct)) })
                : hasSchedule(plan) ? T('Первый взнос {p}, затем этапы по графику застройщика: {n}', { p: pct(lang, Number(plan.down_payment_pct)), n: plan.schedule!.filter((m) => Number(m.pct) > 0).length })
                : T('Первый взнос {p}, затем ежемесячные платежи: {m}', { p: pct(lang, Number(plan.down_payment_pct)), m: plan.months || 0 })}</div>}
          </div>
        )}
        {options.length > 0 && <div style={{ marginBottom: 16 }}>
          <div className="h3">{T('Опции')}</div>
          {options.map((o) => <label key={o.id} className="kv check" style={{ cursor: 'pointer' }}><span><input type="checkbox" name="options" value={o.id} checked={picked.includes(o.id)} onChange={(e) => setPicked((a) => (e.target.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))} /> {o.title}{o.note ? <div className="tiny muted">{o.note}</div> : null}</span>
            <span className="small">+{usd(lang, o.usd)}{o.currency !== 'USD' ? <div className="tiny muted">{o.currency} {num(lang, o.price)}</div> : null}</span></label>)}
          <div className="tiny muted mt8">{T('Опции оплачиваются застройщику сверх цены квартиры; скидки и ваша комиссия на них не распространяются.')}</div>
        </div>}
        <div className="h3">{ext ? T('Скидка клиенту из вашей части пула') : T('Скидка клиенту')}</div>
        <div className="small muted">{ext ? T('Вам выделено {p} от прайса по этому плану: сколько отдать клиенту, а сколько оставить себе — решаете вы', { p: pct(lang, capP) }) : T('Максимум по плану {m}; сами — до {p}, больше — с согласованием руководителя', { m: pct(lang, pool), p: pct(lang, capP) })}</div>
        <input className="disc mt16" type="range" min={0} max={maxDisc} step={0.5} value={disc} onChange={(e) => setDisc(Number(e.target.value))} />
        <input type="hidden" name="discount" value={eff} />{ext && ask && askN > disc && <input type="hidden" name="ask" value="1" />}
        <div className="between small muted"><span>0%</span><b style={{ color: 'var(--ink)' }}>{pct(lang, disc)}</b><span>{pct(lang, maxDisc)}</span></div>
        {!ch.poolAllowed && <div className="note mt8">{T('По условиям акции «{n}» скидка из пула не применяется.', { n: promo?.name || '' })}</div>}
        {/* 373: «Попросить больше» — только когда своя часть отдана клиенту целиком */}
        {ext && ch.poolAllowed && (!ask
          ? (disc + 1e-9 >= capP ? <button type="button" className="btn btn--sm mt8" onClick={() => setAsk(true)}>{T('Попросить больше')}</button>
            : <div className="tiny muted mt8">{T('«Попросить больше» — когда вся ваша часть отдана клиенту')}</div>)
          : <div className="card card--tight stack mt8" style={{ gap: 6 }}>
              <label className="field"><span>{T('Какая скидка нужна клиенту, %')}</span><input className="in" inputMode="decimal" value={askPct} onChange={(e) => setAskPct(e.target.value)} style={{ maxWidth: 120 }} /></label>
              <label className="field"><span>{T('Комментарий для руководителя рынка')}</span><textarea className="in" name="ask_note" rows={2} maxLength={500} placeholder={T('Почему нужна большая скидка: бюджет клиента, конкурент, несколько квартир…')} /></label>
              <div className="tiny muted">{T('Бронь уйдёт на согласование руководителю рынка; офис подтвердит её после решения.')}</div>
              <div><button type="button" className="btn btn--sm btn--ghost" onClick={() => { setAsk(false); setAskPct('') }}>{T('Отменить запрос')}</button></div>
            </div>)}
        {!ext && disc > capP && !(variant && disc <= variant.disc + 1e-9) /* О29: согласованный вариант на согласование не уходит */ && <div className="note mt8">{T('Скидка сверх {p} — бронь уйдёт на согласование владельцу или руководителю рынка; офис подтвердит её после решения.', { p: pct(lang, capP) })}</div>}
        <div className="grid g2 mt16">
          <div className="card card--sand card--tight"><div className="small muted">{T('Клиент платит застройщику')}</div><div className="big num">{usd(lang, shown.final)}</div><div className="tiny muted">{(list < priceList ? T('цена с учётом акции и плана {a} − скидка {d}', { a: usd(lang, list), d: usd(lang, shown.discount) }) : T('прайс {a} − скидка {d}', { a: usd(lang, list), d: usd(lang, shown.discount) }))}</div>{asking && <div className="tiny warnc">{T('скидка {p} — на согласовании', { p: pct(lang, askN) })}</div>}</div>
          {ext
            ? <div className="card card--tight" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}><div className="small okc">{T('Ваш доход по сделке')}</div><div className="big num okc">{usd(lang, shown.agent)}</div><div className="tiny okc">{T('фикс {f} + остаток вашей части пула {p}', { f: usd(lang, shown.agentFix), p: usd(lang, shown.agentPoolLeft) })}</div></div>
            : showOurs ? <div className="card card--tight" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)' }}><div className="small okc">{T('Наш доход по сделке')}</div><div className="big num okc">{usd(lang, sp.ours)}</div><div className="tiny okc">{T('фикс {f} + пул {p} · продавцу {s}', { f: usd(lang, sp.ourFix), p: usd(lang, sp.ourPool), s: usd(lang, sp.seller) })}</div></div>
              : <div className="card card--tight"><div className="small muted">{T('Скидка')}</div><div className="big num">{pct(lang, disc)}</div></div>}
        </div>
        {plan && <><div className="label mt16">{T('График платежей')}{(asking ? disc : eff) > 0 ? ' · ' + T('с учётом скидки {p}', { p: pct(lang, asking ? disc : eff) }) : ''}</div><ScheduleTable plan={plan} price={shown.final} lang={lang} fx={fx} expanded={open} onExpand={() => setOpen(true)} /></>}
        <div className="mt16">
          <div className="kv"><span>{T('Прайс застройщика')}</span><span>{usd(lang, priceList)}</span></div>
          {ch.planAmt > 0 && <div className="kv"><span>{T('Скидка за 100%')}</span><span>−{usd(lang, ch.planAmt)}</span></div>}
          {promo && <div className="kv"><span>{T('Акция «{n}»', { n: promo.name })}</span><span className={ch.promoApplied ? 'okc' : 'muted small'}>{ch.promoApplied ? '−' + usd(lang, ch.promoAmt) : T('не суммируется со скидкой за 100%')}</span></div>}
          {(asking ? disc : eff) > 0 && <div className="kv"><span>{T('Скидка из пула')}</span><span>−{usd(lang, shown.discount)} ({pct(lang, asking ? disc : eff)})</span></div>}
          {asking && <div className="kv"><span>{T('Запрошено')}</span><span className="warnc">{T('скидка {p} — на согласовании', { p: pct(lang, askN) })}</span></div>}
          <div className="kv"><span>{T('Итоговая цена')}</span><span>{usd(lang, shown.final)}</span></div>
          {optSum > 0 && <div className="kv"><span>{T('Опции')}</span><span>+{usd(lang, optSum)} · {T('всего {a}', { a: usd(lang, shown.final + optSum) })}</span></div>}
          {ext && <div className="kv"><span>{T('Ваш фикс')}</span><span>{pct(lang, cond.agent_fix_pct)} {T(cond.fix_base === 'list' ? 'от прайса' : 'от итоговой цены')} · {usd(lang, shown.agentFix)}</span></div>}
          {ext && <div className="kv"><span>{T('Ваша часть пула, не отданная клиенту')}</span><span>{pct(lang, Math.max(0, pc.agent_pool_pct - disc))} · {usd(lang, shown.agentPoolLeft)}</span></div>}
          {fee && <div className="kv"><span>{T('Платная бронь')}</span><span className="small">{T('взнос {a} — офис подтвердит бронь после оплаты; при договоре засчитывается в цену', { a: `${fee.cur} ${num(lang, fee.amount)}` })}</span></div>}
          <div className="kv"><span>{T('Срок брони')}</span><span>{T('{a} дней + одно продление на {b} дней', { a: days, b: ext_days })}</span></div>
          <div className="kv"><span>{T('Выплата')}</span><span>{T('после оплаты застройщиком')}</span></div>
        </div>
      </div>
      <div className="card">
        <label className="field"><span>{T('Клиент (закреплённый за вами)')}</span>
          <select className="in" name="client" value={cid} onChange={(e) => setCid(e.target.value)} required>
            <option value="" disabled>{T('Выберите клиента')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.reg_no}</option>)}
          </select>
        </label>
        {clients.length === 0 && <div className="note mt8">{T('Нет закреплённых клиентов.')} <Link className="bronze" href="/clients/new">{T('Зарегистрировать клиента →')}</Link></div>}
        {pkgs.some((p) => p.client_id === cid) && <label className="field mt8"><span>{T('Пакетом с бронью (один договор)')}</span>
          <select className="in" name="package" defaultValue=""><option value="">{T('нет — отдельная бронь')}</option>{pkgs.filter((p) => p.client_id === cid).map((p) => <option key={p.id} value={p.id}>{p.unit}</option>)}</select>
          <span className="tiny muted">{T('Например, машиноместо или кладовка к квартире: договор по всем броням пакета оформляется разом, комиссия — по каждой квартире.')}</span></label>}
        <input type="hidden" name="unit" value={unitId} />
        {st?.error && <div className="err mt8">{T(st.error)}</div>}
        <div className="grid g2 mt16">
          <label className="field"><span>{T('Тур в Баку: с')}</span><input className="in" type="date" name="tour_from" /></label>
          <label className="field"><span>{T('по')}</span><input className="in" type="date" name="tour_to" /></label>
        </div>
        {/* 355 (Денис 11.11): вместо «тур + 3 дня» — запрос длинной брони: портал показывает крайнюю дату по условиям, дольше — согласует бэк-офис */}
        <label className="field mt8"><span>{T('Нужна бронь до (если дольше обычного)')}</span><input className="in" type="date" name="want_until" min={new Date().toISOString().slice(0, 10)} style={{ maxWidth: 200 }} /></label>
        <div className="tiny muted">{T('По условиям проекта бронь — до {d} (срок и одно продление). Дольше — запрос, бэк-офис согласует с застройщиком.', { d: date(lang, new Date(Date.now() + (days + ext_days) * 86400000)) })}</div>
        <label className="field mt8"><span>{T('Подписание')}</span><select className="in" name="signing" defaultValue=""><option value="">—</option><option value="in_person">{T('лично в Баку')}</option><option value="remote">{T('дистанционно')}</option><option value="power_of_attorney">{T('по доверенности')}</option></select></label>
        <label className="field mt8"><span>{T('Комментарий для бэк-офиса')}</span><input className="in" name="comment" /></label>
        <div className="mt16"><Submit pending={pending} label={asking ? T('Запросить бронь — скидка на согласовании') : T('Запросить бронь по {p}', { p: usd(lang, sp.final) })} /></div>
        <div className="tiny muted mt8">{T('Цена и условия фиксируются в брони. Офис в Баку подтверждает бронь у застройщика.')}</div>
      </div>
    </form>
  )
}
