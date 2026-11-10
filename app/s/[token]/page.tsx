import { PrintButton } from '@/components/PrintButton'
import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { t, usd, m2, date, pct, isRtl, type Lang } from '@/lib/i18n'
import { unitsByIds, planUrl, unitNo, codeFor, plansFor } from '@/lib/catalog'
import { priceChain, planLabel } from '@/lib/plans'
import { offersFor, promoOf, promoMode } from '@/lib/promo'
import { fxFor } from '@/lib/fx'
import { ScheduleTable } from '@/components/Calculator'
import { openedSelection, likeSelVariant } from '@/lib/actions'
import { getCtx } from '@/lib/auth'
import { selectionVariants, clientVisible, clientCalc } from '@/lib/selVariants'
import { DESIGN } from '@/components/ui'

export const dynamic = 'force-dynamic'
export default async function PublicSelection(
  props: { params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  // 2.2 · подборка партнёра — под его брендом (агентство или имя) и с его контактами, без наших (§11 П5)
  const s = await one<{ id: string; lang: Lang; client: string; agent: string; agent_email: string; title: string; market: string | null; partner: boolean; agency: string | null }>(
    `select s.id, s.lang, cl.name client, cl.market, u.name agent, u.email agent_email, s.title, u.role in ('agent','agency_head') partner, a.name agency
     from portal.selections s join portal.clients cl on cl.id = s.client_id join portal.users u on u.id = s.user_id left join portal.agencies a on a.id = u.agency_id where s.token = $1`, [params.token])
  if (!s) notFound()
  // QA 10.11: сотрудник под своим входом — не клиент: «открывал» не растёт, автору не пишем
  if (!searchParams.preview && !(await getCtx())) await openedSelection(params.token)
  const L = s.lang, T = (x: string, v?: Record<string, string | number>) => t(L, x, v)
  const items = await q<{ unit_id: string; note: string | null; plan_id: string | null }>('select unit_id, note, plan_id from portal.selection_items where selection_id = $1 order by sort', [s.id])
  const units = new Map((await unitsByIds(items.map((i) => i.unit_id))).map((u) => [u.id, u]))
  const fx = await fxFor(s.market, L)
  // Акции и правило сложения — по проектам квартир подборки
  const projIds = Array.from(new Set(Array.from(units.values()).map((u) => u.project_id)))
  const offers = new Map(await Promise.all(projIds.map(async (p) => [p, { offers: await offersFor(p), mode: await promoMode(p) }] as const)))
  // Проекты подборки: название в шапке и у каждой квартиры; пример дизайна застройщика — только у Premium Residence
  const projs = new Map((await q<{ id: string; name: string; slug: string; city: string | null }>('select id, name, slug, city from projects where id = any($1)', [projIds])).map((p) => [p.id, p]))
  const promoBy = (u: NonNullable<ReturnType<typeof units.get>>) => { const o = offers.get(u.project_id)!; return { promo: promoOf(u, o.offers), mode: o.mode } }
  // План, выбранный консультантом, и только если он ещё действует для этой квартиры
  const planOf = new Map<string, Awaited<ReturnType<typeof plansFor>>[number]>()
  for (const i of items) { const u = units.get(i.unit_id); if (u && i.plan_id) { const p = (await plansFor(u.project_id, u.building_id)).find((x) => x.id === i.plan_id); if (p) planOf.set(i.unit_id, p) } }
  // Этап 3 калькулятора: варианты расчёта консультанта — только без согласования или согласованные; суммы — по действующей цене
  const sv = await selectionVariants(s.id)
  const calcs = new Map<string, NonNullable<Awaited<ReturnType<typeof clientCalc>>>>()
  for (const list of sv.values()) for (const v of list.filter(clientVisible)) { const r = await clientCalc(v.unit_id, v.params); if (r) calcs.set(v.variant_id, r) }
  return (
    <div dir={isRtl(L) ? 'rtl' : 'ltr'} style={{ background: 'var(--sand)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 64px' }}>
        <div className="between">{s.partner ? <span className="h3" style={{ margin: 0 }}>{s.agency || s.agent}</span> : <img src="/brand/wordmark.svg" alt="GetsEstate" style={{ height: 24 }} />}<PrintButton label={T('Скачать PDF')} /></div>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 28 }}>{T('Подборка для {c}', { c: s.client.split(' · ').pop()! })}</h1>
        <p className="muted">{T('{n} кв. · {p} · цены по прайсу застройщика в долларах США, расходы на сделку отдельно', { n: items.filter((i) => units.has(i.unit_id)).length, p: Array.from(projs.values()).map((p) => p.name + (p.city ? ', ' + p.city : '')).join(' · ') })}</p>
        <div className="stack mt24" style={{ gap: 20 }}>
          {items.map((i) => {
            const u = units.get(i.unit_id)
            if (!u) return null
            const free = codeFor(u, null, 'show') === 'F' || !!u.booking_id
            const pr = projs.get(u.project_id)
            const img = pr?.slug === 'premium-residence' ? DESIGN[u.rooms || 0]?.[0] : undefined
            return (
              <div key={i.unit_id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {img && <div style={{ position: 'relative' }}><img src={`/img/${img}.jpg`} alt="" style={{ width: '100%', aspectRatio: '16/8', objectFit: 'cover' }} /><span className="pill pill--off" style={{ position: 'absolute', top: 12, insetInlineStart: 12, background: '#fff' }}>{T('Визуализация')}</span></div>}
                <div className="selunit">
                  <div>
                    <div className="h2">{T('Квартира {n}', { n: unitNo(u) })}</div>
                    <div className="muted">{pr?.name} · {u.building} · {T('{r} комн.', { r: u.rooms ?? '' })} · {m2(L, u.area)} · {T('{f} этаж', { f: u.floor })}</div>
                    {free && promoBy(u).promo && <div className="mt16"><span className="pill pill--ok">{promoBy(u).promo!.badge || T('Акция')}</span> <span className="small muted">{promoBy(u).promo!.name}</span></div>}
                    <div className="big mt16">{free && u.usd ? (promoBy(u).promo ? <>{usd(L, priceChain(u.usd, null, promoBy(u).promo, promoBy(u).mode).base)} <s className="muted small">{usd(L, u.usd)}</s></> : usd(L, u.usd)) : T(u.status === 'sold' || u.deal_id ? 'Уже продана' : 'Уже забронирована')}</div>
                    {i.note && <div className="bronze mt8">„{i.note}“ — {T('ваш консультант')}</div>}
                    {(u.finish === 'shell' || img) && <div className="small muted mt8">{[u.finish === 'shell' ? T('Сдаётся без ремонта') : '', img ? T('на фото — пример дизайна застройщика') : ''].filter(Boolean).join('; ')}.</div>}
                  </div>
                  {planUrl(u.plan_file) && <div className="planbox"><img src={planUrl(u.plan_file)!} alt="" /></div>}
                </div>
                {free && u.usd && (sv.get(u.id) || []).some((v) => calcs.has(v.variant_id)) && (
                  <div style={{ padding: '0 20px 20px' }}>
                    <div className="label">{T('Варианты оплаты')}</div>
                    <div className="vcalc__cmp mt8">{(sv.get(u.id) || []).filter((v) => calcs.has(v.variant_id)).map((v, vi) => { const r = calcs.get(v.variant_id)!
                      return <div key={v.variant_id} className="card card--tight stack" style={{ gap: 4 }}>
                        <b className="small">{T('Вариант {n}', { n: vi + 1 })}</b>{/* QA 10.11: внутреннее название варианта клиенту не показываем */}
                        <div className="kv small"><span>{T('Цена')}</span><b>{usd(L, r.total)}</b></div>
                        <div className="kv small"><span>{T('Первый взнос')}</span><span>{usd(L, r.down)} · {pct(L, r.downPct)}</span></div>
                        <div className="kv small"><span>{T('Платёж в месяц')}</span><span>{r.monthly ? `${usd(L, r.monthly)} × ${r.months}` : '—'}</span></div>
                        <div className="kv small"><span>{T('Последний платёж')}</span><span>{r.last ? date(L, r.last) : '—'}</span></div>
                        {r.disc > 0 && <div className="kv small"><span>{T('Скидка')}</span><span>{pct(L, r.disc)}</span></div>}
                        {r.devAmt > 0 && <div className="kv small"><span>{T('Скидка застройщика за взнос')}</span><span>−{usd(L, r.devAmt)}</span></div>}
                        {r.optionTitles.length > 0 && <div className="tiny muted">{T('Опции')}: {r.optionTitles.join(', ')}</div>}
                        {r.approx && <span className="tiny muted">{T('ориентировочно')}</span>}
                        <form action={likeSelVariant} className="noprint"><input type="hidden" name="token" value={params.token} /><input type="hidden" name="variant" value={v.variant_id} />
                          <button className={'btn btn--sm' + (v.liked_at ? ' btn--p' : '')} disabled={!!searchParams.preview}>{v.liked_at ? '♥ ' + T('Подходит') : T('Мне подходит')}</button></form>
                      </div> })}</div>
                    <div className="tiny muted mt8">{T('Расчёт предварительный: даты — ориентир от первого взноса; точный график и суммы — в договоре с застройщиком.')}{fx ? ' ' + T('{c} — справочно, по курсу ЦБ Азербайджана на {d}.', { c: fx.cur, d: date(L, fx.date) }) : ''}</div>
                  </div>)}
                {free && u.usd && planOf.get(u.id) && !(sv.get(u.id) || []).some((v) => calcs.has(v.variant_id)) && (() => { const p = planOf.get(u.id)!; return (
                  <div style={{ padding: '0 20px 20px' }}>
                    <div className="label">{T('График платежей')} · {planLabel(T, p.name)}</div>
                    <ScheduleTable plan={p} price={priceChain(u.usd, p, promoBy(u).promo, promoBy(u).mode).base} lang={L} fx={fx} />
                    <div className="tiny muted mt8">{T('Даты — ориентир от первого взноса; точный график — в договоре с застройщиком.')}{fx ? ' ' + T('{c} — справочно, по курсу ЦБ Азербайджана на {d}.', { c: fx.cur, d: date(L, fx.date) }) : ''}</div>
                  </div>) })()}
              </div>
            )
          })}
        </div>
        <div className="card mt24 between selcontact">
          <div><div className="label">{T('Ваш консультант')}</div><div className="h3 mt8">{s.agent}</div><div className="small muted">{s.agent_email}</div></div>
          <a className="btn btn--p btn--lg noprint" href={`mailto:${s.agent_email}`}>{T('Связаться с консультантом')}</a>
        </div>
        <p className="tiny muted mt16">{T('Предложение не является офертой. Цены и наличие подтверждаются консультантом перед бронью.')}</p>
      </div>
    </div>
  )
}
