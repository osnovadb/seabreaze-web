'use client'
// 2.2 · Калькулятор вариантов (запрос Дениса 10.11), этап 1: расчёт по квартире с регулировками.
// Первый взнос (процент и сумма), срок, скидка из пула, дата первого взноса, опции → цена для клиента, взнос, платёж в месяц,
// последний платёж, график и справочно € / ₪. Рамки — из плана застройщика; без планов — свободно, с пометкой «ориентировочно».
// «Для себя» (доход партнёра / наш) — свёрнуто, чтобы не показывать клиенту с экрана.
import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveVariant, deleteVariant, approveVariant } from '@/lib/variantActions'
import { calcVariant, fromPlan, startPlan, MAX_FREE_MONTHS, type DownStep } from '@/lib/calc'
import { planLabel, type Plan, type PromoView, type PromoMode } from '@/lib/plans'
import type { SplitCond } from '@/lib/money'
import type { Opt } from '@/lib/options'
import { t, usd, pct, num, date, type Lang } from '@/lib/i18n'
import { ScheduleTable, type FxView } from './Calculator'

// Сохранённый вариант (этап 2): настройки + снимок сумм на момент сохранения; текущие суммы пересчитываем здесь же
export type VariantView = { id: string; name: string; author: string; client: string | null; client_id?: string | null; mine: boolean; needs_approval: boolean; approved_at: string | null; created_at: string
  params: { downPct: number; months: number; disc: number; start?: string; options?: string[]; planId?: string | null }; snapshot: { total: number; down: number; monthly: number; months: number } }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(new Date())
const SIGN = { EUR: '€', ILS: '₪' } as const

