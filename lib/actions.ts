'use server'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { q, one, tx, audit, notify } from './db'
import { getCtx, requireCtx, signSession, clearSession, setShow, clearShow, Ctx } from './auth'
import { canBook, canConfirmBooking, canEditConditions, canManageUsers, canRegisterClient, canReviewAgents, isExternal, maxDiscount, discountCeiling, canApproveDiscount, type Role } from './perm'
import { conditionsFor, split, unitById, projectVisible, plansFor } from './catalog'
import { planBase } from './plans'
import { storeFile, isFile } from './files'
import { LANGS, t, type Lang } from './i18n'
import { stageBlock, LOST_REASONS } from './stages'

// Вход «от имени» по ТЗ — только чтение; на тестовом стенде запись разрешена флагом ALLOW_IMPERSONATE_WRITE=1
async function writeCtx() {
  const c = await requireCtx()
  if (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1') throw new Error('read-only: impersonation')
  return c
}
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
// Телефон: только цифры, без международного префикса 00; дубль ищем по последним 9 цифрам (+49 160…, 0049-160…, 0160…)
const norm = { phone: (p: string) => p.replace(/\D/g, '').replace(/^00/, ''), email: (e: string) => e.trim().toLowerCase() }
const back = (path: string, params: Record<string, string>) => redirect(path + (path.includes('?') ? '&' : '?') + new URLSearchParams(params).toString())

/* ── Вход, язык, «войти как» ── */
export async function login(_: unknown, f: FormData) {
  const u = await one<{ id: string; password_hash: string; active: boolean }>('select id, password_hash, active from portal.users where lower(email) = lower($1)', [s(f, 'email')])
  if (!u || !u.active || !bcrypt.compareSync(s(f, 'password'), u.password_hash)) return { error: 'Неверный e-mail или пароль' }
  await signSession(u.id)
  await q('update portal.users set prev_login_at = last_login_at, last_login_at = now() where id = $1', [u.id])
  await audit(u.id, 'login')
  redirect('/')
}
export async function logout() { clearSession(); redirect('/login') }
export async function setLang(lang: Lang) {
  cookies().set('ge_lang', lang, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' })
  const c = await getCtx()
  if (c && !c.impersonating) await q('update portal.users set locale = $1 where id = $2', [lang, c.user.id])
  revalidatePath('/', 'layout')
}
export async function impersonate(f: FormData) {
  const c = await requireCtx()
  if (c.real.role !== 'owner') return
  const id = s(f, 'user')
  await signSession(c.real.id, id && id !== c.real.id ? id : undefined)
  cookies().delete('ge_lang')
  await audit(c.real.id, 'impersonate', 'user', id)
  redirect('/')
}

/* ── Режим показа клиенту ── */
export async function startShow(f: FormData) {
  const c = await requireCtx()
  const lang = (LANGS.includes(s(f, 'lang') as Lang) ? s(f, 'lang') : c.lang) as Lang
  const client = s(f, 'client') || null
  if (client) await stageGuard(c, client)
  const to = s(f, 'to')
  await setShow(client, lang)
  await audit(c.real.id, 'show.start', 'client', client ?? undefined, null, c.impersonating ? c.user.id : null)
  redirect(to.startsWith('/show') ? to : '/show')
}
export async function exitShow(_: unknown, f: FormData) {
  const c = await requireCtx()
  const r = await one<{ pin_hash: string }>('select pin_hash from portal.users where id = $1', [c.real.id])
  if (!r?.pin_hash || !bcrypt.compareSync(s(f, 'pin'), r.pin_hash)) {
    // 5 неверных PIN за 15 минут — выходим из аккаунта целиком, чтобы PIN нельзя было подобрать
    await audit(c.real.id, 'show.pin_fail')
    const fails = await one<{ n: number }>(`select count(*)::int n from portal.audit where user_id = $1 and action = 'show.pin_fail' and created_at > now() - interval '15 minutes'`, [c.real.id])
    if (fails!.n >= 5) { clearShow(); clearSession(); redirect('/login') }
    return { error: 'Неверный PIN' }
  }
  if (c.show?.clientId) {
    // Отмеченные на этой встрече квартиры (подборка «Встреча» за последние 4 часа — срок режима показа)
    const liked = await q<{ unit: string }>(`select coalesce(bl.external_id, '') || '-' || u.number unit from portal.selection_items si join portal.selections se on se.id = si.selection_id
      join units u on u.id = si.unit_id join buildings bl on bl.id = u.building_id where se.client_id = $1 and se.title = 'Встреча' and si.liked and si.created_at > now() - interval '4 hours' order by si.created_at`, [c.show.clientId])
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'meeting','Встреча в режиме показа · отмечено квартир: {n}',$3)`, [c.show.clientId, c.user.id, { n: liked.length + (liked.length ? ' (' + liked.map((x) => x.unit).join(', ') + ')' : '') }])
  }
  clearShow()
  redirect('/')
}
export async function likeInShow(unitId: string) {
  const c = await writeCtx()
  if (!c.show?.clientId) return
  let sel = await one<{ id: string }>(`select id from portal.selections where client_id = $1 and title = 'Встреча' order by created_at desc limit 1`, [c.show.clientId])
  if (!sel) sel = await one<{ id: string }>(`insert into portal.selections (token, client_id, user_id, title, lang) values ($1,$2,$3,'Встреча',$4) returning id`, [crypto.randomBytes(9).toString('base64url'), c.show.clientId, c.user.id, c.show.lang])
  await q(`insert into portal.selection_items (selection_id, unit_id, liked) values ($1,$2,true) on conflict (selection_id, unit_id) do update set liked = not portal.selection_items.liked, created_at = now()`, [sel!.id, unitId])
  revalidatePath('/show')
}

/* ── Клиенты ── */
async function stageGuard(c: Ctx, clientId: string) {
  const cl = await one<{ id: string; owner_id: string; agency_id: string | null; name: string }>('select id, owner_id, agency_id, name from portal.clients where id = $1', [clientId])
  if (!cl) throw new Error('client')
  const u = c.user
  const ok = u.role === 'owner' || u.role === 'market_head' || u.role === 'office' || cl.owner_id === u.id || (u.role === 'agency_head' && cl.agency_id === u.agency_id)
    || (u.role === 'seller' && (await one('select 1 from portal.users where id = $1 and curator_id = $2', [cl.owner_id, u.id])))
  if (!ok) throw new Error('forbidden')
  return cl
}

export async function registerClient(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canRegisterClient(c.user.role)) return { error: 'Нет прав на регистрацию клиента' }
  const name = s(f, 'name'), phone = s(f, 'phone'), email = s(f, 'email')
  if (!name || (!phone && !email)) return { error: 'Нужны имя и телефон или e-mail' }
  if (!f.get('consent')) return { error: 'Без согласия клиента регистрация невозможна' }
  const pn = norm.phone(phone), em = norm.email(email)
  const dup = await one<{ id: string; owner_id: string }>(`select id, owner_id from portal.clients where (length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or (email_norm <> '' and email_norm = $2) limit 1`, [pn, em])
  if (dup) {
    await audit(c.real.id, 'client.duplicate', 'client', dup.id, { tried_by: c.user.id }, c.impersonating ? c.user.id : null)
    // Возвращаем только то, что ввёл сам пользователь, — для кнопки «Запросить проверку»; владельца не раскрываем
    return { duplicate: true, tried: { name, phone, email } }
  }
  const pid = await one<{ id: string }>(`select id from projects where slug = 'premium-residence'`)
  const cond = pid ? await conditionsFor(pid.id) : undefined
  const months = cond?.protect_months ?? 3
  const n = await one<{ n: number }>(`select count(*)::int + 141 as n from portal.clients`)
  const reg = `R-2026-0${n!.n + 1}`
  const r = await one<{ id: string; protected_until: string }>(`insert into portal.clients (reg_no, owner_id, agency_id, name, phone, phone_norm, email, email_norm, country, language, market, consent_at, source, goal, budget, timeline, payment, interest, stage, protected_until)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12,$13,$14,$15,$16,$17,'lead', current_date + ($18 || ' months')::interval) returning id, protected_until::text`,
    [reg, c.user.id, c.user.agency_id, name, phone, pn, email, em, s(f, 'country'), s(f, 'language'), c.user.market, isExternal(c.user.role) ? 'agent' : s(f, 'source') || 'office', s(f, 'goal') || null, s(f, 'budget') || null, s(f, 'timeline') || null, s(f, 'payment') || null, s(f, 'interest') || null, months])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Клиент зарегистрирован ({r}), закреплён до {d}',$3)`, [r!.id, c.user.id, { r: reg, d: r!.protected_until }])
  if (c.user.curator_id) await notify(c.user.curator_id, 'client', 'Новый клиент агента {a}: {c}', `/clients/${r!.id}`, { a: c.user.name, c: name })
  await audit(c.real.id, 'client.register', 'client', r!.id, { reg }, c.impersonating ? c.user.id : null)
  return { ok: true, id: r!.id, reg, until: r!.protected_until }
}

/* ── Споры «чей клиент» ── */
export async function requestDispute(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canRegisterClient(c.user.role)) return { error: 'Нет прав на регистрацию клиента' }
  const name = s(f, 'name'), phone = s(f, 'phone'), email = s(f, 'email')
  const pn = norm.phone(phone), em = norm.email(email)
  const dup = await one<{ id: string; owner_id: string; market: string | null; name: string }>(`select id, owner_id, market, name from portal.clients where (length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or (email_norm <> '' and email_norm = $2) limit 1`, [pn, em])
  if (!dup) return { error: 'Клиент не найден — зарегистрируйте его заново' }
  if (dup.owner_id === c.user.id) return { error: 'Клиент уже закреплён за вами' }
  const open = await one('select 1 from portal.disputes where client_id = $1 and requester_id = $2 and status = $3', [dup.id, c.user.id, 'open'])
  if (!open) {
    const d = await one<{ id: string }>(`insert into portal.disputes (client_id, requester_id, name, phone, email, comment) values ($1,$2,$3,$4,$5,$6) returning id`, [dup.id, c.user.id, name, phone || null, email || null, s(f, 'comment') || null])
    for (const o of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role = 'market_head' and market = $1))`, [dup.market])) await notify(o.id, 'dispute', 'Запрос проверки «чей клиент»: {c}', '/admin/disputes', { c: dup.name })
    await audit(c.real.id, 'dispute.open', 'client', dup.id, { dispute: d!.id }, c.impersonating ? c.user.id : null)
  }
  return { ok: true }
}
export async function resolveDispute(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) return
  const d = await one<{ id: string; client_id: string; requester_id: string; status: string; market: string | null; owner_id: string; cname: string }>(`select d.id, d.client_id, d.requester_id, d.status, cl.market, cl.owner_id, cl.name cname from portal.disputes d join portal.clients cl on cl.id = d.client_id where d.id = $1`, [s(f, 'id')])
  if (!d || d.status !== 'open' || (c.user.role === 'market_head' && d.market !== c.user.market)) return
  const act = s(f, 'act') === 'transfer' ? 'transferred' : 'kept'
  await tx(async (t) => {
    await t.query(`update portal.disputes set status = $2, decided_by = $3, decided_at = now(), decision = $4 where id = $1`, [d.id, act, c.user.id, s(f, 'decision') || null])
    if (act === 'transferred') {
      await t.query(`update portal.clients set owner_id = $2, agency_id = (select agency_id from portal.users where id = $2) where id = $1`, [d.client_id, d.requester_id])
      await t.query(`insert into portal.activities (client_id, user_id, kind, text, internal) values ($1,$2,'system','Клиент передан другому владельцу',true)`, [d.client_id, c.user.id])
    }
  })
  await notify(d.requester_id, 'dispute', act === 'transferred' ? 'Спор решён в вашу пользу: {c}' : 'Спор решён: клиент остаётся за первым зарегистрировавшим', act === 'transferred' ? `/clients/${d.client_id}` : '/clients', { c: d.cname })
  if (act === 'transferred') await notify(d.owner_id, 'dispute', 'Клиент {c} передан по решению спора', '/clients', { c: d.cname })
  await audit(c.real.id, 'dispute.' + act, 'client', d.client_id, { dispute: d.id }, c.impersonating ? c.user.id : null)
  revalidatePath('/admin/disputes')
}

// Перевод по воронке из канбана и шагов карточки: правила те же, что подсвечивают колонки в браузере (lib/stages.ts)
export async function moveStage(clientId: string, target: string, extra?: { reason?: string; until?: string }): Promise<{ ok?: true; error?: string }> {
  const c = await writeCtx()
  await stageGuard(c, clientId)
  const cl = await one<{ stage: string; pause_until: string | null; has_booking: boolean; has_deal: boolean; qualified: boolean; name: string }>(`select stage, pause_until, name,
      (coalesce(goal, '') <> '' and coalesce(budget, '') <> '' and coalesce(timeline, '') <> '') qualified,
      exists (select 1 from portal.bookings b where b.client_id = cl.id and b.status in ('requested','confirmed')) has_booking,
      exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled') has_deal
    from portal.clients cl where id = $1`, [clientId])
  if (!cl) return { error: t(c.lang, 'Клиент не найден — зарегистрируйте его заново') }
  const block = stageBlock(c.user.role, { stage: cl.stage, paused: !!cl.pause_until, hasBooking: cl.has_booking, hasDeal: cl.has_deal, qualified: cl.qualified }, target)
  if (block) return { error: t(c.lang, block) }
  if (target === 'pause') {
    if (!extra?.until || extra.until <= new Date().toISOString().slice(0, 10)) return { error: t(c.lang, 'Укажите дату возврата в будущем') }
    await q(`update portal.clients set pause_until = $2, last_activity_at = now() where id = $1`, [clientId, extra.until])
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Пауза до {d}',$3)`, [clientId, c.user.id, { d: extra.until }])
  } else if (target === 'lost') {
    if (!extra?.reason || !LOST_REASONS.includes(extra.reason)) return { error: t(c.lang, 'Выберите причину отказа') }
    await q(`update portal.clients set stage = 'lost', lost_reason = $2, pause_until = null, last_activity_at = now() where id = $1`, [clientId, extra.reason])
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Стадия: {stage}{r}',$3)`, [clientId, c.user.id, { stage: 'lost', r: ' · ' + extra.reason }])
  } else {
    if (target === cl.stage && !cl.pause_until) return { ok: true }
    // Показ — с датой: задача в день показа и отметка в истории
    if (target === 'viewing' && extra?.until) {
      if (extra.until < new Date().toISOString().slice(0, 10)) return { error: t(c.lang, 'Дата показа — сегодня или позже') }
      await q(`insert into portal.tasks (client_id, user_id, title, vars, due, auto) values ($1,$2,'Показ: {c}',$3,$4,true)`, [clientId, c.user.id, { c: cl.name }, extra.until])
    }
    await q(`update portal.clients set stage = $2, lost_reason = null, pause_until = null, last_activity_at = now() where id = $1`, [clientId, target])
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Стадия: {stage}{r}',$3)`, [clientId, c.user.id, { stage: target, r: '' }])
  }
  await audit(c.real.id, 'client.stage', 'client', clientId, { from: cl.stage, to: target, ...extra }, c.impersonating ? c.user.id : null)
  revalidatePath('/clients'); revalidatePath(`/clients/${clientId}`); revalidatePath('/')
  return { ok: true }
}

