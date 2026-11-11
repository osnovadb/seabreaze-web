import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, m2, dateTime, pct } from '@/lib/i18n'
import { unitsByIds, planUrl, unitNo, codeFor, plansFor } from '@/lib/catalog'
import { planLabel, type Plan } from '@/lib/plans'
import { clientScope } from '@/lib/scope'
import { Top, Pill } from '@/components/ui'
import { selectionUpdate } from '@/lib/actions'
import { joinWaitlist } from '@/lib/waitActions'
import { needUuid } from '@/lib/ids'
import { isExternal } from '@/lib/perm'
import { selectionVariants, MAX_SEL_VARIANTS } from '@/lib/selVariants'
import type { Snapshot } from '@/lib/variants'

export default async function SelectionEdit(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  needUuid(params.id)
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const cs = clientScope(c.user)
  const s = await one<{ id: string; token: string; title: string; lang: string; opened: number; last_opened_at: string | null; client: string; client_id: string; user_id: string }>(
    `select s.*, cl.name client from portal.selections s join portal.clients cl on cl.id = s.client_id where s.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, params.id])
  if (!s) notFound()
  const items = await q<{ unit_id: string; note: string | null; liked: boolean; plan_id: string | null }>('select unit_id, note, liked, plan_id from portal.selection_items where selection_id = $1 order by sort', [s.id])
  const units = new Map((await unitsByIds(items.map((i) => i.unit_id))).map((u) => [u.id, u]))
  const plansBy = new Map<string, Plan[]>()
  for (const u of units.values()) { const k = u.project_id + ':' + (u.building_id || ''); if (!plansBy.has(k)) plansBy.set(k, await plansFor(u.project_id, u.building_id)) }
  // Этап 3 калькулятора: варианты расчёта по квартирам подборки — свои, на этого клиента или (руководителю) все
  const attached = await selectionVariants(s.id)
  const head = ['owner', 'market_head'].includes(c.user.role)
  // QA 10.11: менять подборку может автор или владелец (selectionUpdate) — остальным кнопку не показываем
  const authorAg = (await one<{ agency_id: string | null }>('select agency_id from portal.users where id = $1', [s.user_id]))?.agency_id
  const canEdit = (s.user_id === c.user.id || c.user.role === 'owner' || (c.user.role === 'agency_head' && !!authorAg && authorAg === c.user.agency_id)) && !c.impersonating // 375
  const changed = await one<{ who: string; at: string }>('select u.name who, s.updated_at at from portal.selections s join portal.users u on u.id = s.updated_by where s.id = $1 and s.updated_by is not null and s.updated_by <> s.user_id', [s.id])
  const author = canEdit ? null : (await one<{ name: string }>('select name from portal.users where id = $1', [s.user_id]))?.name
  const avail = items.length ? await q<{ id: string; unit_id: string; name: string; snapshot: Snapshot; needs_approval: boolean; approved_at: string | null; author: string; mine: boolean }>(
    `select v.id, v.unit_id, v.name, v.snapshot, v.needs_approval, v.approved_at, a.name author, v.author_id = $2 mine from portal.calc_variants v join portal.users a on a.id = v.author_id
     where v.unit_id = any($1::uuid[]) and (v.author_id = $2 or ((v.client_id = $3 and not $5) or $4)) order by v.created_at`, [items.map((i) => i.unit_id), c.user.id, s.client_id, head, isExternal(c.user.role)]) : []
  const host = (await headers()).get('x-forwarded-host') || (await headers()).get('host')
  const proto = (await headers()).get('x-forwarded-proto') || 'http'
  const link = `${proto}://${host}/s/${s.token}`
  return (
    <>
      <Top crumbs={[[T('Подборки'), '/selections'], [s.client, `/clients/${s.client_id}`], [T(s.title || 'Подборка')]]} title={T('Подборка для {c}', { c: s.client })}
        sub={T('{n} квартир · клиент открывал {o} раз{l}', { n: items.length, o: s.opened, l: s.last_opened_at ? ', ' + T('последний — {d}', { d: dateTime(L, s.last_opened_at) }) : '' })}
        right={<><a className="btn" href={`/s/${s.token}?preview=1`} target="_blank">{T('Как видит клиент ↗')}</a><Link className="btn btn--p" href="/catalog">{T('Добавить квартиры')}</Link></>} />
      <div className="page split">
        <form action={selectionUpdate} className="card stack">
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="client" value={s.client_id} />
          {items.length === 0 && <div className="muted">{T('Пусто — добавьте квартиры из каталога или шахматки')}</div>}
          {items.map((i) => {
            const u = units.get(i.unit_id)
            if (!u) return null
            const free = codeFor(u, null, 'show') === 'F' || u.booking_agent === c.user.id
            return (
              <div key={i.unit_id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 16, borderBottom: '1px solid var(--line-2)', paddingBottom: 12 }}>
                <div className="planbox" style={{ padding: 4, height: 110 }}>{planUrl(u.plan_file) && <img src={planUrl(u.plan_file)!} alt="" style={{ maxHeight: 100 }} />}</div>
                <div>
                  <div className="row"><b>{unitNo(u)}</b>{!free && <Pill kind="bad">{T(u.status === 'sold' || u.deal_id ? 'продана' : 'уже занята')}</Pill>}{!free && u.status !== 'sold' && <button className="btn btn--sm" formAction={joinWaitlist} name="unit" value={u.id}>{T('Ждать освобождения')}</button>}{i.liked && <Pill kind="warn">♥ {T('понравилась на встрече')}</Pill>}</div>
                  <div className="small muted">{T('{r} комн.', { r: u.rooms ?? '' })} · {m2(L, u.area)} · {T('{f} этаж', { f: u.floor })} · {u.building}</div>
                  <div className="mt8"><b>{u.usd ? usd(L, u.usd) : ''}</b></div>
                  <input className="in mt8" name={`note:${u.id}`} defaultValue={i.note || ''} placeholder={T('Заметка для клиента…')} />
                  {(() => {
                    const vs = avail.filter((v) => v.unit_id === u.id), on = new Set((attached.get(u.id) || []).map((x) => x.variant_id))
                    return <div className="mt8">
                      <input type="hidden" name="vunit" value={u.id} />
                      <div className="label">{T('Варианты расчёта для клиента — до {n}', { n: MAX_SEL_VARIANTS })}</div>
                      {vs.length === 0 && <div className="tiny muted">{T('Нет сохранённых вариантов.')} <Link className="bronze" href={`/units/${u.id}`}>{T('Рассчитать в калькуляторе →')}</Link></div>}
                      {vs.map((v) => { const blocked = v.needs_approval && !v.approved_at, liked = (attached.get(u.id) || []).find((x) => x.variant_id === v.id)?.liked_at
                        return <label key={v.id} className="kv check small" style={{ alignItems: 'center' }}>
                          <span><input type="checkbox" name={`vars:${u.id}`} value={v.id} defaultChecked={on.has(v.id)} disabled={!canEdit || (blocked && !on.has(v.id))} /> <b>{v.name}</b>{!v.mine && <span className="muted"> · {v.author}</span>}
                            <div className="tiny muted">{usd(L, v.snapshot.total)} · {T('взнос {p}', { p: pct(L, v.snapshot.downPct) })}{v.snapshot.months ? ' · ' + T('{m} мес.', { m: v.snapshot.months }) : ''}{v.snapshot.disc > 0 ? ' · ' + T('скидка {p}', { p: pct(L, v.snapshot.disc) }) : ''}</div>
                            {blocked && <div className="tiny warnc">{T('ждёт согласования скидки — клиенту не уйдёт')}</div>}{liked && <div className="tiny okc">♥ {T('клиенту подходит')}</div>}</span>
                          {free && !blocked && <Link className="btn btn--sm" href={`/units/${u.id}/book?client=${s.client_id}&variant=${v.id}`}>{T('Запросить бронь')}</Link>}
                        </label> })}
                    </div>
                  })()}
                  {(plansBy.get(u.project_id + ':' + (u.building_id || '')) || []).length > 0 && (
                    <label className="field mt8"><span>{T('График платежей для клиента')}</span>
                      <select key={`plan:${u.id}:${String(i.plan_id || '')}`} className="in" name={`plan:${u.id}`} defaultValue={i.plan_id || ''}>
                        <option value="">{T('Не показывать')}</option>
                        {plansBy.get(u.project_id + ':' + (u.building_id || ''))!.map((p) => <option key={p.id} value={p.id}>{planLabel(T, p.name, p)}</option>)}
                      </select></label>
                  )}
                </div>
                <button className="btn btn--sm" name="remove" value={u.id}>✕</button>
              </div>
            )
          })}
          {changed && <div className="tiny muted">{T('Изменено: {w}, {d}', { w: changed.who, d: dateTime(L, changed.at) })}</div>}
          {canEdit ? <button className="btn">{T('Сохранить заметки, графики и варианты')}</button>
            : <div className="note small">{T('Менять подборку может её автор ({a}) или владелец', { a: author || '—' })}</div>}
        </form>
        <div className="stack">
          <form action={selectionUpdate} className="card stack" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={s.id} />
            <div className="h3" style={{ margin: 0 }}>{T('Язык для клиента')}</div>
            <div className="row">{['de', 'en', 'ru', 'he'].map((l) => <button key={l} name="lang" value={l} className={'chip' + (s.lang === l ? ' on' : '')}>{l.toUpperCase()}</button>)}</div>
          </form>
          <div className="card">
            <div className="h3">{T('Ссылка для клиента')}</div>
            <input className="in" readOnly value={link} />
            <div className="tiny muted mt8">{T('Отправьте в WhatsApp или e-mail. Мы увидим, когда клиент откроет, и пришлём вам уведомление. Контактов застройщика в подборке нет — только ваши.')}</div>
            <a className="btn btn--p btn--block mt16" href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank">{T('Отправить в WhatsApp')}</a>
          </div>
        </div>
      </div>
    </>
  )
}