export function VariantCalc({ list, plans, grid = [], promo, mode = 'chain', options = [], fx, lang, cond = null, ext = true, cap = 0, ceiling = 0, self = null, title, client = false, unitId, variants = [], clients = [], canApprove = false, ownerView = false, ask = false, bookable = false, clientPreset, compact = false }: {
  list: number; plans: Plan[]; grid?: DownStep[]; promo?: PromoView | null; mode?: PromoMode; options?: Opt[]; fx: FxView; lang: Lang
  cond?: SplitCond | null; ext?: boolean; cap?: number; ceiling?: number; self?: 'agent' | 'ours' | 'seller' | null; title?: string; client?: boolean
  unitId?: string; variants?: VariantView[]; clients?: { id: string; name: string }[]; canApprove?: boolean; ownerView?: boolean; ask?: boolean; bookable?: boolean; clientPreset?: string; compact?: boolean
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  // старт — с плана рассрочки (QA: открывался на «100% сразу»); дальше план выбирается сам по взносу и сроку, чип — только подсказка-пресет
  const first = startPlan(plans)
  const init = fromPlan(first)
  const [planId, setPlanId] = useState<string | null>(first?.id || null)
  const [amt, setAmt] = useState<string | null>(null) // сумма взноса, пока её вводят руками
  const [pctS, setPctS] = useState<string | null>(null) // процент взноса, пока его вводят (рамки применяются после ввода)
  const [downPct, setDownPct] = useState(init.downPct)
  const [months, setMonths] = useState(init.months)
  const [disc, setDisc] = useState(0)
  const [start, setStart] = useState(today)
  const [picked, setPicked] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const optionsUsd = options.filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.usd, 0)
  const r = useMemo(() => calcVariant({ list, plans, grid, promo, mode, planId, downPct, months, disc, start, optionsUsd, cap, ceiling, cond, ext }),
    [list, plans, grid, promo, mode, planId, downPct, months, disc, start, optionsUsd, cap, ceiling, cond, ext])
  // QA 10.11: ввод вне рамок подтягиваем к рамкам (после ввода), а пояснение показываем ещё 4 секунды — иначе оно висело или не появлялось
  const [flash, setFlash] = useState<string[]>([])
  useEffect(() => {
    if (pctS !== null || amt !== null || !r.clamped.length) return
    setFlash(r.clamped)
    if (Math.abs(downPct - r.downPct) > 1e-9) setDownPct(r.downPct)
    if (months !== r.months) setMonths(r.months)
    if (disc !== r.disc) setDisc(r.disc)
  }, [r.clamped.join('|'), pctS, amt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!flash.length) return; const id = setTimeout(() => setFlash([]), 4000); return () => clearTimeout(id) }, [flash])
  const pickPlan = (p: Plan | null) => { setPlanId(p?.id || null); const v = fromPlan(p); setDownPct(v.downPct); setMonths(v.months); setOpen(false) }
  const maxM = r.maxMonths ?? MAX_FREE_MONTHS
  const [saved, saveAct, saving] = useActionState(saveVariant, null)
  // этап 4: калькулятор живёт и в шахматке, и во вкладке Bitrix24 — после действий обновляем текущую страницу, где бы она ни была
  const router = useRouter()
  useEffect(() => { if (saved?.ok) router.refresh() }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const approveAct = async (fd: FormData) => { await approveVariant(fd); router.refresh() }
  const deleteAct = async (fd: FormData) => { await deleteVariant(fd); router.refresh() }
  const [vname, setVname] = useState('')
  const [asking, setAsking] = useState(false) // партнёр: «Попросить больше» — скидка сверх его части пула, на согласование
  const params = JSON.stringify({ downPct: r.downPct, months: r.months, disc: r.disc, start, options: picked, planId: r.plan?.id || null })
  const load = (v: VariantView) => { setPlanId(v.params.planId || null); setDownPct(v.params.downPct); setMonths(v.params.months); setDisc(v.params.disc); if (v.params.start) setStart(v.params.start); setPicked(v.params.options || []); setAmt(null); setPctS(null) }
  const cur = (v: VariantView) => calcVariant({ list, plans, grid, promo, mode, planId: v.params.planId || null, downPct: v.params.downPct, months: v.params.months, disc: v.params.disc, start: v.params.start, cap, ceiling: Math.max(ceiling, v.params.disc), askMax: ext ? Math.max(v.params.disc, 0) : undefined, poolPct: Math.max(Number(cond?.pool_pct ?? 0), v.params.disc), cond, ext,
    optionsUsd: options.filter((o) => (v.params.options || []).includes(o.id)).reduce((a, o) => a + o.usd, 0) })
  const fxs = (n: number) => (fx ? SIGN[fx.cur] + num(lang, Math.round(n * fx.perUsd)) : '')
  // ступени сетки — подсказка «ещё N % взноса — скидка M %»
  const next = grid.filter((g) => g.from_pct > r.downPct && (g.max_months == null || g.max_months >= r.months) && g.discount_pct > r.poolPct).sort((a, b) => a.from_pct - b.from_pct)[0]
  return (
    <div className={'stack vcalc' + (compact ? '' : ' card')} style={{ gap: 12 }}>
      {!compact && <div className="h3" style={{ margin: 0 }}>{title ?? T(client ? 'Рассрочка и платежи' : 'Калькулятор вариантов')}</div>}
      {plans.length > 0 && <div className="chips noprint">{plans.map((p) => <button type="button" key={p.id} className={'chip' + (p.id === r.plan?.id ? ' on' : '')} onClick={() => pickPlan(p)}>{planLabel(T, p.name, p)}</button>)}</div>}
      {r.approx && <div className="note small">{T(r.plan ? 'Срок рассрочки у застройщика не задан — расчёт ориентировочный.' : 'Условия рассрочки у застройщика не заданы — расчёт ориентировочный.')}</div>}
      <div className="vcalc__ctrls noprint">
        <label className="field"><span>{T('Первый взнос')} · <b>{pct(lang, r.downPct)}</b>{r.minDown > 0 && r.minDown < 100 ? <span className="tiny muted"> · {T('мин. {p}', { p: pct(lang, r.minDown) })}</span> : null}</span>
          <input type="range" className="disc" min={0} max={100} step={1} value={r.downPct} onChange={(e) => { setAmt(null); setDownPct(Number(e.target.value)) }} />
          <span className="row" style={{ gap: 6 }}>
            <input className="in in--sm" inputMode="decimal" value={pctS ?? String(Math.round(r.downPct * 10) / 10)} onFocus={() => setPctS(String(Math.round(r.downPct * 10) / 10))} onBlur={() => setPctS(null)} onChange={(e) => { setAmt(null); setPctS(e.target.value); setDownPct(Number(e.target.value.replace(',', '.')) || 0) }} style={{ width: 70 }} aria-label="%" /><span className="small">%</span>
            <input className="in in--sm" inputMode="decimal" value={amt ?? String(r.down)} onFocus={() => setAmt(String(r.down))} onBlur={() => setAmt(null)} onChange={(e) => { const t0 = e.target.value.replace(/[^\d]/g, ''); setAmt(t0); const v = Number(t0) || 0; setDownPct(r.total ? Math.min(100, (v / r.total) * 100) : 0) }} style={{ width: 120 }} aria-label="USD" /><span className="small">USD</span>
          </span></label>
        <label className="field"><span>{T('Срок рассрочки')} · <b>{r.months ? T('{m} мес.', { m: r.months }) : T('без рассрочки')}</b>{r.maxMonths ? <span className="tiny muted"> · {T('макс. {m} мес.', { m: r.maxMonths })}</span> : null}</span>
          <input type="range" className="disc" min={0} max={maxM} step={1} value={Math.min(r.months, maxM)} disabled={r.downPct >= 100} onChange={(e) => setMonths(Number(e.target.value))} />
          <span className="row" style={{ gap: 6 }}><input className="in in--sm" type="number" min={0} max={maxM} value={r.months} disabled={r.downPct >= 100} onChange={(e) => setMonths(Number(e.target.value) || 0)} style={{ width: 70 }} /><span className="small">{T('мес.')}</span></span></label>
        {/* 361/349: предел ползунка — пул выбранного плана (у партнёра — его часть), меняется вместе со взносом и сроком */}
        {ceiling > 0 && r.ceilingEff > 0 && r.poolAllowed && <label className="field"><span>{ext ? T('Скидка клиенту из вашей части') : T('Скидка клиенту')} · <b>{pct(lang, r.disc)}</b></span>
          <input type="range" className="disc" min={0} max={r.ceilingEff} step={0.5} value={Math.min(disc, r.ceilingEff)} onChange={(e) => setDisc(Number(e.target.value))} />
          <span className="between tiny muted"><span>0%</span>{r.capEff < r.ceilingEff && <span>{T('без согласования до {p}', { p: pct(lang, r.capEff) })}</span>}<span>{pct(lang, r.ceilingEff)}</span></span></label>}
        <label className="field"><span>{T('Дата первого взноса')}</span><input className="in" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} style={{ maxWidth: 200 }} /></label>
      </div>
      {options.length > 0 && <div className="noprint">{options.map((o) => (
        <label key={o.id} className="kv check" style={{ cursor: 'pointer' }}><span><input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked((a) => (e.target.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))} /> {o.title}</span><span className="small">+{usd(lang, o.usd)}</span></label>))}</div>}
      {(r.clamped.length ? r.clamped : flash).map((k) => <div key={k} className="tiny warnc">{T(k, { p: pct(lang, r.minDown), m: r.maxMonths ?? 0, c: pct(lang, r.ceilingEff) })}</div>)}
      {r.needsApproval && <div className="note small">{T('Скидка сверх {p} — вариант требует согласования владельца или руководителя рынка', { p: pct(lang, r.capEff) })}</div>}
      <div className="vcalc__kpis">
        {[[T(client ? 'Цена' : 'Цена для клиента'), usd(lang, r.total), fx ? '≈ ' + fxs(r.total) : ''],
          [T('Первый взнос'), usd(lang, r.down), pct(lang, r.downPct)],
          [T('Платёж в месяц'), r.monthly ? usd(lang, r.monthly) : '—', r.months ? T('{m} мес.', { m: r.months }) : r.fixed ? T('по этапам застройщика') : ''],
          [T('Последний платёж'), r.last ? date(lang, r.last) : '—', '']].map(([a, b, c]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v" style={{ fontSize: 20 }}>{b}</div><div className="tiny muted">{c}</div></div>)}
      </div>
      <div className="small">
        <div className="kv"><span>{T('Прайс застройщика')}</span><span>{usd(lang, list)}</span></div>
        {/* 361: максимум скидки по выбранному взносу и сроку; партнёру — только его часть (наш пул ему не раскрываем) */}
        {!client && (ext ? <div className="kv"><span>{T('Ваша часть по плану')}</span><span>{pct(lang, r.capEff)}</span></div>
          : <div className="kv"><span>{T('Максимальная скидка по плану')}</span><span>{pct(lang, r.poolPct)} · {usd(lang, list * r.poolPct / 100)}{r.poolSource === 'pool' ? ' · ' + T('пул проекта') : ''}</span></div>)}
        {promo && <div className="kv"><span>{T('Акция «{n}»', { n: promo.name })}</span><span className={r.promoApplied ? 'okc' : 'muted small'}>{r.promoApplied ? '−' + usd(lang, r.promoAmt) : T('не суммируется')}</span></div>}
        {r.disc > 0 && <div className="kv"><span>{T('Скидка клиенту')}</span><span>−{usd(lang, r.base - r.final)} ({pct(lang, r.disc)})</span></div>}
        {optionsUsd > 0 && <div className="kv"><span>{T('Опции')}</span><span>+{usd(lang, optionsUsd)}</span></div>}
        {next && !ext && !client && <div className="tiny bronze mt8">{T('Взнос от {f} — максимальная скидка {d}', { f: pct(lang, next.from_pct), d: pct(lang, next.discount_pct) })}</div>}
      </div>
      <ScheduleTable rows={r.rows} price={r.total} lang={lang} fx={fx} expanded={open} onExpand={() => setOpen(true)} />
      {self && r.split && <details className="noprint"><summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Для себя')}</summary>
        <div className="kv mt8"><span>{self === 'agent' ? T('Ваш доход по сделке') : self === 'seller' ? T('Ваш бонус по сделке') : T('Наш доход по сделке')}</span><b className="okc">{usd(lang, self === 'agent' ? r.split.agent : self === 'seller' ? r.split.seller : r.split.ours)}</b></div>
        {self === 'seller' && <div className="tiny muted">{T('{p} от нашей части — до вычета прочих долей по сделке', { p: pct(lang, cond?.seller_share_pct || 0) })}</div>}
        {self === 'agent' && <div className="tiny muted">{T(cond?.fix_base === 'list' ? 'Фикс {f} от прайса + остаток вашей части после скидки' : 'Фикс {f} от цены клиента + остаток вашей части после скидки', { f: pct(lang, cond?.agent_fix_pct || 0) })}</div>}</details>}
      {unitId && !client && <form action={saveAct} className="row noprint" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={() => setVname('')}>
        <input type="hidden" name="unit" value={unitId} /><input type="hidden" name="params" value={params} />
        <label className="field" style={{ flex: '1 1 220px' }}><span title={T('Клиент видит «Вариант 1–3»')}>{T('Название варианта (только для вас)')}</span><input className="in" name="name" value={vname} onChange={(e) => setVname(e.target.value)} placeholder={T('Взнос {p}% · {m}', { p: Math.round(r.downPct), m: r.months ? T('{m} мес.', { m: r.months }) : T('без рассрочки') })} maxLength={80} /></label>
        {clients.length > 0 && <label className="field" style={{ flex: '1 1 200px' }}><span>{T('Клиент (необязательно)')}</span><select key={`client:${clientPreset || ''}`} className="in" name="client" defaultValue={clientPreset || ''}><option value="">—</option>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {/* 373: «Попросить больше» — только когда своя часть отдана клиенту целиком */}
        {ask && ceiling > 0 && (!asking
          ? (r.disc + 1e-9 >= r.capEff ? <button type="button" className="btn" onClick={() => setAsking(true)}>{T('Попросить больше')}</button>
            : <span className="tiny muted">{T('«Попросить больше» — когда вся ваша часть отдана клиенту')}</span>)
          : <span className="row" style={{ gap: 6, flexBasis: '100%', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="field"><span>{T('Какая скидка нужна клиенту, %')}</span><input className="in" name="ask_pct" inputMode="decimal" style={{ width: 110 }} /></label>
              <label className="field" style={{ flex: '1 1 260px' }}><span>{T('Комментарий для руководителя рынка')}</span><input className="in" name="ask_note" maxLength={500} placeholder={T('Почему нужна большая скидка: бюджет клиента, конкурент, несколько квартир…')} /></label>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAsking(false)}>{T('Отменить запрос')}</button>
            </span>)}
        <button className="btn btn--p" disabled={saving}>{T('Сохранить вариант')}</button>
        {saved?.error && <span className="err tiny">{saved.error}</span>}{saved?.ok && <span className="okc tiny">{T('Вариант сохранён')}</span>}
      </form>}
      {variants.length > 0 && <div className="stack" style={{ gap: 8 }}>
        <div className="label">{T('Сохранённые варианты')} · {variants.length}</div>
        <div className="vcalc__cmp">{variants.map((v) => { const c = cur(v); const changed = Math.abs(c.total - v.snapshot.total) > 1
          return <div key={v.id} className="card card--tight stack" style={{ gap: 4 }}>
            <b className="small">{v.name}</b>
            <div className="tiny muted">{[v.mine ? '' : v.author, v.client].filter(Boolean).join(' · ') || T('без клиента')}</div>
            <div className="kv small"><span>{T('Цена')}</span><b>{usd(lang, c.total)}</b></div>
            <div className="kv small"><span>{T('Первый взнос')}</span><span>{usd(lang, c.down)} · {pct(lang, c.downPct)}</span></div>
            <div className="kv small"><span>{T('Платёж в месяц')}</span><span>{c.monthly ? `${usd(lang, c.monthly)} × ${c.months}` : '—'}</span></div>
            <div className="kv small"><span>{T('Последний платёж')}</span><span>{c.last ? date(lang, c.last) : '—'}</span></div>
            {c.disc > 0 && <div className="kv small"><span>{T('Скидка из пула')}</span><span>{pct(lang, c.disc)}</span></div>}
            {changed && <span className="pill pill--warn">{T('Цена изменилась: было {a}', { a: usd(lang, v.snapshot.total) })}</span>}
            {c.approx && <span className="tiny muted">{T('ориентировочно')}</span>}
            {v.needs_approval && <span className={'pill ' + (v.approved_at ? 'pill--ok' : 'pill--warn')}>{T(v.approved_at ? 'скидка согласована' : 'нужно согласование')}</span>}
            <div className="row noprint" style={{ gap: 4, marginTop: 4 }}>
              <button type="button" className="btn btn--sm" onClick={() => load(v)}>{T('Открыть')}</button>
              {bookable && unitId && (!v.needs_approval || v.approved_at) && <a className="btn btn--sm btn--p" href={`/units/${unitId}/book?variant=${v.id}${v.client_id ? '&client=' + v.client_id : ''}`}>{T('Запросить бронь')}</a>}
              {canApprove && v.needs_approval && !v.approved_at && <form action={approveAct}><input type="hidden" name="id" value={v.id} /><button className="btn btn--sm btn--p">{T('Согласовать')}</button></form>}
              {/* QA 10.11: удалить может автор или владелец — руководителю рынка «×» не показываем (было: молча не срабатывало) */}
              {(v.mine || ownerView) && <form action={deleteAct}><input type="hidden" name="id" value={v.id} /><button className="btn btn--sm btn--ghost" title={T('Удалить')}>×</button></form>}
            </div>
          </div> })}</div>
      </div>}
      <div className="tiny muted">{T('Даты — ориентир от первого взноса; точный график — в договоре с застройщиком.')}{fx ? ' ' + T('{c} — справочно, по курсу ЦБ Азербайджана на {d}.', { c: fx.cur, d: date(lang, fx.date) }) : ''}</div>
    </div>
  )
}