export async function addActivity(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client')
  await stageGuard(c, id)
  const text = s(f, 'text')
  if (text) {
    const internal = !isExternal(c.user.role) && !!f.get('internal')
    await q(`insert into portal.activities (client_id, user_id, kind, text, internal) values ($1,$2,$3,$4,$5)`, [id, c.user.id, s(f, 'kind') || 'note', text, internal])
    await q('update portal.clients set last_activity_at = now() where id = $1', [id])
  }
  revalidatePath(`/clients/${id}`)
}
export async function saveQualification(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client')
  await stageGuard(c, id)
  await q(`update portal.clients set goal = $2, budget = $3, timeline = $4, payment = $5, interest = $6, last_activity_at = now() where id = $1`, [id, s(f, 'goal'), s(f, 'budget'), s(f, 'timeline'), s(f, 'payment'), s(f, 'interest')])
  revalidatePath(`/clients/${id}`)
}
export async function addTask(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client') || null
  if (id) await stageGuard(c, id)
  if (s(f, 'title')) await q(`insert into portal.tasks (client_id, user_id, title, due) values ($1,$2,$3,$4)`, [id, c.user.id, s(f, 'title'), s(f, 'due') || null])
  revalidatePath(id ? `/clients/${id}` : '/')
}
export async function toggleTask(id: string) {
  const c = await writeCtx()
  await q('update portal.tasks set done = not done where id = $1 and (user_id = $2 or $3)', [id, c.user.id, c.user.role === 'owner'])
  revalidatePath('/', 'layout')
}
export async function setKyc(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'market_head', 'seller', 'office'].includes(c.user.role) || !['none', 'pending', 'passed', 'rejected'].includes(s(f, 'kyc'))) return
  await stageGuard(c, s(f, 'client'))
  await q('update portal.clients set kyc_status = $2 where id = $1', [s(f, 'client'), s(f, 'kyc')])
  await q(`insert into portal.activities (client_id, user_id, kind, text, internal, vars) values ($1,$2,'system','KYC: {k}',true,$3)`, [s(f, 'client'), c.user.id, { k: s(f, 'kyc') }])
  revalidatePath(`/clients/${s(f, 'client')}`)
}
export async function fixation(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client'), pid = s(f, 'project'), act = s(f, 'act')
  if (act === 'send') {
    await stageGuard(c, id)
    await q(`insert into portal.fixations (client_id, project_id) values ($1,$2) on conflict do nothing`, [id, pid])
    await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'system','Отправлено на фиксацию у застройщика')`, [id, c.user.id])
  } else if (['owner', 'market_head', 'seller', 'office'].includes(c.user.role) && ['approved', 'rejected'].includes(act)) {
    const cl = await one<{ owner_id: string; name: string }>('select owner_id, name from portal.clients where id = $1', [id])
    await q(`update portal.fixations set status = $3, decided_at = now(), protected_until = case when $3 = 'approved' then current_date + interval '12 months' end where client_id = $1 and project_id = $2`, [id, pid, act])
    await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'system',$3)`, [id, c.user.id, act === 'approved' ? 'Застройщик одобрил фиксацию' : 'Застройщик отклонил фиксацию'])
    if (cl) await notify(cl.owner_id, 'fixation', act === 'approved' ? 'Фиксация одобрена: {c}' : 'Фиксация отклонена: {c}', `/clients/${id}`, { c: cl.name })
  }
  revalidatePath(`/clients/${id}`)
}
export async function transferClient(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) return
  await q('update portal.clients set owner_id = $2 where id = $1', [s(f, 'client'), s(f, 'owner')])
  await q(`insert into portal.activities (client_id, user_id, kind, text, internal) values ($1,$2,'system','Клиент передан другому владельцу',true)`, [s(f, 'client'), c.user.id])
  await audit(c.real.id, 'client.transfer', 'client', s(f, 'client'), { to: s(f, 'owner') })
  revalidatePath(`/clients/${s(f, 'client')}`)
}

