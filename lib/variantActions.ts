'use server'
// 2.2 · Калькулятор вариантов, этап 2: сохранить, переименовать, прикрепить к клиенту, удалить, согласовать скидку выше порога.
import { revalidatePath } from 'next/cache'
import { q, one, audit, notify } from './db'
import { requireCtx } from './auth'
import { t } from './i18n'
import { projectVisible } from './catalog'
import { clientScope } from './scope'
import { calcInputs, runVariant, snapshotOf, type VariantParams } from './variants'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const MAX_PER_UNIT = 12 // защитный предел на автора и квартиру (в подборку клиенту — до трёх, этап 3)

function parseParams(raw: string): VariantParams {
  let p: Record<string, unknown> = {}
  try { p = JSON.parse(raw || '{}') } catch {}
  return { downPct: num(p.downPct), months: Math.round(num(p.months)), disc: num(p.disc), start: /^\d{4}-\d{2}-\d{2}$/.test(String(p.start || '')) ? String(p.start) : undefined,
    options: Array.isArray(p.options) ? p.options.map(String).slice(0, 20) : [], planId: p.planId ? String(p.planId) : null }
}

export async function saveVariant(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return { error: t(c.lang, 'Только просмотр') }
  if (['finance', 'content', 'referrer'].includes(c.user.role)) return { error: t(c.lang, 'Нет прав') }
  const unitId = s(f, 'unit')
  const inp = await calcInputs(unitId, c.user)
  if (!inp || !(await projectVisible(inp.unit.project_id, c.user))) return { error: t(c.lang, 'Квартира недоступна') }
  const p = parseParams(s(f, 'params'))
  // 10.11 (Денис): партнёр — до своей части пула; больше — только запросом («Попросить больше»), без показа нашей части и всего пула
  const ext = !!inp.base.ext, askPct = Number(s(f, 'ask_pct').replace(',', '.')) || 0, askNote = s(f, 'ask_note').slice(0, 500)
  // 373: «Попросить больше» — только когда своя часть (доля партнёра в пуле плана) отдана клиенту целиком
  const own = runVariant(inp, { ...p, disc: 0 }).capEff // своя часть партнёра по выбранному взносу и сроку (349)
  if (ext && askPct > p.disc) {
    if (p.disc + 1e-9 < own) return { error: t(c.lang, 'Сначала отдайте клиенту свою часть целиком — затем «Попросить больше»') }
    p.disc = askPct
  }
  if (ext && p.disc > own + 1e-9 && !(askPct > 0)) return { error: t(c.lang, 'Скидка больше вашей части — нажмите «Попросить больше»') }
  // QA 10.11: нейтральный потолок запроса (не размер пула); отказ — за руководителем рынка
  if (ext && p.disc > 50) return { error: t(c.lang, 'Скидка больше {p}% не запрашивается', { p: 50 }) }
  // суммы — на сервере, по действующей цене; запрос партнёра не обрезаем по пулу (размер пула ему не раскрываем)
  const r = runVariant(inp, p, ext && askPct > 0 ? 50 : undefined)
  const name = s(f, 'name').slice(0, 80) || t(c.lang, 'Взнос {p}% · {m}', { p: Math.round(r.downPct), m: r.months ? t(c.lang, '{m} мес.', { m: r.months }) : t(c.lang, 'без рассрочки') })
  const id = s(f, 'id')
  const params: VariantParams & { ask_note?: string } = { ...p, downPct: r.downPct, months: r.months, disc: r.disc, planId: r.plan?.id || null, ...(askNote ? { ask_note: askNote } : {}) }
  if (id) {
    const ok = await one(`update portal.calc_variants set name = $3, params = $4, snapshot = $5, needs_approval = $6, approved_by = null, approved_at = null, updated_at = now()
      where id = $1 and author_id = $2 returning id`, [id, c.user.id, name, params, snapshotOf(r, inp.base.list), r.needsApproval])
    if (!ok) return { error: t(c.lang, 'Нет прав') }
  } else {
    const n = await one<{ n: number }>('select count(*)::int n from portal.calc_variants where unit_id = $1 and author_id = $2', [unitId, c.user.id])
    if (n!.n >= MAX_PER_UNIT) return { error: t(c.lang, 'Не больше {n} вариантов на квартиру — удалите лишние', { n: MAX_PER_UNIT }) }
    const client = s(f, 'client') || null
    // QA 10.11: вариант — только на своего (видимого) клиента, не на обезличенного
    const cs = clientScope(c.user)
    if (client && !(await one(`select 1 from portal.clients cl where cl.id = $${cs.params.length + 1} and cl.anonymized_at is null and ${cs.sql}`, [...cs.params, client]))) return { error: t(c.lang, 'Клиент недоступен') }
    await q(`insert into portal.calc_variants (unit_id, author_id, client_id, name, params, snapshot, needs_approval) values ($1,$2,$3,$4,$5,$6,$7)`,
      [unitId, c.user.id, client, name, params, snapshotOf(r, inp.base.list), r.needsApproval])
  }
  // скидка выше порога — руководителю рынка автора (нет — владельцу) уходит запрос на согласование
  // QA 10.11: всем руководителям рынка автора и владельцам (было limit 2 — второй руководитель рынка не получал)
  if (r.needsApproval) for (const h of await q<{ id: string }>(`select id from portal.users where active and ((role = 'market_head' and market = $1) or role = 'owner')`, [c.user.market || '']))
    await notify(h.id, 'booking', askNote ? 'Вариант расчёта со скидкой {d}% ждёт согласования: {n} — «{c}»' : 'Вариант расчёта со скидкой {d}% ждёт согласования: {n}', `/units/${unitId}`, { d: r.disc, n: name, c: askNote })
  await audit(c.real.id, id ? 'variant.update' : 'variant.create', 'unit', unitId, { name, downPct: r.downPct, months: r.months, disc: r.disc, approval: r.needsApproval })
  revalidatePath(`/units/${unitId}`)
  return { ok: true }
}

export async function deleteVariant(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return
  const v = await one<{ unit_id: string }>(`delete from portal.calc_variants where id = $1 and (author_id = $2 or $3) returning unit_id`, [s(f, 'id'), c.user.id, c.user.role === 'owner'])
  if (v) { await audit(c.real.id, 'variant.delete', 'unit', v.unit_id, { id: s(f, 'id') }); revalidatePath(`/units/${v.unit_id}`) }
}

// Скидка выше порога автора: согласует владелец или руководитель рынка; до согласования вариант клиенту не уходит (этап 3)
export async function approveVariant(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating || !['owner', 'market_head'].includes(c.user.role)) return
  const v = await one<{ unit_id: string; author_id: string; name: string }>(`update portal.calc_variants set approved_by = $2, approved_at = now() where id = $1 and needs_approval and approved_at is null returning unit_id, author_id, name`, [s(f, 'id'), c.user.id])
  if (!v) return
  await audit(c.real.id, 'variant.approve', 'unit', v.unit_id, { id: s(f, 'id') })
  await notify(v.author_id, 'booking', 'Скидка в варианте «{n}» согласована', `/units/${v.unit_id}`, { n: v.name })
  revalidatePath(`/units/${v.unit_id}`)
}