/* ── Брони ── */
export async function createBooking(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canBook(c.user.role)) return { error: 'Нет прав на бронь' }
  const unit = await unitById(s(f, 'unit'))
  const clientId = s(f, 'client')
  if (!unit) return { error: 'Квартира не найдена' }
  if (!clientId) return { error: 'Выберите закреплённого клиента' }
  const cl = await stageGuard(c, clientId).catch(() => null)
  if (!cl) return { error: 'Этот клиент не закреплён за вами' }
  if (unit.status !== 'available' || unit.price == null || unit.booking_id || unit.deal_id) return { error: 'Квартира уже недоступна' }
  if (unit.sales_status !== 'sales' && c.user.role !== 'owner') return { error: 'Проект на стоп-продажах — новые брони не принимаются' }
  if (unit.hidden && isExternal(c.user.role)) return { error: 'Квартира уже недоступна' }
  if (isExternal(c.user.role) && !(await projectVisible(unit.project_id, c.user))) return { error: 'Квартира уже недоступна' }
  const cond = await conditionsFor(unit.project_id, isExternal(c.user.role) ? c.user : null)
  if (!cond) return { error: 'Для проекта не заведены условия' }
  const disc = Math.max(0, Number(s(f, 'discount') || 0))
  const cap = maxDiscount(c.user.role, cond), ceiling = discountCeiling(c.user.role, cond)
  if (disc > ceiling) return { error: t(c.lang, 'Скидка больше {p}% — только по запросу', { p: ceiling }) }
  // Сверх своего порога — бронь ставится, но ждёт согласования владельца или руководителя рынка (офис не подтверждает до решения)
  const approval = disc > cap ? 'pending' : null
  const active = await one<{ cl: number; ag: number; tot: number }>(`select
      count(*) filter (where client_id = $1)::int cl, count(*) filter (where agent_id = $2)::int ag, count(*)::int tot
    from portal.bookings where project_id = $3 and status in ('requested','confirmed')`, [clientId, c.user.id, unit.project_id])
  if (active!.cl >= cond.max_bookings_client) return { error: t(c.lang, 'У клиента уже {n} активных брони — это максимум', { n: active!.cl }) }
  if (isExternal(c.user.role) && active!.ag >= cond.max_bookings_agent) return { error: t(c.lang, 'Лимит броней агента: {n}', { n: cond.max_bookings_agent }) }
  if (active!.tot >= cond.max_bookings_total) return { error: 'Общий лимит броней у застройщика исчерпан — лист ожидания' }
  // План оплаты: «100% сразу» со скидкой застройщика снижает цену до раздела денег
  const plan = s(f, 'plan') ? (await plansFor(unit.project_id, unit.building_id)).find((p) => p.id === s(f, 'plan')) : undefined
  if (s(f, 'plan') && !plan) return { error: t(c.lang, 'План оплаты больше не действует — обновите страницу') }
  const usdPrice = planBase(plan, unit.usd!)
  const sp = split(cond, usdPrice, disc, isExternal(c.user.role))
  const b = await one<{ id: string }>(`insert into portal.bookings (unit_id, project_id, client_id, agent_id, price_list, discount_pct, final_price, conditions_id, snapshot, ends_at, approval)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' days')::interval, $11) returning id`,
    [unit.id, unit.project_id, clientId, c.user.id, usdPrice, disc, Math.round(sp.final), cond.id, JSON.stringify({ ...cond, split: sp, list_original: unit.usd, plan: plan ? { id: plan.id, name: plan.name, down: plan.down_payment_pct, months: plan.months, full_discount: plan.full_payment_discount_pct } : null }), cond.booking_days, approval])
  await q(`update portal.clients set stage = 'booking', last_activity_at = now() where id = $1`, [clientId])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Бронь {u} на {d} дней, цена {p}',$3)`, [clientId, c.user.id, { u: `${unit.block}-${unit.number}`, d: cond.booking_days, p: '$' + Math.round(sp.final).toLocaleString('en') }])
  const u = `${unit.block}-${unit.number}`
  if (approval) {
    const mk = (await one<{ market: string | null }>('select market from portal.clients where id = $1', [clientId]))?.market
    for (const o of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role = 'market_head' and market = $1))`, [mk])) await notify(o.id, 'booking', 'Скидка {p}% по брони {u} ждёт согласования', '/bookings', { p: disc, u })
  } else for (const o of await q<{ id: string }>(`select id from portal.users where role = 'office' and active`)) await notify(o.id, 'booking', 'Новая бронь {u} ждёт подтверждения у застройщика', '/bookings', { u })
  await audit(c.real.id, 'booking.create', 'booking', b!.id, { unit: unit.id, disc }, c.impersonating ? c.user.id : null)
  if (c.show) redirect(`/show/unit/${unit.id}?booked=1`)
  redirect(`/bookings?created=${b!.id}`)
}
export async function bookingAction(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'id'), act = s(f, 'act')
  const b = await one<{ id: string; agent_id: string; client_id: string; status: string; extended: boolean; unit_id: string; final_price: number; project_id: string; snapshot: any; approval: string | null; discount_pct: number }>('select * from portal.bookings where id = $1', [id])
  if (!b) return
  const mine = b.agent_id === c.user.id || c.user.role === 'owner'
  if ((act === 'approve' || act === 'decline') && canApproveDiscount(c.user.role) && b.approval === 'pending' && b.status === 'requested') {
    if (act === 'approve') {
      await q(`update portal.bookings set approval = 'approved', approved_by = $2 where id = $1`, [id, c.user.id])
      await notify(b.agent_id, 'booking', 'Скидка по брони согласована', '/bookings')
      for (const o of await q<{ id: string }>(`select id from portal.users where role = 'office' and active`)) await notify(o.id, 'booking', 'Новая бронь ждёт подтверждения у застройщика', '/bookings')
    } else {
      await q(`update portal.bookings set approval = 'rejected', approved_by = $2, status = 'cancelled' where id = $1`, [id, c.user.id])
      await notify(b.agent_id, 'booking', 'Скидка по брони не согласована — бронь снята', '/bookings')
    }
  } else if (act === 'confirm' && canConfirmBooking(c.user.role) && b.status === 'requested' && b.approval !== 'pending') {
    await q(`update portal.bookings set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1`, [id, c.user.id])
    await notify(b.agent_id, 'booking', 'Бронь подтверждена у застройщика', '/bookings')
  } else if (act === 'extend' && (mine || canConfirmBooking(c.user.role)) && !b.extended && ['requested', 'confirmed'].includes(b.status)) {
    await q(`update portal.bookings set ends_at = ends_at + ((snapshot->>'booking_ext_days') || ' days')::interval, extended = true where id = $1`, [id])
  } else if (act === 'cancel' && (mine || canConfirmBooking(c.user.role)) && ['requested', 'confirmed'].includes(b.status)) {
    await q(`update portal.bookings set status = 'cancelled' where id = $1`, [id])
  } else if (act === 'contract' && ['owner', 'market_head', 'seller', 'office'].includes(c.user.role) && b.status === 'confirmed') {
    const sp = b.snapshot?.split || {}
    const seller = await one<{ curator_id: string | null; role: string }>('select curator_id, role from portal.users where id = $1', [b.agent_id])
    await tx(async (t) => {
      await t.query(`update portal.bookings set status = 'converted' where id = $1`, [id])
      await t.query(`insert into portal.deals (booking_id, client_id, unit_id, project_id, agent_id, seller_id, final_price, agent_amount, our_amount, seller_amount) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, b.client_id, b.unit_id, b.project_id, isExternal((seller?.role || 'seller') as any) ? b.agent_id : null, seller?.curator_id || b.agent_id, b.final_price, Math.round(sp.agent || 0), Math.round(sp.ours || 0), Math.round(sp.seller || 0)])
      await t.query(`update portal.clients set stage = 'contract' where id = $1`, [b.client_id])
    })
    await notify(b.agent_id, 'deal', 'Договор подписан — сделка в работе', '/commission')
  }
  await audit(c.real.id, 'booking.' + act, 'booking', id, null, c.impersonating ? c.user.id : null)
  revalidatePath('/bookings')
}

/* ── Подборки ── */
export async function addToSelection(f: FormData) {
  const c = await writeCtx()
  const clientId = s(f, 'client'), unitId = s(f, 'unit')
  await stageGuard(c, clientId)
  let sel = await one<{ id: string }>(`select id from portal.selections where client_id = $1 and user_id = $2 and title <> 'Встреча' order by created_at desc limit 1`, [clientId, c.user.id])
  if (!sel) {
    const cl = await one<{ language: string | null }>('select language from portal.clients where id = $1', [clientId])
    sel = await one<{ id: string }>(`insert into portal.selections (token, client_id, user_id, title, lang) values ($1,$2,$3,'Подборка',$4) returning id`, [crypto.randomBytes(9).toString('base64url'), clientId, c.user.id, ['ru', 'en', 'de', 'he'].includes(cl?.language || '') ? cl!.language : 'en'])
  }
  await q(`insert into portal.selection_items (selection_id, unit_id, sort) values ($1,$2,(select coalesce(max(sort),0)+1 from portal.selection_items where selection_id = $1)) on conflict do nothing`, [sel!.id, unitId])
  await q(`update portal.clients set stage = case when stage in ('lead','contact','qualify','fixation') then 'selection' else stage end, last_activity_at = now() where id = $1`, [clientId])
  redirect(`/selections/${sel!.id}`)
}
export async function selectionUpdate(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'id')
  const sel = await one<{ user_id: string }>('select user_id from portal.selections where id = $1', [id])
  if (!sel || (sel.user_id !== c.user.id && c.user.role !== 'owner')) return
  if (s(f, 'remove')) await q('delete from portal.selection_items where selection_id = $1 and unit_id = $2', [id, s(f, 'remove')])
  if (s(f, 'lang')) await q('update portal.selections set lang = $2 where id = $1', [id, s(f, 'lang')])
  for (const [k, v] of f.entries()) if (k.startsWith('note:')) await q('update portal.selection_items set note = $3 where selection_id = $1 and unit_id = $2', [id, k.slice(5), String(v) || null])
  revalidatePath(`/selections/${id}`)
}
export async function openedSelection(token: string) {
  const r = await one<{ id: string; client_id: string; user_id: string; opened: number }>(`update portal.selections set opened = opened + 1, last_opened_at = now() where token = $1 returning id, client_id, user_id, opened`, [token])
  if (!r) return
  const cl = await one<{ name: string }>('select name from portal.clients where id = $1', [r.client_id])
  await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Клиент открыл подборку (раз: {n})',$2)`, [r.client_id, { n: r.opened }])
  await notify(r.user_id, 'selection', '{c} открыл подборку — хороший момент позвонить', `/clients/${r.client_id}`, { c: cl?.name || '' })
}

/* ── Заявка агента (публичная) и проверка ── */
export async function applyAgent(_: unknown, f: FormData) {
  if (!s(f, 'name') || !s(f, 'email')) return { error: 'Нужны имя и e-mail' }
  if (!f.get('consent')) return { error: 'Нужно согласие с условиями и обработкой данных' }
  const market = ['DE', 'IL', 'GLOBAL'].includes(s(f, 'market')) ? s(f, 'market') : 'DE'
  // Документы к заявке (разрешение маклера, выписка): без входа, поэтому до 3 файлов по 10 МБ, только PDF и фото
  const docs = f.getAll('docs').filter(isFile)
  const DOC = { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'], max: 10 * 1024 * 1024 }
  if (docs.length > 3) return { error: 'Не больше 3 файлов' }
  if (docs.some((d) => !DOC.exts.includes((d.name.split('.').pop() || '').toLowerCase()))) return { error: 'Документы — PDF или фото (JPG, PNG, HEIC)' }
  if (docs.some((d) => d.size > DOC.max)) return { error: 'Файл больше 10 МБ' }
  const app = await one<{ id: string }>(`insert into portal.agent_applications (kind, name, company, email, phone, city, languages, license, volume, channels, market) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [s(f, 'kind') === 'agency' ? 'agency' : 'agent', s(f, 'name'), s(f, 'company') || null, s(f, 'email'), s(f, 'phone'), s(f, 'city'), s(f, 'languages'), s(f, 'license'), s(f, 'volume'), s(f, 'channels'), market])
  for (const d of docs) await q('insert into portal.application_files (application_id, file_id) values ($1,$2)', [app!.id, await storeFile(d, null, DOC)])
  // Владельцу, руководителю и менеджерам рынка заявки (проверку проводит менеджер рынка)
  for (const o of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role in ('market_head','seller') and market = $1))`, [market])) await notify(o.id, 'application', 'Новая заявка: {n}', `/admin/agents/app/${app!.id}`, { n: s(f, 'name') })
  return { ok: true }
}
// Документ к заявке, полученный позже (по почте, у куратора) — добавляет проверяющий
export async function addApplicationFile(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canReviewAgents(c.user.role)) return { error: t(c.lang, 'Нет прав') }
  const a = await one<{ id: string; market: string }>('select id, market from portal.agent_applications where id = $1', [s(f, 'id')])
  if (!a || (c.user.role !== 'owner' && a.market !== c.user.market)) return { error: t(c.lang, 'Нет прав') }
  const file = f.get('file')
  if (!isFile(file)) return { error: t(c.lang, 'Выберите файл') }
  try { await q('insert into portal.application_files (application_id, file_id) values ($1,$2)', [a.id, await storeFile(file, c.user.id)]) } catch (e: any) {
    return { error: t(c.lang, e?.message === 'size' ? 'Файл больше 25 МБ — дайте ссылку на облако' : 'Такой тип файла не поддерживается') }
  }
  await audit(c.real.id, 'application.file', 'application', a.id, null, c.impersonating ? c.user.id : null)
  revalidatePath(`/admin/agents/app/${a.id}`)
  return { ok: true }
}
export async function reviewApplication(f: FormData) {
  const c = await writeCtx()
  if (!canReviewAgents(c.user.role)) return
  const id = s(f, 'id'), status = s(f, 'status')
  if (!['new', 'review', 'contract', 'approved', 'rejected'].includes(status)) return
  // Не владелец разбирает только заявки своего рынка
  await q(`update portal.agent_applications set status = $2, note = coalesce(nullif($3, ''), note), reviewed_by = $4 where id = $1 and ($5 = 'owner' or market = $6)`, [id, status, s(f, 'note'), c.user.id, c.user.role, c.user.market])
  await audit(c.real.id, 'application.' + status, 'application', id)
  revalidatePath('/admin/agents'); revalidatePath(`/admin/agents/app/${id}`)
}

/* ── Условия проекта ── */
export async function saveConditions(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canEditConditions(c.user.role)) return { error: 'Только владелец' }
  const pid = s(f, 'project')
  const n = (k: string) => Number(s(f, k).replace(',', '.'))
  const fields = ['fix_pct', 'pool_pct', 'agent_fix_pct', 'agent_pool_pct', 'agent_our_pool_share', 'seller_share_pct', 'seller_self_disc', 'seller_max_disc', 'booking_days', 'booking_ext_days', 'protect_months', 'max_bookings_client', 'max_bookings_agent', 'max_bookings_total']
  for (const k of fields) if (Number.isNaN(n(k))) return { error: 'Проверьте числа: ' + k }
  if (n('agent_pool_pct') > n('pool_pct')) return { error: 'Часть пула агента больше всего пула' }
  if (n('agent_fix_pct') > n('fix_pct')) return { error: 'Фикс агента больше нашего фикса' }
  const draft = await one<{ id: string }>(`select id from portal.conditions where project_id = $1 and status = 'draft' order by version desc limit 1`, [pid])
  const vals = fields.map(n)
  if (draft) {
    await q(`update portal.conditions set ${fields.map((k, i) => `${k} = $${i + 3}`).join(', ')}, valid_from = $2, pay_timing = $${fields.length + 3}, note = $${fields.length + 4} where id = $1`, [draft.id, s(f, 'valid_from'), ...vals, s(f, 'pay_timing'), s(f, 'note') || null])
  } else {
    const v = await one<{ v: number }>('select coalesce(max(version),0)+1 v from portal.conditions where project_id = $1', [pid])
    await q(`insert into portal.conditions (project_id, version, status, valid_from, ${fields.join(', ')}, pay_timing, note, payment_plans, created_by) values ($1,$2,'draft',$3, ${fields.map((_, i) => '$' + (i + 4)).join(', ')}, $${fields.length + 4}, $${fields.length + 5},
      coalesce((select payment_plans from portal.conditions where project_id = $1 order by version desc limit 1), '[]'), $${fields.length + 6})`, [pid, v!.v, s(f, 'valid_from'), ...vals, s(f, 'pay_timing'), s(f, 'note') || null, c.user.id])
  }
  await audit(c.real.id, 'conditions.save', 'project', pid)
  if (s(f, 'publish')) {
    await q(`update portal.conditions set status = 'published' where project_id = $1 and status = 'draft'`, [pid])
    await audit(c.real.id, 'conditions.publish', 'project', pid)
  }
  revalidatePath('/admin/conditions')
  return { ok: s(f, 'publish') ? 'Опубликовано' : 'Черновик сохранён' }
}

/* ── Пользователи ── */
export async function createUser(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canManageUsers(c.user.role)) return { error: 'Только владелец' }
  const pw = crypto.randomBytes(6).toString('base64url')
  try {
    await q(`insert into portal.users (email, name, password_hash, role, market, locale, agency_id) values ($1,$2,$3,$4,$5,$6,$7)`,
      [s(f, 'email'), s(f, 'name'), bcrypt.hashSync(pw, 10), s(f, 'role'), s(f, 'market') || null, s(f, 'locale') || 'ru', s(f, 'agency') || null])
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  await audit(c.real.id, 'user.create', 'user', s(f, 'email'))
  revalidatePath('/admin/users')
  return { ok: true, password: pw }
}
// Руководитель агентства заводит и отключает своих сотрудников (роль «саб-агент», агентство и рынок — его)
export async function createAgencyAgent(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (c.user.role !== 'agency_head' || !c.user.agency_id) return { error: 'Нет прав' }
  if (!s(f, 'name') || !s(f, 'email')) return { error: 'Нужны имя и e-mail' }
  const pw = crypto.randomBytes(6).toString('base64url')
  try {
    await q(`insert into portal.users (email, name, password_hash, role, market, locale, agency_id, curator_id) values ($1,$2,$3,'agent',$4,$5,$6,$7)`,
      [s(f, 'email').toLowerCase(), s(f, 'name'), bcrypt.hashSync(pw, 10), c.user.market, LANGS.includes(s(f, 'locale') as Lang) ? s(f, 'locale') : c.user.locale, c.user.agency_id, c.user.curator_id])
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  await audit(c.real.id, 'user.create', 'user', s(f, 'email'), { by: 'agency_head' }, c.impersonating ? c.user.id : null)
  revalidatePath('/team')
  return { ok: true, password: pw }
}
export async function toggleAgencyAgent(f: FormData) {
  const c = await writeCtx()
  if (c.user.role !== 'agency_head') return
  await q(`update portal.users set active = not active where id = $1 and agency_id = $2 and role = 'agent'`, [s(f, 'id'), c.user.agency_id])
  await audit(c.real.id, 'user.toggle', 'user', s(f, 'id'), null, c.impersonating ? c.user.id : null)
  revalidatePath('/team')
}
/* ── Пользователи: правка, сброс пароля и PIN, сеансы, отключение с передачей клиентов ── */
type UserRow = { id: string; role: Role; market: string | null; curator_id: string | null; agency_id: string | null; email: string; name: string }
// Владелец правит всех; руководитель рынка — только агентов и руководителей агентств своего рынка (ТЗ, «Агенты и агентства»)
async function editableUser(c: Ctx, id: string) {
  const u = await one<UserRow>('select id, role, market, curator_id, agency_id, email, name from portal.users where id = $1', [id])
  if (!u) return null
  if (c.user.role === 'owner') return u
  if (c.user.role === 'market_head' && ['agent', 'agency_head'].includes(u.role) && u.market === c.user.market) return u
  return null
}
const ROLES_ALL: Role[] = ['owner', 'market_head', 'seller', 'office', 'finance', 'content', 'agency_head', 'agent']
export async function updateUser(_: unknown, f: FormData) {
  const c = await writeCtx()
  const u = await editableUser(c, s(f, 'id'))
  if (!u) return { error: 'Нет прав' }
  const owner = c.user.role === 'owner'
  const role = (owner ? s(f, 'role') : u.role) as Role
  if (!ROLES_ALL.includes(role)) return { error: 'Нет прав' }
  if (u.id === c.real.id && role !== 'owner') return { error: 'Нельзя снять роль владельца с самого себя' }
  const market = owner ? s(f, 'market') || null : u.market
  const email = s(f, 'email').toLowerCase()
  if (!s(f, 'name') || !email) return { error: 'Нужны имя и e-mail' }
  try {
    await q(`update portal.users set name = $2, email = $3, role = $4, market = $5, agency_id = $6, curator_id = $7, locale = $8, license_note = $9, contract_signed_at = $10 where id = $1`,
      [u.id, s(f, 'name'), email, role, market, s(f, 'agency') || null, s(f, 'curator') || null, LANGS.includes(s(f, 'locale') as Lang) ? s(f, 'locale') : 'ru', s(f, 'license') || null, s(f, 'contract') || null])
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  await audit(c.real.id, 'user.update', 'user', u.id, { role, market, from: { role: u.role, market: u.market } }, c.impersonating ? c.user.id : null)
  revalidatePath('/admin/users'); revalidatePath(`/admin/users/${u.id}`); revalidatePath('/admin/agents')
  return { ok: true }
}
export async function resetPassword(_: unknown, f: FormData) {
  const c = await writeCtx()
  const u = await editableUser(c, s(f, 'id'))
  if (!u) return { error: 'Нет прав' }
  const pw = crypto.randomBytes(6).toString('base64url')
  await q('update portal.users set password_hash = $2, session_ver = session_ver + 1 where id = $1', [u.id, bcrypt.hashSync(pw, 10)])
  await audit(c.real.id, 'user.password_reset', 'user', u.id, null, c.impersonating ? c.user.id : null)
  return { ok: true, password: pw }
}
export async function resetPin(_: unknown, f: FormData) {
  const c = await writeCtx()
  const u = await editableUser(c, s(f, 'id'))
  if (!u) return { error: 'Нет прав' }
  const pin = String(crypto.randomInt(1000, 10000))
  await q('update portal.users set pin_hash = $2 where id = $1', [u.id, bcrypt.hashSync(pin, 10)])
  await audit(c.real.id, 'user.pin_reset', 'user', u.id, null, c.impersonating ? c.user.id : null)
  return { ok: true, pin }
}
export async function endSessions(f: FormData) {
  const c = await writeCtx()
  const u = await editableUser(c, s(f, 'id'))
  if (!u) return
  await q('update portal.users set session_ver = session_ver + 1 where id = $1', [u.id])
  await audit(c.real.id, 'user.sessions_end', 'user', u.id, null, c.impersonating ? c.user.id : null)
  revalidatePath(`/admin/users/${u.id}`)
}
// Отключение: доступ закрывается сразу; клиенты в работе и активные брони агента — куратору (ТЗ, «Уход или отключение»)
export async function setUserActive(f: FormData) {
  const c = await writeCtx()
  const u = await editableUser(c, s(f, 'id'))
  if (!u || u.id === c.real.id) return
  const on = s(f, 'active') === '1'
  const to = s(f, 'transfer_to') || null
  await tx(async (t) => {
    await t.query('update portal.users set active = $2, session_ver = session_ver + 1 where id = $1', [u.id, on])
    if (!on && to) {
      const moved = await t.query(`update portal.clients set owner_id = $2, agency_id = null where owner_id = $1 and stage not in ('lost','handed') returning id`, [u.id, to])
      await t.query(`update portal.bookings set agent_id = $2 where agent_id = $1 and status in ('requested','confirmed')`, [u.id, to])
      for (const r of moved.rows) await t.query(`insert into portal.activities (client_id, user_id, kind, text, internal) values ($1,$2,'system','Клиент передан другому владельцу',true)`, [r.id, c.user.id])
    }
  })
  await audit(c.real.id, on ? 'user.enable' : 'user.disable', 'user', u.id, { transfer_to: to }, c.impersonating ? c.user.id : null)
  revalidatePath('/admin/users'); revalidatePath(`/admin/users/${u.id}`); revalidatePath('/admin/agents')
}

/* ── Личный профиль: свой пароль, PIN режима показа, язык ── */
export async function changeOwnPassword(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return { error: 'Только просмотр: действовать от имени пользователя нельзя.' }
  const r = await one<{ password_hash: string }>('select password_hash from portal.users where id = $1', [c.real.id])
  if (!r || !bcrypt.compareSync(s(f, 'current'), r.password_hash)) return { error: 'Текущий пароль неверен' }
  const pw = s(f, 'password')
  if (pw.length < 10) return { error: 'Новый пароль — не короче 10 символов' }
  if (pw !== s(f, 'password2')) return { error: 'Пароли не совпадают' }
  await q('update portal.users set password_hash = $2, session_ver = session_ver + 1 where id = $1', [c.real.id, bcrypt.hashSync(pw, 10)])
  await signSession(c.real.id)
  await audit(c.real.id, 'user.password_change', 'user', c.real.id)
  return { ok: true }
}
export async function changeOwnPin(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return { error: 'Только просмотр: действовать от имени пользователя нельзя.' }
  const r = await one<{ password_hash: string }>('select password_hash from portal.users where id = $1', [c.real.id])
  if (!r || !bcrypt.compareSync(s(f, 'current'), r.password_hash)) return { error: 'Текущий пароль неверен' }
  if (!/^\d{4,6}$/.test(s(f, 'pin'))) return { error: 'PIN — от 4 до 6 цифр' }
  await q('update portal.users set pin_hash = $2 where id = $1', [c.real.id, bcrypt.hashSync(s(f, 'pin'), 10)])
  await audit(c.real.id, 'user.pin_change', 'user', c.real.id)
  return { ok: true }
}
export async function setOwnLocale(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating || !LANGS.includes(s(f, 'locale') as Lang)) return
  await q('update portal.users set locale = $2 where id = $1', [c.real.id, s(f, 'locale')])
  cookies().delete('ge_lang')
  revalidatePath('/', 'layout')
}

/* ── Заявка агента → доступ: агентство (если заявка от агентства), пользователь, куратор, временный пароль ── */
export async function createFromApplication(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) return { error: 'Нет прав' }
  const a = await one<{ id: string; kind: string; name: string; company: string | null; email: string; market: string; license: string | null; user_id: string | null; status: string }>('select * from portal.agent_applications where id = $1', [s(f, 'id')])
  if (!a || a.user_id) return { error: 'Доступ уже создан' }
  if (c.user.role === 'market_head' && a.market !== c.user.market) return { error: 'Нет прав' }
  const pw = crypto.randomBytes(6).toString('base64url')
  const pin = String(crypto.randomInt(1000, 10000))
  try {
    const uid = await tx(async (t) => {
      let agency: string | null = null
      if (a.kind === 'agency') agency = (await t.query(`insert into portal.agencies (name, market) values ($1,$2) returning id`, [a.company || a.name, a.market])).rows[0].id
      const u = await t.query(`insert into portal.users (email, name, password_hash, pin_hash, role, market, locale, agency_id, curator_id, license_note, contract_signed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [a.email.toLowerCase(), a.name, bcrypt.hashSync(pw, 10), bcrypt.hashSync(pin, 10), a.kind === 'agency' ? 'agency_head' : 'agent', a.market, a.market === 'IL' ? 'he' : 'de', agency, s(f, 'curator') || null, a.license, s(f, 'contract') || null])
      await t.query(`update portal.agent_applications set status = 'approved', user_id = $2, reviewed_by = $3 where id = $1`, [a.id, u.rows[0].id, c.user.id])
      return u.rows[0].id as string
    })
    await audit(c.real.id, 'application.access', 'user', uid, { application: a.id }, c.impersonating ? c.user.id : null)
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  // Без revalidatePath: иначе строка заявки перерисуется и одноразовый пароль исчезнет с экрана
  return { ok: true, password: pw, pin, email: a.email }
}

/* ── Исключения по ставкам агентов и агентств ── */
export async function saveAgentRate(f: FormData) {
  const c = await writeCtx()
  if (!canEditConditions(c.user.role)) return
  if (s(f, 'delete')) {
    await q('delete from portal.agent_rates where id = $1', [s(f, 'delete')])
  } else {
    const [kind, id] = s(f, 'who').split(':')
    const fix = Number(s(f, 'fix')), pool = Number(s(f, 'pool'))
    if (!id || Number.isNaN(fix) || Number.isNaN(pool)) return
    await q(`insert into portal.agent_rates (project_id, agent_id, agency_id, market, agent_fix_pct, agent_pool_pct, note) values ($1,$2,$3,$4,$5,$6,$7)`,
      [s(f, 'project'), kind === 'user' ? id : null, kind === 'agency' ? id : null, kind === 'market' ? id : null, fix, pool, s(f, 'note') || null])
  }
  await audit(c.real.id, 'conditions.rate', 'project', s(f, 'project'), { who: s(f, 'who'), del: s(f, 'delete') || undefined }, c.impersonating ? c.user.id : null)
  revalidatePath('/admin/conditions')
}

/* ── Контакты клиента: правка с проверкой дубля ── */
export async function updateClientContacts(_: unknown, f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client')
  await stageGuard(c, id)
  const name = s(f, 'name'), phone = s(f, 'phone'), email = s(f, 'email')
  if (!name || (!phone && !email)) return { error: 'Нужны имя и телефон или e-mail' }
  const pn = norm.phone(phone), em = norm.email(email)
  const dup = await one(`select 1 from portal.clients where id <> $3 and ((length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or (email_norm <> '' and email_norm = $2)) limit 1`, [pn, em, id])
  if (dup) return { error: 'Этот телефон или e-mail уже есть у другого клиента' }
  await q(`update portal.clients set name = $2, phone = $3, phone_norm = $4, email = $5, email_norm = $6, country = $7, language = $8 where id = $1`, [id, name, phone, pn, email, em, s(f, 'country') || null, s(f, 'language') || null])
  await audit(c.real.id, 'client.contacts', 'client', id, null, c.impersonating ? c.user.id : null)
  revalidatePath(`/clients/${id}`)
  return { ok: true }
}

/* ── Финансы: доля оплаченного клиентом ── */
export async function dealPaid(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'finance'].includes(c.user.role)) return
  const v = Math.max(0, Math.min(100, Number(s(f, 'paid'))))
  if (Number.isNaN(v)) return
  await q('update portal.deals set paid_pct = $2 where id = $1', [s(f, 'id'), v])
  await audit(c.real.id, 'deal.paid', 'deal', s(f, 'id'), { paid_pct: v }, c.impersonating ? c.user.id : null)
  revalidatePath('/finance')
}

/* ── Тур в Баку: заявка офису (даты, язык, сколько человек) ── */
export async function requestTour(_: unknown, f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client')
  const cl = await stageGuard(c, id)
  const from = s(f, 'from'), to = s(f, 'to'), people = Number(s(f, 'people')) || 1
  if (!from || from < new Date().toISOString().slice(0, 10)) return { error: t(c.lang, 'Укажите даты тура в будущем') }
  const vars = { c: cl.name, d: from + (to ? ' — ' + to : ''), n: people, l: (s(f, 'lang') || 'de').toUpperCase(), note: s(f, 'note') }
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'meeting','Заявка на тур в Баку: {d}, {n} чел., язык {l}',$3)`, [id, c.user.id, vars])
  for (const o of await q<{ id: string }>(`select id from portal.users where role = 'office' and active`)) {
    await notify(o.id, 'tour', 'Заявка на тур в Баку: {c}, {d}, {n} чел.', `/clients/${id}`, vars)
    await q(`insert into portal.tasks (client_id, user_id, title, vars, due, auto) values ($1,$2,'Тур в Баку: {c}, {d}, {n} чел., язык {l}',$3,$4,true)`, [id, o.id, vars, from])
  }
  await q(`update portal.clients set stage = case when stage in ('lead','contact','qualify','selection','fixation') then 'viewing' else stage end, last_activity_at = now() where id = $1`, [id])
  await audit(c.real.id, 'client.tour', 'client', id, vars, c.impersonating ? c.user.id : null)
  revalidatePath(`/clients/${id}`)
  return { ok: true }
}

/* ── Документы клиента: паспорт для KYC, бронь, договор, платёжки ── */
export async function uploadClientDoc(_: unknown, f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client')
  await stageGuard(c, id)
  const file = f.get('file')
  if (!isFile(file)) return { error: t(c.lang, 'Выберите файл') }
  let fileId: string
  try { fileId = await storeFile(file, c.user.id) } catch (e: any) {
    return { error: t(c.lang, e?.message === 'size' ? 'Файл больше 25 МБ — дайте ссылку на облако' : 'Такой тип файла не поддерживается') }
  }
  const kind = ['passport', 'kyc', 'booking', 'contract', 'payment', 'other'].includes(s(f, 'kind')) ? s(f, 'kind') : 'other'
  const internal = !isExternal(c.user.role) && !!f.get('internal')
  await q(`insert into portal.client_documents (client_id, file_id, kind, note, internal, created_by) values ($1,$2,$3,$4,$5,$6)`, [id, fileId, kind, s(f, 'note') || null, internal, c.user.id])
  await q(`insert into portal.activities (client_id, user_id, kind, text, internal, vars) values ($1,$2,'system','Загружен документ: {k}',$3,$4)`, [id, c.user.id, internal, { k: kind }])
  await audit(c.real.id, 'client.document', 'client', id, { kind }, c.impersonating ? c.user.id : null)
  revalidatePath(`/clients/${id}`)
  return { ok: true }
}
export async function deleteClientDoc(f: FormData) {
  const c = await writeCtx()
  const d = await one<{ client_id: string; file_id: string; created_by: string }>('select client_id, file_id, created_by from portal.client_documents where id = $1', [s(f, 'id')])
  if (!d) return
  await stageGuard(c, d.client_id)
  if (isExternal(c.user.role) && d.created_by !== c.user.id) return
  await q('delete from portal.files where id = $1', [d.file_id])
  await audit(c.real.id, 'client.document_delete', 'client', d.client_id, null, c.impersonating ? c.user.id : null)
  revalidatePath(`/clients/${d.client_id}`)
}

export async function toggleUser(f: FormData) {
  const c = await writeCtx()
  if (!canManageUsers(c.user.role)) return
  await q('update portal.users set active = not active where id = $1 and id <> $2', [s(f, 'id'), c.real.id])
  await audit(c.real.id, 'user.toggle', 'user', s(f, 'id'))
  revalidatePath('/admin/users')
}

/* ── Уведомления, финансы ── */
export async function readAll() {
  const c = await writeCtx()
  await q('update portal.notifications set read = true where user_id = $1', [c.user.id])
  revalidatePath('/', 'layout')
}
export async function dealStage(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'finance'].includes(c.user.role)) return
  const st = s(f, 'stage')
  await q(`update portal.deals set stage = $2, paid_pct = case when $2 in ('fee_received','paid_out') then 100 else paid_pct end, paid_out_at = case when $2 = 'paid_out' then current_date else paid_out_at end where id = $1`, [s(f, 'id'), st])
  const d = await one<{ agent_id: string | null }>('select agent_id from portal.deals where id = $1', [s(f, 'id')])
  if (d?.agent_id && st === 'paid_out') await notify(d.agent_id, 'payout', 'Комиссия выплачена', '/commission')
  await audit(c.real.id, 'deal.' + st, 'deal', s(f, 'id'))
  revalidatePath('/finance')
}
