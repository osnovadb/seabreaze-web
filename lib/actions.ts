'use server'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { q, one, tx, audit, notify, withKeyLock, personKeys } from './db'
import { getCtx, requireCtx, signSession, clearSession, setShow, clearShow, Ctx } from './auth'
import { canBook, canConfirmBooking, canEditConditions, canManageUsers, canRegisterClient, canReviewAgents, isExternal, maxDiscount, discountCeiling, canApproveDiscount, type Role } from './perm'
import { conditionsFor, marketOverflow, split, downGridFor, unitById, unitsByIds, projectVisible, plansFor, unitNo, codeFor, viewMode } from './catalog'
import { priceChain, isFull } from './plans'
import { planPool, activeGrid } from './calc'
import { planCond } from './money'
import { optionsFor } from './options'
import { toUsd } from './fx'
import { pbEnqueue } from './pbQueue'
import { issueLink, mailLink, tokenUser, loginBlocked, noteLogin, clientIp, mailOn } from './access'
import { promoForUnit } from './promo'
import { storeFile, isFile } from './files'
import { LANGS, t, bakuYear, type Lang } from './i18n'
import { stageBlock, LOST_REASONS, B24_LOST } from './stages'
import { canReviewKyc, kycMissing, type KycFields, type Buyer } from './kyc'
import { autoPost } from './posts'
import { syncAct } from './acts'
import { readXlsx } from './xlsx'
import { pushDeal, queueSync, queueApp, queueTask } from './b24sync'
import { grantAccess, invite, noPassword } from './partnerAccess'
import { computeShares, buildTranches } from './money22'
import { requestConsent } from './consent'
import { priceNegotiation } from './dict'
import { MAX_SEL_VARIANTS } from './selVariants'
import { formTokenOk } from './formGuard'

// Вход «от имени» по ТЗ — только чтение; на тестовом стенде запись разрешена флагом ALLOW_IMPERSONATE_WRITE=1
async function writeCtx() {
  const c = await requireCtx()
  if (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1') throw new Error('read-only: impersonation')
  return c
}
const FEE_ROLES: Role[] = ['owner', 'office', 'finance']
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
// Язык клиента — код ru/en/de/he (из импорта приходит «Deutsch», «English»…); неизвестное — пусто
const LANG_NAMES: Record<string, string> = { ru: 'ru', русский: 'ru', russian: 'ru', russisch: 'ru', en: 'en', english: 'en', английский: 'en', englisch: 'en', de: 'de', deutsch: 'de', german: 'de', немецкий: 'de', he: 'he', hebrew: 'he', иврит: 'he', hebräisch: 'he', 'עברית': 'he' }
const langCode = (v: string) => LANG_NAMES[v.trim().toLowerCase()] || ''
// Телефон: только цифры, без международного префикса 00; дубль ищем по последним 9 цифрам (+49 160…, 0049-160…, 0160…)
const norm = { phone: (p: string) => p.replace(/\D/g, '').replace(/^00/, ''), email: (e: string) => e.trim().toLowerCase() }
const back = (path: string, params: Record<string, string>) => redirect(path + (path.includes('?') ? '&' : '?') + new URLSearchParams(params).toString())

/* ── Вход, язык, «войти как» ── */
export async function login(_: unknown, f: FormData) {
  const email = s(f, 'email').toLowerCase(), ip = clientIp()
  // Подбор пароля: после 5 неудач по e-mail (или 20 с адреса) за 15 минут — пауза, даже при верном пароле
  if (await loginBlocked(email, ip)) return { error: 'Слишком много попыток входа — подождите 15 минут или восстановите пароль' }
  const u = await one<{ id: string; password_hash: string; active: boolean; password_set: boolean }>('select id, password_hash, active, password_set from portal.users where lower(email) = $1', [email])
  if (!u || !u.active || !u.password_set || !bcrypt.compareSync(s(f, 'password'), u.password_hash)) {
    await noteLogin(email, ip, false); if (u) await audit(u.id, 'login.fail')
    return { error: 'Неверный e-mail или пароль' }
  }
  await noteLogin(email, ip, true)
  await signSession(u.id)
  await deviceCheck(u.id, ip) // 358: уведомление о входе с нового устройства
  await q('update portal.users set prev_login_at = last_login_at, last_login_at = now() where id = $1', [u.id])
  await audit(u.id, 'login')
  redirect('/')
}
// 358 (11.11): вход с нового устройства — письмо на адрес пользователя и уведомление в портале; первое устройство — без письма
async function deviceCheck(userId: string, ip: string) {
  const jar = await cookies()
  let dev = jar.get('ge_dev')?.value || ''
  if (!/^[0-9a-f]{32}$/.test(dev)) { dev = crypto.randomBytes(16).toString('hex'); jar.set('ge_dev', dev, { path: '/', maxAge: 5 * 365 * 86400, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }) }
  const ua = ((await headers()).get('user-agent') || '').slice(0, 300)
  const known = await one<{ n: number; me: boolean }>('select count(*)::int n, bool_or(device_id = $2) me from portal.user_devices where user_id = $1', [userId, dev])
  await q(`insert into portal.user_devices (user_id, device_id, ua, ip) values ($1,$2,$3,$4) on conflict (user_id, device_id) do update set last_at = now(), ip = excluded.ip`, [userId, dev, ua, ip || null])
  if (!known?.n || known.me) return
  const u = await one<{ email: string; name: string; locale: Lang }>('select email, name, locale from portal.users where id = $1', [userId])
  if (!u) return
  const L = (LANGS.includes(u.locale) ? u.locale : 'en') as Lang
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  await q(`insert into portal.outbox_messages (channel, to_addr, user_id, subject, body, kind) values ('email',$1,$2,$3,$4,'new_device')`, [u.email, userId, 'GetsEstate · ' + t(L, 'Вход с нового устройства'),
    [t(L, 'Здравствуйте, {n}!', { n: u.name }), t(L, 'В ваш кабинет GetsEstate вошли с нового устройства: {w}, {d}.', { w: when, d: ua.slice(0, 120) || '—' }), t(L, 'Если это были не вы — смените пароль и напишите вашему куратору.')].join('\n\n')])
  await notify(userId, 'security', 'Вход с нового устройства: {d}', '/profile', { d: when })
  await audit(userId, 'login.new_device', 'user', userId, { ip })
}
export async function logout() { await clearSession(); redirect('/login') }
export async function setLang(lang: Lang) {
  ;(await cookies()).set('ge_lang', lang, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' })
  const c = await getCtx()
  if (c && !c.impersonating) await q('update portal.users set locale = $1 where id = $2', [lang, c.user.id])
  revalidatePath('/', 'layout')
}
export async function impersonate(f: FormData) {
  const c = await requireCtx()
  if (c.real.role !== 'owner') return
  const id = s(f, 'user')
  await signSession(c.real.id, id && id !== c.real.id ? id : undefined)
  ;(await cookies()).delete('ge_lang')
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
    if (fails!.n >= 5) { await clearShow(); await clearSession(); redirect('/login') }
    return { error: 'Неверный PIN' }
  }
  if (c.show?.clientId) {
    // Отмеченные на этой встрече квартиры (подборка «Встреча» за последние 4 часа — срок режима показа)
    const liked = await q<{ unit: string }>(`select portal.unit_no(bl.external_id, u.number) unit from portal.selection_items si join portal.selections se on se.id = si.selection_id
      join units u on u.id = si.unit_id join buildings bl on bl.id = u.building_id where se.client_id = $1 and se.title = 'Встреча' and si.liked and si.created_at > now() - interval '4 hours' order by si.created_at`, [c.show.clientId])
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'meeting','Встреча в режиме показа · отмечено квартир: {n}',$3)`, [c.show.clientId, c.user.id, { n: liked.length + (liked.length ? ' (' + liked.map((x) => x.unit).join(', ') + ')' : '') }])
  }
  await clearShow()
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
// Заявка партнёра (или его агентства) — пересчитать стадию First client / Active в Bitrix24
async function partnerProgress(userId: string) {
  const a = await one<{ id: string }>(`select a.id from portal.agent_applications a join portal.users u on u.id = a.user_id
    where a.user_id = $1 or (u.agency_id is not null and u.agency_id = (select agency_id from portal.users where id = $1)) order by (a.user_id = $1) desc limit 1`, [userId])
  if (a) await queueApp(a.id)
}
async function stageGuard(c: Ctx, clientId: string) {
  const cl = await one<{ id: string; owner_id: string; agency_id: string | null; name: string }>('select id, owner_id, agency_id, name from portal.clients where id = $1', [clientId])
  if (!cl) throw new Error('client')
  const u = c.user
  const ok = u.role === 'owner' || u.role === 'market_head' || (u.role === 'office' || u.role === 'finance') || cl.owner_id === u.id || (u.role === 'agency_head' && cl.agency_id === u.agency_id)
    || (u.role === 'seller' && (await one('select 1 from portal.users where id = $1 and curator_id = $2', [cl.owner_id, u.id])))
  if (!ok) throw new Error('forbidden')
  return cl
}

/* ── Закрепление (§10) ── */
// Кандидат партнёра квалифицирован (цель, бюджет, срок, страна, язык — 245): закрепление на 6 месяцев, регистрации у застройщиков,
// соперник-кандидат другого партнёра закрывается как Duplicate
async function qualifyIfReady(by: string, id: string) {
  const cl = await one<{ attach_status: string; goal: string | null; budget: string | null; timeline: string | null; country: string | null; language: string | null; candidate_until: string | null; name: string }>(
    `select attach_status, goal, budget, timeline, country, language, candidate_until::text, name from portal.clients where id = $1`, [id])
  if (!cl || cl.attach_status !== 'candidate') return false
  if (![cl.goal, cl.budget, cl.timeline, cl.country, cl.language].every(Boolean)) return false
  const won = await one<{ id: string; until: string }>(`update portal.clients set attach_status = 'protected', attached_at = now(), protected_until = current_date + interval '6 months', candidate_until = null
    where id = $1 and attach_status = 'candidate' returning id, protected_until::text until`, [id])
  if (!won) return false
  // все остальные кандидаты с тем же человеком — Duplicate (партнёр видит «уже закреплён» без имени владельца)
  const rivals = await q<{ id: string; owner_id: string }>(`update portal.clients set attach_status = 'junk', lost_reason = 'duplicate'
    where attach_status = 'candidate' and id <> $1 and (other_claimant_of = $1 or id = (select other_claimant_of from portal.clients where id = $1)
      or other_claimant_of = (select other_claimant_of from portal.clients where id = $1)) returning id, owner_id`, [id])
  for (const r of rivals) await notify(r.owner_id, 'client', 'Кандидат уже закреплён за другим партнёром — карточка закрыта', `/clients/${r.id}`, {})
  await queueSync(rivals.map((r) => r.id)) // §13: лиды соперников — Duplicate
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Клиент квалифицирован и закреплён до {d}',$3)`, [id, by, { d: won.until }])
  await q('select portal.enqueue_registrations($1, null, false, $2)', [id, by])
  await audit(by, 'client.qualified', 'client', id, { rivals: rivals.length })
  await pushDeal(id, `клиент квалифицирован и закреплён до ${won.until}`) // §13 п.5: контакт, сделка в Partner clients, задача на регистрацию
  // §6 П10: новый квалифицированный клиент возвращает партнёра (и его агентство) из Inactive в Active
  const own = await one<{ owner_id: string }>('select owner_id from portal.clients where id = $1', [id])
  if (own) {
    await q(`update portal.users set partner_status = 'active', partner_status_at = now() where partner_status = 'inactive'
      and (id = $1 or (agency_id is not null and agency_id = (select agency_id from portal.users where id = $1) and role = 'agency_head'))`, [own.owner_id])
    await partnerProgress(own.owner_id)
  }
  return true
}

// QA 09.11: проверка «чей клиент» и создание — под блокировкой по телефону и e-mail (два одновременных запроса давали двух клиентов)
export async function registerClient(_: unknown, f: FormData) {
  return withKeyLock(personKeys(norm.phone(s(f, 'phone')), norm.email(s(f, 'email'))), () => registerClientLocked(f))
}
async function registerClientLocked(f: FormData) {
  const c = await writeCtx()
  if (!canRegisterClient(c.user.role)) return { error: 'Нет прав на регистрацию клиента' }
  const name = s(f, 'name'), phone = s(f, 'phone'), email = s(f, 'email')
  if (!name || (!phone && !email)) return { error: 'Нужны имя и телефон или e-mail' }
  if (!f.get('consent')) return { error: 'Без согласия клиента регистрация невозможна' }
  const pn = norm.phone(phone), em = norm.email(email)
  const ext = isExternal(c.user.role)
  const dup = await one<{ id: string; owner_id: string; attach_status: string; owner_type: string; market: string | null }>(`select id, owner_id, attach_status, owner_type, market from portal.clients
    where ((length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or (email_norm <> '' and email_norm = $2)) and attach_status <> 'junk'
    order by (attach_status = 'candidate'), created_at limit 1`, [pn, em])
  // §10: два партнёра с одним кандидатом — оба кандидаты, выигрывает первый квалифицировавший; партнёры друг друга не видят
  const rival = dup && ext && dup.attach_status === 'candidate' && dup.owner_type === 'partner' && dup.owner_id !== c.user.id ? dup.id : null
  if (dup && !rival && !ext && dup.attach_status === 'candidate' && dup.owner_type === 'partner') {
    // Команда касается кандидата партнёра: уведомление менеджеру по партнёрам, партнёру — приоритет 14 дней
    for (const m of await q<{ id: string }>(`select id from portal.users where active and role = 'market_head' and (market = $1 or $1 is null)`, [dup.market]))
      await notify(m.id, 'client', 'Команда заводит кандидата партнёра — у партнёра приоритет 14 дней', `/clients/${dup.id}`, {})
  }
  if (dup && !rival) {
    await audit(c.real.id, 'client.duplicate', 'client', dup.id, { tried_by: c.user.id }, c.impersonating ? c.user.id : null)
    // Возвращаем только то, что ввёл сам пользователь, — для кнопки «Запросить проверку»; владельца не раскрываем
    return { duplicate: true, tried: { name, phone, email } }
  }
  // §10: клиент команды закрепляется сразу на 6 месяцев; клиент партнёра — кандидат на 14 дней без защиты, закрепление — после квалификации
  const months = 6
  // номер — из последовательности (v2): count(*) давал одинаковые номера при одновременной регистрации
  const n = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
  const reg = `R-${bakuYear()}-${String(n!.n).padStart(4, '0')}`
  const r = await one<{ id: string; protected_until: string | null; candidate_until: string | null }>(`insert into portal.clients (reg_no, owner_id, agency_id, name, phone, phone_norm, email, email_norm, country, language, market, consent_at, source, goal, budget, timeline, payment, interest, stage,
      owner_type, attach_status, protected_until, candidate_until, attached_at, other_claimant_of, segment)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, null, $12,$13,$14,$15,$16,$17,'lead',
      $19, $20, case when $20 = 'protected' then current_date + ($18 || ' months')::interval end, case when $20 = 'candidate' then current_date + 14 end,
      case when $20 = 'protected' then now() end, $21, $22) returning id, protected_until::text, candidate_until::text`,
    [reg, c.user.id, c.user.agency_id, name, phone, pn, email, em, s(f, 'country'), langCode(s(f, 'language')), c.user.market, ext ? 'agent' : s(f, 'source') || 'office', s(f, 'goal') || null, s(f, 'budget') || null, s(f, 'timeline') || null, s(f, 'payment') || null, s(f, 'interest') || null, months,
      ext ? 'partner' : 'team', ext ? 'candidate' : 'protected', rival, s(f, 'segment') || null])
  if (ext) await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Кандидат заведён ({r}): квалифицируйте до {d}, тогда клиент закрепится за вами',$3)`, [r!.id, c.user.id, { r: reg, d: r!.candidate_until! }])
  else {
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Клиент зарегистрирован ({r}), закреплён до {d}',$3)`, [r!.id, c.user.id, { r: reg, d: r!.protected_until! }])
    await q('select portal.enqueue_registrations($1, null, false, $2)', [r!.id, c.user.id]) // §7: клиента команды — в очередь регистрации у всех застройщиков
  }
  // §15: согласиться за клиента нельзя — галочка в форме лишь подтверждает, что клиент в курсе; клиенту уходит ссылка (письмо, WhatsApp — кнопкой в карточке)
  await q(`insert into portal.consents (client_id, kind, granted, source, by_user) values ($1, 'partner_confirm', true, $2, $3)`, [r!.id, ext ? 'partner' : 'office', c.user.id])
  await requestConsent(r!.id, c.user.id)
  if (c.user.curator_id) await notify(c.user.curator_id, 'client', 'Новый клиент агента {a}: {c}', `/clients/${r!.id}`, { a: c.user.name, c: name })
  await audit(c.real.id, 'client.register', 'client', r!.id, { reg }, c.impersonating ? c.user.id : null)
  await pushDeal(r!.id, ext ? `кандидат от партнёра ${c.user.name} (${reg})` : `клиент заведён в портале (${reg})`) // §13 п.4
  if (ext) await partnerProgress(c.user.id) // §13 п.20: First client
  // QA 09.11: партнёр заполнил всю квалификацию прямо в форме — закрепляем сразу, а не ждём повторного «Сохранить» в карточке
  if (ext && (await qualifyIfReady(c.user.id, r!.id))) {
    const u2 = await one<{ until: string }>('select protected_until::text until from portal.clients where id = $1', [r!.id])
    return { ok: true, id: r!.id, reg, until: u2!.until, candidate: false }
  }
  return { ok: true, id: r!.id, reg, until: (r!.protected_until || r!.candidate_until)!, candidate: ext }
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
    await pushDeal(dup.id, 'открыт спор «чей клиент» — выплата спорной доли заморожена до решения')
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
  await pushDeal(d.client_id, act === 'transferred' ? 'спор решён: клиент передан другому владельцу' : 'спор решён: клиент остаётся за первым владельцем')
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
    if (!extra?.reason || ![...LOST_REASONS, ...B24_LOST].includes(extra.reason)) return { error: t(c.lang, 'Выберите причину отказа') }
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
  // §13 п.16: партнёр двинул раннюю стадию или просит отказ — запись в ленту или задача офису
  if (isExternal(c.user.role)) {
    if (target === 'lost') await queueTask(clientId, `Partner requests Lost · ${cl.name}`, `Партнёр ${c.user.name} просит закрыть сделку: ${extra?.reason || '—'}`, 'market_head')
    else await pushDeal(clientId, target === 'pause' ? `партнёр поставил паузу до ${extra?.until}` : `партнёр: стадия ${target}`)
  }
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
    if (!internal) await pushDeal(id, `комментарий ${c.user.name}: ${text.slice(0, 900)}`) // §13 п.17: карточка портала → лента сделки
  }
  revalidatePath(`/clients/${id}`)
}
export async function saveQualification(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client')
  await stageGuard(c, id)
  await q(`update portal.clients set goal = $2, budget = $3, timeline = $4, payment = $5, interest = $6, country = coalesce(nullif($7, ''), country), language = coalesce(nullif($8, ''), language),
    segment = coalesce(nullif($9, ''), segment), last_activity_at = now() where id = $1`, [id, s(f, 'goal'), s(f, 'budget'), s(f, 'timeline'), s(f, 'payment'), s(f, 'interest'), s(f, 'country'), langCode(s(f, 'language')), s(f, 'segment')])
  if (!(await qualifyIfReady(c.user.id, id))) await q('select portal.enqueue_registrations($1, null, false, $2)', [id, c.user.id]) // страна стала известна — к застройщикам без продаж в АЗ
  await pushDeal(id) // сегмент и регистрации — в контакт и сделку
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
// KYC (v2): анкета и документы ведёт тот, кто ведёт клиента; отправка на проверку — когда всё собрано;
// решение — офис в Баку или владелец. Пройденный KYC нужен для отметки «Договор подписан».
export async function saveKycData(f: FormData) {
  const c = await writeCtx()
  const cl = await stageGuard(c, s(f, 'client'))
  const cur = await one<{ kyc_status: string }>('select kyc_status from portal.clients where id = $1', [cl.id])
  // на проверке анкету не меняет никто; пройденную — только проверяющий
  if (cur?.kyc_status === 'pending' || (cur?.kyc_status === 'passed' && !canReviewKyc(c.user.role))) return
  const pep = s(f, 'pep') === 'yes' ? true : s(f, 'pep') === 'no' ? false : null
  await q('update portal.clients set kyc_citizenship = $2, kyc_tax_residence = $3, kyc_pep = $4 where id = $1', [cl.id, s(f, 'citizenship').slice(0, 60) || null, s(f, 'tax_residence').slice(0, 60) || null, pep])
  revalidatePath(`/clients/${cl.id}`); revalidatePath('/', 'layout') // бейдж KYC и счётчики — сразу, без F5
}
export async function submitKyc(f: FormData) {
  const c = await writeCtx()
  const cl = await stageGuard(c, s(f, 'client'))
  const row = await one<KycFields & { kyc_status: string }>('select kyc_status, kyc_citizenship, kyc_tax_residence, kyc_pep from portal.clients where id = $1', [cl.id])
  if (!row || !['none', 'rejected'].includes(row.kyc_status)) return
  const kinds = await q<{ kind: string; buyer_id: string | null }>('select distinct kind, buyer_id from portal.client_documents where client_id = $1', [cl.id])
  const buyers = await q<Buyer>('select id, kind, name, citizenship, tax_residence, pep, reg_no, ubo from portal.buyers where client_id = $1', [cl.id])
  if (kycMissing(kinds, row, buyers).length) return
  await q(`update portal.clients set kyc_status = 'pending', kyc_submitted_at = now(), kyc_note = null where id = $1`, [cl.id])
  await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'system','KYC отправлен на проверку')`, [cl.id, c.user.id])
  for (const o of await q<{ id: string }>(`select id from portal.users where role = 'office' and active`)) await notify(o.id, 'kyc', 'KYC {c} ждёт проверки', `/clients/${cl.id}`, { c: cl.name })
  await audit(c.real.id, 'client.kyc_submit', 'client', cl.id, null, c.impersonating ? c.user.id : null)
  await pushDeal(cl.id, 'KYC отправлен на проверку') // §13 п.10
  revalidatePath(`/clients/${cl.id}`)
}
export async function reviewKyc(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client'), decision = s(f, 'decision')
  if (!canReviewKyc(c.user.role) || !['passed', 'rejected', 'none', 'compliance'].includes(decision)) return
  const cl = await one<{ owner_id: string; name: string; kyc_status: string }>('select owner_id, name, kyc_status from portal.clients where id = $1', [id])
  if (!cl) return
  if ((decision === 'rejected' || decision === 'compliance') && !s(f, 'note')) return
  // решение — только по отправленному KYC; сброс — только после решения; своему клиенту KYC не проходит никто
  if ((decision === 'passed' || decision === 'rejected' || decision === 'compliance') && cl.kyc_status !== 'pending') return
  if (decision === 'none' && !['passed', 'rejected'].includes(cl.kyc_status)) return
  if (decision !== 'none' && cl.owner_id === c.user.id) return
  await q(`update portal.clients set kyc_status = $2, kyc_note = $3, kyc_checked_by = $4, kyc_checked_at = now() where id = $1`, [id, decision, s(f, 'note').slice(0, 500) || null, c.user.id])
  // §5 П4: окончательный отказ по проверке — Lost «Compliance», брони снимаются, клиент исключается из маркетинга; партнёр видит только «отказ по проверке»
  if (decision === 'compliance') {
    await q(`update portal.bookings set status = case when status = 'confirmed' then 'release_pending' else 'cancelled' end where client_id = $1 and status in ('hold','queued','requested','confirmed')`, [id])
    await q(`update portal.clients set marketing_consent_at = null, stage = 'lost', lost_reason = 'Compliance' where id = $1`, [id])
  }
  const text = decision === 'passed' ? 'KYC пройден' : decision === 'rejected' ? 'KYC отклонён: {r}' : decision === 'compliance' ? 'Отказ по проверке (Compliance)' : 'KYC сброшен — нужна повторная проверка'
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system',$3,$4)`, [id, c.user.id, text, { r: s(f, 'note') }])
  if (cl.owner_id !== c.user.id) await notify(cl.owner_id, 'kyc', decision === 'passed' ? 'KYC {c} пройден' : decision === 'rejected' ? 'KYC {c} отклонён — посмотрите причину' : decision === 'compliance' ? 'Клиент {c}: отказ по проверке' : 'KYC {c} нужно пройти заново', `/clients/${id}`, { c: cl.name })
  await audit(c.real.id, 'client.kyc_' + decision, 'client', id, { note: s(f, 'note') || null }, c.impersonating ? c.user.id : null)
  await pushDeal(id, decision === 'passed' ? 'KYC пройден' : decision === 'rejected' ? `KYC отклонён: ${s(f, 'note').slice(0, 300)}` : decision === 'compliance' ? 'отказ по проверке (Compliance) — сделка закрыта как Lost, брони сняты' : 'KYC сброшен — нужна повторная проверка')
  revalidatePath(`/clients/${id}`)
  revalidatePath('/kyc'); revalidatePath('/', 'layout')
}
export async function fixation(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'client'), pid = s(f, 'project'), act = s(f, 'act')
  if (act === 'send') {
    await stageGuard(c, id)
    await q(`insert into portal.fixations (client_id, project_id) values ($1,$2) on conflict do nothing`, [id, pid])
    await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'system','Отправлено на фиксацию у застройщика')`, [id, c.user.id])
  } else if (['owner', 'market_head', 'seller', 'office', 'finance'].includes(c.user.role) && ['approved', 'rejected'].includes(act)) {
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
/* ── Холд 24 часа (§7 п.1) ── */
export async function holdUnit(f: FormData) {
  const c = await writeCtx()
  if (!canBook(c.user.role)) return
  const unit = await unitById(s(f, 'unit'))
  const clientId = s(f, 'client')
  if (!unit || !clientId) return
  await stageGuard(c, clientId)
  const err = (m: string) => back(`/units/${unit.id}`, { err: t(c.lang, m) })
  if (unit.status !== 'available' || unit.price == null || unit.booking_id || unit.deal_id) return err('Квартира уже придержана или в брони')
  if (unit.hidden && isExternal(c.user.role)) return err('Квартира уже недоступна')
  // повторно тот же человек — не раньше чем через 24 часа после прошлого холда; до этого — только запрос брони
  if (await one(`select 1 from portal.bookings where unit_id = $1 and agent_id = $2 and snapshot->>'kind' = 'hold' and ends_at > now() - interval '24 hours'`, [unit.id, c.user.id]))
    return err('Повторно придержать можно через 24 часа после прошлого холда — сейчас только запрос брони')
  // одна активная бронь на квартиру — уникальный индекс; одновременный второй холд получает понятный отказ
  const b = await one<{ id: string }>(`insert into portal.bookings (unit_id, project_id, client_id, agent_id, price_list, discount_pct, final_price, snapshot, ends_at, status)
    values ($1,$2,$3,$4,$5,0,$5,'{"kind":"hold"}', now() + interval '24 hours', 'hold') returning id`, [unit.id, unit.project_id, clientId, c.user.id, Math.round(unit.usd || 0)])
    .catch((e) => { if ((e as { code?: string }).code === '23505') return null; throw e })
  if (!b) return err('Квартира уже придержана или в брони')
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Квартира {u} придержана на 24 часа',$3)`, [clientId, c.user.id, { u: unitNo(unit) }])
  await audit(c.real.id, 'booking.hold', 'booking', b!.id, { unit: unit.id }, c.impersonating ? c.user.id : null)
  await pushDeal(clientId, `квартира ${unitNo(unit)} придержана на 24 часа`)
  revalidatePath(`/units/${unit.id}`)
  back(`/units/${unit.id}`, { held: '1' })
}

const PARTNER_ASK_MAX = 50 // % — нейтральный потолок запроса скидки партнёром
export async function createBooking(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canBook(c.user.role)) return { error: 'Нет прав на бронь' }
  const unit = await unitById(s(f, 'unit'))
  const clientId = s(f, 'client')
  if (!unit) return { error: 'Квартира не найдена' }
  if (!clientId) return { error: 'Выберите закреплённого клиента' }
  const cl = await stageGuard(c, clientId).catch(() => null)
  if (!cl) return { error: 'Этот клиент не закреплён за вами' }
  // §10: кандидата застройщикам не передаём — сначала квалификация
  const st = await one<{ a: string; anon: boolean }>('select attach_status a, anonymized_at is not null anon from portal.clients where id = $1', [clientId])
  if (st?.anon) return { error: 'Данные клиента удалены по запросу — бронь невозможна' } // QA 10.11
  if (st?.a === 'candidate') return { error: 'Сначала квалифицируйте клиента: цель, бюджет, срок, страна и язык' }
  // §7 п.1: свой холд превращается в запрос; чужой холд блокирует запрос на 24 часа — можно встать в лист ожидания
  const myHold = unit.booking_status === 'hold' && unit.booking_agent === c.user.id
  if (unit.booking_status === 'hold' && !myHold) return { error: 'Квартиру придержал другой — запрос станет доступен после снятия холда; можно встать в лист ожидания' }
  if (unit.status !== 'available' || unit.price == null || (unit.booking_id && !myHold) || unit.deal_id) return { error: 'Квартира уже недоступна — встаньте в лист ожидания' }
  if (unit.sales_status !== 'sales' && c.user.role !== 'owner') return { error: 'Проект на стоп-продажах — новые брони не принимаются' }
  if (unit.hidden && isExternal(c.user.role)) return { error: 'Квартира уже недоступна' }
  if (isExternal(c.user.role) && !(await projectVisible(unit.project_id, c.user))) return { error: 'Квартира уже недоступна' }
  // 344 (11.11): ставки — по рынку сделки (рынок клиента): ставка застройщика и ставки партнёра и рекомендателя
  const cMarket = (await one<{ m: string | null }>('select market m from portal.clients where id = $1', [clientId]))?.m || 'GLOBAL'
  const cond = await conditionsFor(unit.project_id, isExternal(c.user.role) ? c.user : null, cMarket)
  if (!cond) return { error: 'Для проекта не заведены условия' }
  const disc = Math.max(0, Number(s(f, 'discount') || 0))
  // 270: на рынке клиента выключены переговоры о цене — скидку и бронь запрашивает руководитель Global (или админ)
  if (!(await priceNegotiation(cMarket)) && c.user.role !== 'owner' && !(c.user.role === 'market_head' && (c.user.market || 'GLOBAL') === 'GLOBAL'))
    return { error: 'На рынке клиента переговоры о цене выключены — бронь и скидку запрашивает руководитель Global' }
  // 10.11 (Денис): партнёру ползунок — до его части пула; больше — только «Попросить больше» (ask=1), без показа нашей части и всего пула
  const extReq = isExternal(c.user.role)
  // Этап 3 калькулятора: бронь из варианта — согласованная (или не требовавшая согласования) скидка варианта второй раз не согласуется
  const vid = s(f, 'variant')
  const vr = /^[0-9a-f-]{36}$/.test(vid) ? await one<{ id: string; name: string; params: { downPct: number; months: number; disc: number; start?: string; planId?: string | null } }>(
    `select id, name, params from portal.calc_variants where id = $1 and unit_id = $2 and (not needs_approval or approved_at is not null) and (author_id = $3 or (client_id = $4 and not $6) or $5)`,
    [vid, unit.id, c.user.id, clientId, ['owner', 'market_head'].includes(c.user.role), extReq]) : null
  // План оплаты брони (на сервере, не из формы)
  const allPlans = await plansFor(unit.project_id, unit.building_id)
  const plan = s(f, 'plan') ? allPlans.find((p) => p.id === s(f, 'plan')) : undefined
  if (s(f, 'plan') && !plan) return { error: t(c.lang, 'План оплаты больше не действует — обновите страницу') }
  // 361 (11.11): максимум скидки — пул плана по взносу и сроку варианта (или выбранного плана); пороги ролей прежние, но в его пределах;
  // своя часть партнёра — его доля пула плана (349)
  const pDown = vr ? Number(vr.params.downPct) || 0 : plan ? (isFull(plan) ? 100 : Number(plan.down_payment_pct) || 0) : 0
  const pMonths = vr ? Number(vr.params.months) || 0 : plan && !isFull(plan) ? Number(plan.months) || 0 : 0
  const pool = planPool({ grid: activeGrid(await downGridFor(unit.project_id), new Date().toISOString().slice(0, 10), unit.building_id), plans: allPlans, poolPct: cond.pool_pct, downPct: pDown, months: pMonths })
  const pc = planCond(cond, pool.pct)
  const cap = extReq ? pc.agent_pool_pct : Math.min(maxDiscount(c.user.role, cond), pool.pct), ceiling = Math.min(discountCeiling(c.user.role, cond), pool.pct)
  const byVariant = !!vr && disc <= Number(vr.params.disc || 0) + 1e-9
  if (extReq && disc > cap && !f.get('ask') && !byVariant) return { error: t(c.lang, 'Скидка больше вашей части — нажмите «Попросить больше»') }
  // QA 10.11 (Ревью): партнёрский запрос — до нейтрального потолка, не равного пулу (иначе перебором находится размер пула); отказ — за руководителем рынка
  if (extReq ? disc > PARTNER_ASK_MAX : disc > ceiling) return { error: extReq ? t(c.lang, 'Скидка больше {p}% не запрашивается', { p: PARTNER_ASK_MAX }) : t(c.lang, 'Скидка больше {p}% — только по запросу', { p: ceiling }) }
  const askNote = String(f.get('ask_note') || '').trim().slice(0, 500)
  // Сверх своего порога — бронь ставится, но ждёт согласования владельца или руководителя рынка (офис не подтверждает до решения)
  const approval = disc > cap && !byVariant ? 'pending' : null
  const active = await one<{ cl: number; ag: number; tot: number }>(`select
      count(*) filter (where client_id = $1)::int cl, count(*) filter (where agent_id = $2)::int ag, count(*)::int tot
    from portal.bookings where project_id = $3 and status in ('requested','confirmed')`, [clientId, c.user.id, unit.project_id])
  if (active!.cl >= cond.max_bookings_client) return { error: t(c.lang, 'У клиента уже {n} активных брони — это максимум', { n: active!.cl }) }
  // 366 (Денис 11.11): лимит застройщика — на все его проекты вместе; личный лимит партнёра и сейлза — у застройщика (Арад 1, Premium 3),
  // руководитель рынка и владелец могут превысить. Занято — запрос в очередь (Queued) на 7 дней
  const dl = await one<{ lim: number; person: number; used: number; mine: number }>(`select d.max_bookings_total lim, d.max_bookings_person person,
      (select count(*)::int from portal.bookings b join public.projects p2 on p2.id = b.project_id where p2.developer_id = d.catalog_id and b.status in ('requested','confirmed','release_pending')) used,
      (select count(*)::int from portal.bookings b join public.projects p2 on p2.id = b.project_id where p2.developer_id = d.catalog_id and b.agent_id = $2 and b.status in ('queued','requested','confirmed','release_pending')) mine
    from public.projects p join portal.developers d on d.catalog_id = p.developer_id where p.id = $1`, [unit.project_id, c.user.id])
  if (dl && !['owner', 'market_head'].includes(c.user.role) && dl.mine >= dl.person)
    return { error: t(c.lang, 'Личный лимит броней у этого застройщика — {n}; больше — с разрешения руководителя рынка', { n: dl.person }) }
  const limit = dl ? dl.lim : cond.max_bookings_total
  const used = dl ? dl.used : (await one<{ n: number }>(`select count(*)::int n from portal.bookings where project_id = $1 and status in ('requested','confirmed','release_pending')`, [unit.project_id]))!.n
  const queued = used >= limit
  const days = cond.booking_days
  const tour = { from: s(f, 'tour_from') || null, to: s(f, 'tour_to') || null }
  const signing = ['in_person', 'remote', 'power_of_attorney'].includes(s(f, 'signing')) ? s(f, 'signing') : null
  // Акция застройщика и правило сложения проекта (М6): цена до раздела денег считается на сервере, не из формы
  const { promo, mode } = await promoForUnit(unit)
  const ch = priceChain(unit.usd!, plan, promo, mode)
  if (!ch.poolAllowed && disc > 0) return { error: t(c.lang, 'По условиям акции скидка из пула не применяется — уберите скидку') }
  // Пакет: вторая квартира клиента (машиноместо, кладовка) к его активной брони — один договор на все
  const pkgId = s(f, 'package')
  const pkg = pkgId ? await one<{ id: string; group_id: string | null }>(`select id, group_id from portal.bookings where id = $1 and client_id = $2 and status in ('requested','confirmed')`, [pkgId, clientId]) : null
  if (pkgId && !pkg) return { error: t(c.lang, 'Бронь для пакета уже неактивна — обновите страницу') }
  const usdPrice = ch.base
  const sp = split(pc, usdPrice, disc, isExternal(c.user.role))
  // Опции (группа 4): только действующие для этой квартиры, цена в USD — на сервере, не из формы
  const want = f.getAll('options').map(String)
  const avail = want.length ? await optionsFor(unit) : []
  if (want.some((id) => !avail.some((o) => o.id === id))) return { error: t(c.lang, 'Опция больше не действует — обновите страницу') }
  const opts = avail.filter((o) => want.includes(o.id)).map((o) => ({ id: o.id, title: o.title, price: o.price, currency: o.currency, usd: o.usd }))
  const optUsd = opts.reduce((a, o) => a + o.usd, 0)
  const group = pkg ? pkg.group_id || pkg.id : null
  // Платная бронь: взнос из условий проекта; офис подтвердит бронь только после отметки об оплате
  const fee = cond.booking_fee > 0 ? { amount: cond.booking_fee, cur: cond.booking_fee_currency, usd: Math.round(await toUsd(cond.booking_fee, cond.booking_fee_currency)) } : null
  if (pkg && !pkg.group_id) await q('update portal.bookings set group_id = $1 where id = $1', [pkg.id])
  if (myHold) await q(`update portal.bookings set status = 'cancelled' where id = $1 and status = 'hold'`, [unit.booking_id])
  const b = await one<{ id: string } | null>(`insert into portal.bookings (unit_id, project_id, client_id, agent_id, price_list, discount_pct, final_price, conditions_id, snapshot, ends_at, approval, options, options_usd, group_id, fee_amount, fee_currency, fee_usd, fee_status,
      status, queued_at, queue_until, developer_id, tour_from, tour_to, signing, comment)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' days')::interval, $11, $12, $13, $14, $15, $16, $17, $18,
      $19, case when $19 = 'queued' then now() end, case when $19 = 'queued' then now() + interval '7 days' end, $20, $21, $22, $23, $24) returning id`,
    [unit.id, unit.project_id, clientId, c.user.id, usdPrice, disc, Math.round(sp.final), cond.id, JSON.stringify({ ...pc, plan_pool: pool.pct, plan_pool_source: pool.source, booking_days: days, split: sp, list_original: unit.usd, promo: ch.promoApplied ? { id: promo!.id, name: promo!.name, amount: Math.round(ch.promoAmt), mode } : null, plan: plan ? { id: plan.id, name: plan.name, down: plan.down_payment_pct, months: plan.months, full_discount: plan.full_payment_discount_pct } : null,
      variant: vr ? { id: vr.id, name: vr.name, downPct: vr.params.downPct, months: vr.params.months, disc: vr.params.disc, start: vr.params.start || null } : null }), days, approval, JSON.stringify(opts), optUsd, group, fee?.amount || 0, fee?.cur || 'USD', fee?.usd || 0, fee ? 'due' : 'none',
      queued ? 'queued' : 'requested', null, tour.from, tour.to, signing, s(f, 'comment') || null])
    .catch((e) => { if ((e as { code?: string }).code === '23505') return null; throw e }) // одновременный второй запрос на ту же квартиру
  if (!b) return { error: 'Квартира уже недоступна — встаньте в лист ожидания' }
  if (queued) await notify(c.user.id, 'booking', 'У застройщика сейчас нет свободного места — запрос {u} в очереди (до 7 дней); как только место освободится, он уйдёт бэк-офису', '/bookings', { u: unitNo(unit) })
  // Вторая бронь клиента со сделкой не возвращает его из «Договора» назад в «Бронь»
  await q(`update portal.clients set stage = case when stage in ('contract','payments','fee','support','handed') then stage else 'booking' end, last_activity_at = now() where id = $1`, [clientId])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Бронь {u} на {d} дней, цена {p}',$3)`, [clientId, c.user.id, { u: unitNo(unit), d: cond.booking_days, p: '$' + Math.round(sp.final).toLocaleString('en') }])
  if (vr) await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Бронь по варианту «{n}»: взнос {p}%, срок {m} мес.',$3)`, [clientId, c.user.id, { n: vr.name, p: vr.params.downPct, m: vr.params.months }])
  const u = unitNo(unit)
  if (approval) {
    const mk = (await one<{ market: string | null }>('select market from portal.clients where id = $1', [clientId]))?.market
    for (const o of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role = 'market_head' and market = $1))`, [mk])) await notify(o.id, 'booking', 'Скидка {p}% по брони {u} ждёт согласования', '/bookings', { p: disc, u })
    await queueTask(clientId, `Discount approval · ${disc}% · ${u}`, `Скидка ${disc}% сверх порога автора (${c.user.name}).${askNote ? ' Комментарий: ' + askNote : ''} Согласовать или отклонить — во вкладке Units → Условия покупки.`, 'market_head') // §13 п.9
    if (askNote) await q(`insert into portal.activities (client_id, user_id, kind, text, vars, internal) values ($1,$2,'system','Запрос скидки {p}% по {u}: {n}',$3,true)`, [clientId, c.user.id, { p: disc, u, n: askNote }])
  } else if (!queued) {
    for (const o of await q<{ id: string }>(`select id from portal.users where role = 'office' and active`)) await notify(o.id, 'booking', fee ? 'Новая платная бронь {u}: ждём взнос, затем подтверждение у застройщика' : 'Новая бронь {u} ждёт подтверждения у застройщика', '/bookings', { u })
    // §12 «Reservation request: задача бэк-офису» — в Bitrix24, к сделке клиента
    await queueTask(clientId, `Confirm reservation · ${u}`, `Проверьте квартиру ${u} у застройщика, забронируйте и внесите номер и срок брони — «Подтвердить бронь» во вкладке Units.`, 'office')
  }
  await audit(c.real.id, 'booking.create', 'booking', b!.id, { unit: unit.id, disc }, c.impersonating ? c.user.id : null)
  await pushDeal(clientId, queued ? `запрос брони ${unitNo(unit)} в очереди лимита застройщика` : `запрос брони ${unitNo(unit)}: ${Math.round(sp.final).toLocaleString('en')} $, скидка ${disc}%`)
  if (c.show) redirect(`/show/unit/${unit.id}?booked=1`)
  if ((await cookies()).get('ge_embed')?.value === '1') redirect(`/b24/units/${clientId}?tab=units&created=${b!.id}`) // внутри Bitrix24 — назад во вкладку Units
  redirect(`/bookings?created=${b!.id}`)
}
export async function bookingAction(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'id'), act = s(f, 'act')
  const b = await one<{ id: string; agent_id: string; client_id: string; status: string; extended: boolean; unit_id: string; final_price: number; project_id: string; snapshot: any; approval: string | null; discount_pct: number; fee_status: string }>('select * from portal.bookings where id = $1', [id])
  if (!b) return
  const mine = b.agent_id === c.user.id || c.user.role === 'owner'
  if ((act === 'approve' || act === 'decline') && canApproveDiscount(c.user.role) && b.approval === 'pending' && b.status === 'requested') {
    // 361: скидку больше пула плана (максимума по договору) согласовать нельзя — только отказать
    if (act === 'approve' && Number(b.discount_pct) > Number(b.snapshot?.plan_pool ?? Infinity) + 1e-9) return
    if (act === 'approve') {
      await q(`update portal.bookings set approval = 'approved', approved_by = $2 where id = $1`, [id, c.user.id])
      await notify(b.agent_id, 'booking', 'Скидка по брони согласована', '/bookings')
      for (const o of await q<{ id: string }>(`select id from portal.users where role = 'office' and active`)) await notify(o.id, 'booking', 'Новая бронь ждёт подтверждения у застройщика', '/bookings')
    } else {
      await q(`update portal.bookings set approval = 'rejected', approved_by = $2, status = 'cancelled' where id = $1`, [id, c.user.id])
      await notify(b.agent_id, 'booking', 'Скидка по брони не согласована — бронь снята', '/bookings')
    }
  } else if (act === 'fee_paid' && FEE_ROLES.includes(c.user.role) && b.fee_status === 'due' && ['requested', 'confirmed'].includes(b.status)) {
    await q(`update portal.bookings set fee_status = 'paid', fee_paid_at = now(), fee_by = $2 where id = $1 and fee_status = 'due'`, [id, c.user.id])
    await notify(b.agent_id, 'booking', 'Взнос за бронь получен — офис подтверждает бронь у застройщика', '/bookings')
  } else if ((act === 'fee_refund' || act === 'fee_keep') && ['owner', 'finance'].includes(c.user.role) && b.fee_status === 'paid' && ['cancelled', 'expired'].includes(b.status)) {
    await q(`update portal.bookings set fee_status = $2, fee_by = $3 where id = $1 and fee_status = 'paid'`, [id, act === 'fee_refund' ? 'refunded' : 'kept', c.user.id])
  } else if (act === 'confirm' && canConfirmBooking(c.user.role) && b.status === 'requested' && b.approval !== 'pending' && b.fee_status !== 'due') {
    // §7 п.5: номер и срок брони застройщика; цена брони фиксируется
    const until = s(f, 'until')
    await q(`update portal.bookings set status = 'confirmed', confirmed_by = $2, confirmed_at = now(), dev_booking_no = nullif($3, ''),
      ends_at = case when $4 <> '' then ($4::date + interval '1 day' - interval '1 second') else now() + ((snapshot->>'booking_days') || ' days')::interval end where id = $1`, [id, c.user.id, s(f, 'dev_no'), until])
    await pbEnqueue(b.unit_id, 'reserve', id, c.user.id) // М3: бронь у застройщика в Profitbase
    await notify(b.agent_id, 'booking', 'Бронь подтверждена у застройщика', '/bookings')
  } else if (act === 'reject' && canConfirmBooking(c.user.role) && ['requested', 'queued'].includes(b.status)) {
    const why = ['sold', 'developer_refused', 'registration_failed', 'other'].includes(s(f, 'reason')) ? s(f, 'reason') : 'other'
    await q(`update portal.bookings set status = 'declined', decline_reason = $2 where id = $1`, [id, why])
    await notify(b.agent_id, 'booking', 'Бронь отклонена: {r}', '/bookings', { r: why })
  } else if (act === 'release_hold' && b.status === 'hold' && (mine || c.user.role === 'market_head')) {
    await q(`update portal.bookings set status = 'cancelled' where id = $1`, [id]) // досрочно снять холд может автор и руководитель рынка
  } else if (act === 'release_confirm' && canConfirmBooking(c.user.role) && b.status === 'release_pending') {
    // §7 п.7: бэк-офис подтвердил снятие у застройщика — квартира свободна, лист ожидания получит уведомление
    await q(`update portal.bookings set status = 'expired' where id = $1`, [id])
    await pbEnqueue(b.unit_id, 'release', id, c.user.id)
    await notify(b.agent_id, 'booking', 'Бронь снята у застройщика — квартира свободна', '/bookings')
  } else if (act === 'extend' && (mine || canConfirmBooking(c.user.role)) && !b.extended && ['requested', 'confirmed'].includes(b.status)) {
    await q(`update portal.bookings set ends_at = ends_at + ((snapshot->>'booking_ext_days') || ' days')::interval, extended = true where id = $1`, [id])
  } else if (act === 'cancel' && (mine || canConfirmBooking(c.user.role)) && ['requested', 'confirmed', 'queued'].includes(b.status)) {
    await q(`update portal.bookings set status = 'cancelled' where id = $1`, [id])
    if (b.status === 'confirmed') await pbEnqueue(b.unit_id, 'release', id, c.user.id) // снять бронь и в Profitbase
    if (b.fee_status === 'paid') for (const o of await q<{ id: string }>(`select id from portal.users where active and role in ('finance','owner')`)) await notify(o.id, 'booking', 'Оплаченная бронь снята — решите по взносу: вернуть или удержать', '/bookings?f=fee')
  } else if (act === 'spa_approval' && canConfirmBooking(c.user.role) && b.status === 'confirmed') {
    // гл. 6 (решение 341): «Договор на согласовании» → SPA approval; только после пройденного KYC
    const kyc = await one<{ k: string | null }>('select kyc_status k from portal.clients where id = $1', [b.client_id])
    if (kyc?.k !== 'passed') return
    await q('update portal.bookings set spa_approval_at = coalesce(spa_approval_at, now()), spa_approval_by = coalesce(spa_approval_by, $2) where id = $1', [id, c.user.id])
  } else if (act === 'contract' && canConfirmBooking(c.user.role) && b.status === 'confirmed') { // «Договор подписан» ставит бэк-офис (§14)
    // Договор — только после пройденного KYC (v2)
    if ((await one<{ kyc_status: string }>('select kyc_status from portal.clients where id = $1', [b.client_id]))?.kyc_status !== 'passed') return
    // Пакет: подтверждённые брони того же клиента с тем же group_id оформляются одним договором — по сделке на квартиру
    const g = (await one<{ group_id: string | null }>('select group_id from portal.bookings where id = $1', [id]))?.group_id
    const list = g ? await q<{ id: string; unit_id: string; project_id: string; agent_id: string; final_price: number; snapshot: any }>(`select id, unit_id, project_id, agent_id, final_price, snapshot from portal.bookings where group_id = $1 and client_id = $2 and status = 'confirmed'`, [g, b.client_id])
      : [{ id, unit_id: b.unit_id, project_id: b.project_id, agent_id: b.agent_id, final_price: b.final_price, snapshot: b.snapshot }]
    const made: string[] = []
    await tx(async (t) => {
      for (const x of list) {
        const sp = x.snapshot?.split || {}
        const seller = (await t.query<{ curator_id: string | null; role: string }>('select curator_id, role from portal.users where id = $1', [x.agent_id])).rows[0]
        // Бронь уже оформлена параллельно (вторая вкладка) — пропускаем
        // Взнос за платную бронь засчитывается в цену по договору
        if (!(await t.query(`update portal.bookings set status = 'converted', fee_status = case when fee_status = 'paid' then 'credited' else fee_status end where id = $1 and status = 'confirmed'`, [x.id])).rowCount) continue
        const d = await t.query<{ id: string }>(`insert into portal.deals (booking_id, client_id, unit_id, project_id, agent_id, seller_id, final_price, agent_amount, our_amount, seller_amount, group_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [x.id, b.client_id, x.unit_id, x.project_id, isExternal((seller?.role || 'seller') as any) ? x.agent_id : null, seller?.curator_id || x.agent_id, x.final_price, Math.round(sp.agent || 0), Math.round(sp.ours || 0), Math.round(sp.seller || 0), g])
        made.push(d.rows[0].id)
        await pbEnqueue(x.unit_id, 'sold', x.id, c.user.id) // М4: «продано через GetsEstate» в Profitbase
      }
      if (made.length) await t.query(`update portal.clients set stage = case when stage in ('payments','fee','support','handed') then stage else 'contract' end where id = $1`, [b.client_id])
    })
    if (made.length) await notify(b.agent_id, 'deal', made.length > 1 ? 'Договор подписан — сделок в работе: {n}' : 'Договор подписан — сделка в работе', '/commission', made.length > 1 ? { n: made.length } : undefined)
    for (const d of made) await syncAct(d)
    for (const d of made) await computeShares(d) // §8: доли по ролям и транши комиссии застройщика
    if (made.length) await partnerProgress(b.agent_id) // §13 п.20: Active
  }
  await q('select portal.sync_client_stage($1)', [b.client_id]) // стадия клиента — по фактам: брони и сделки
  await audit(c.real.id, 'booking.' + act, 'booking', id, null, c.impersonating ? c.user.id : null)
  const NOTE: Record<string, string> = { spa_approval: 'договор на согласовании (SPA approval)', confirm: 'бронь подтверждена у застройщика', reject: 'бронь отклонена', release_confirm: 'бронь снята у застройщика', release_hold: 'холд снят', cancel: 'бронь снята', contract: 'договор подписан (SPA signed)', extend: 'бронь продлена', approve: 'скидка согласована', decline: 'скидка не согласована' }
  if (NOTE[act]) await pushDeal(b.client_id, NOTE[act])
  revalidatePath('/bookings')
  revalidatePath(`/clients/${b.client_id}`); revalidatePath('/clients'); revalidatePath('/')
  revalidatePath(`/b24/units/${b.client_id}`)
  // QA 09.11: после «Договор подписан» строка пропадала из броней молча — возвращаемся с пояснением
  if (act === 'contract' && s(f, 'back') === 'bookings') redirect(`/bookings?contract=${id}`)
}

// гл. 6 (решение 341): «Отказ» во вкладке Units — Lost с причиной из списка (Price, Financing, …); стадию Lost в Bitrix24 ставит портал
export async function refuseClient(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'market_head', 'seller', 'office', 'finance'].includes(c.user.role)) return
  const id = s(f, 'client'), reason = B24_LOST.includes(s(f, 'reason')) ? s(f, 'reason') : 'Other'
  const r = await moveStage(id, 'lost', { reason })
  if (r?.error) return
  await pushDeal(id, `отказ клиента: ${reason}`)
  revalidatePath(`/b24/units/${id}`); revalidatePath(`/clients/${id}`)
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
  await pushDeal(clientId, 'квартира добавлена в квартиры клиента')
  if ((await cookies()).get('ge_embed')?.value === '1') redirect(`/b24/units/${clientId}?tab=units`)
  redirect(`/selections/${sel!.id}`)
}
// Несколько квартир из шахматки в подборку клиента разом (без перехода в подборку — шахматка остаётся открытой)
export async function addManyToSelection(f: FormData) {
  const c = await writeCtx()
  const clientId = s(f, 'client'), ids = f.getAll('units').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100)
  if (!ids.length) return
  await stageGuard(c, clientId)
  // Только то, что пользователь видит доступным: партнёру — свободные и свои брони (F/M) в открытых ему проектах;
  // команде — всё, кроме проданного и снятого с продажи
  const ext = isExternal(c.user.role), mode = viewMode(c.user, false)
  const vis = new Map<string, boolean>()
  const list: string[] = []
  for (const u of await unitsByIds(ids)) {
    const code = codeFor(u, c.user, mode)
    if (ext ? !['F', 'M'].includes(code) : ['S', 'N', 'SB'].includes(code)) continue
    if (ext) { if (!vis.has(u.project_id)) vis.set(u.project_id, await projectVisible(u.project_id, c.user)); if (!vis.get(u.project_id)) continue }
    list.push(u.id)
  }
  if (!list.length) return
  let sel = await one<{ id: string }>(`select id from portal.selections where client_id = $1 and user_id = $2 and title <> 'Встреча' order by created_at desc limit 1`, [clientId, c.user.id])
  if (!sel) {
    const cl = await one<{ language: string | null }>('select language from portal.clients where id = $1', [clientId])
    sel = await one<{ id: string }>(`insert into portal.selections (token, client_id, user_id, title, lang) values ($1,$2,$3,'Подборка',$4) returning id`, [crypto.randomBytes(9).toString('base64url'), clientId, c.user.id, ['ru', 'en', 'de', 'he'].includes(cl?.language || '') ? cl!.language : 'en'])
  }
  for (const id of list) await q(`insert into portal.selection_items (selection_id, unit_id, sort) values ($1,$2,(select coalesce(max(sort),0)+1 from portal.selection_items where selection_id = $1)) on conflict do nothing`, [sel!.id, id])
  await q(`update portal.clients set stage = case when stage in ('lead','contact','qualify','fixation') then 'selection' else stage end, last_activity_at = now() where id = $1`, [clientId])
  await notify(c.user.id, 'selection', 'В подборку добавлено квартир: {n}', `/selections/${sel!.id}`, { n: list.length })
  await audit(c.real.id, 'selection.add_many', 'client', clientId, { n: list.length }, c.impersonating ? c.user.id : null)
  await pushDeal(clientId, `в квартиры клиента добавлено: ${list.length}`)
  revalidatePath(`/selections/${sel!.id}`)
}
export async function selectionUpdate(f: FormData) {
  const c = await writeCtx()
  const id = s(f, 'id')
  const sel = await one<{ user_id: string }>('select user_id from portal.selections where id = $1', [id])
  if (!sel || (sel.user_id !== c.user.id && c.user.role !== 'owner')) return
  if (s(f, 'remove')) await q('delete from portal.selection_items where selection_id = $1 and unit_id = $2', [id, s(f, 'remove')])
  if (s(f, 'lang')) await q('update portal.selections set lang = $2 where id = $1', [id, s(f, 'lang')])
  for (const [k, v] of f.entries()) if (k.startsWith('note:')) await q('update portal.selection_items set note = $3 where selection_id = $1 and unit_id = $2', [id, k.slice(5), String(v) || null])
  // План оплаты у квартиры подборки — по нему клиент видит график платежей (М7)
  for (const [k, v] of f.entries()) if (k.startsWith('plan:')) await q('update portal.selection_items set plan_id = $3 where selection_id = $1 and unit_id = $2', [id, k.slice(5), /^[0-9a-f-]{36}$/.test(String(v)) ? String(v) : null])
  // Этап 3 калькулятора: до трёх вариантов расчёта на квартиру. Только свои, на этого клиента или (руководителю) любые;
  // клиенту уходит вариант без согласования или согласованный — несогласованный не прикрепляется
  const selCl = (await one<{ client_id: string }>('select client_id from portal.selections where id = $1', [id]))!.client_id
  for (const unit of f.getAll('vunit').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x))) {
    const want = f.getAll(`vars:${unit}`).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x))
    const ok = want.length ? (await q<{ id: string }>(`select id from portal.calc_variants where id = any($1::uuid[]) and unit_id = $2
        and (author_id = $3 or (client_id = $4 and not $6) or $5) and (not needs_approval or approved_at is not null)`, [want, unit, c.user.id, selCl, ['owner', 'market_head'].includes(c.user.role), isExternal(c.user.role)])).map((r) => r.id) : []
    const keep = want.filter((x) => ok.includes(x)).slice(0, MAX_SEL_VARIANTS)
    await q('delete from portal.selection_variants where selection_id = $1 and unit_id = $2 and not (variant_id = any($3::uuid[]))', [id, unit, keep])
    for (const [i, vid] of keep.entries()) await q(`insert into portal.selection_variants (selection_id, unit_id, variant_id, sort, created_by) values ($1,$2,$3,$4,$5)
      on conflict (selection_id, variant_id) do update set sort = excluded.sort`, [id, unit, vid, i, c.user.id])
  }
  revalidatePath(`/selections/${id}`)
}

// Клиент на странице подборки отмечает вариант «подходит» (ещё раз — снимает); консультанту — уведомление
export async function likeSelVariant(f: FormData) {
  const token = s(f, 'token'), vid = s(f, 'variant')
  const r = await one<{ liked: boolean; client_id: string; user_id: string; name: string; unit: string }>(`update portal.selection_variants sv set liked_at = case when sv.liked_at is null then now() end
    from portal.selections se, portal.calc_variants v where se.id = sv.selection_id and v.id = sv.variant_id and se.token = $1 and sv.variant_id = $2::uuid
    returning sv.liked_at is not null liked, se.client_id, se.user_id, v.name, (select portal.unit_no(bl.external_id, u.number) from units u join buildings bl on bl.id = u.building_id where u.id = sv.unit_id) unit`, [token, /^[0-9a-f-]{36}$/.test(vid) ? vid : null])
  if (!r) return
  if (r.liked) {
    await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Клиенту подходит вариант «{n}» по квартире {u}',$2)`, [r.client_id, { n: r.name, u: r.unit }])
    await notify(r.user_id, 'selection', 'Клиенту подходит вариант «{n}» по квартире {u} — можно запросить бронь', `/clients/${r.client_id}`, { n: r.name, u: r.unit })
  }
  revalidatePath(`/s/${token}`)
}
export async function openedSelection(token: string) {
  const r = await one<{ id: string; client_id: string; user_id: string; opened: number }>(`update portal.selections set opened = opened + 1, last_opened_at = now() where token = $1 returning id, client_id, user_id, opened`, [token])
  if (!r) return
  const cl = await one<{ name: string }>('select name from portal.clients where id = $1', [r.client_id])
  await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Клиент открыл подборку (раз: {n})',$2)`, [r.client_id, { n: r.opened }])
  await notify(r.user_id, 'selection', 'Подборку открыли: {c} — хороший момент позвонить', `/clients/${r.client_id}`, { c: cl?.name || '' })
}

/* ── Заявка агента (публичная) и проверка ── */
export async function applyAgent(_: unknown, f: FormData) {
  // 358 (11.11): защита формы заявки от ботов — ловушка, метка времени показа формы, не больше 5 заявок с адреса в час и 3 с e-mail в сутки
  const ip = clientIp()
  if (s(f, 'website') || !formTokenOk(s(f, 'ft'))) return { error: 'Форма устарела или заполнена слишком быстро — обновите страницу и отправьте ещё раз' }
  const flood = await one<{ i: number; e: number }>(`select count(*) filter (where ip = $1 and created_at > now() - interval '1 hour')::int i,
      count(*) filter (where lower(email) = lower($2) and created_at > now() - interval '1 day')::int e from portal.agent_applications where (ip = $1 or lower(email) = lower($2))`, [ip || '-', s(f, 'email')])
  if ((ip && (flood?.i || 0) >= 5) || (flood?.e || 0) >= 3) return { error: 'Слишком много заявок — попробуйте позже' }
  if (!s(f, 'name') || !s(f, 'email')) return { error: 'Нужны имя и e-mail' }
  if (!f.get('consent')) return { error: 'Нужно согласие с условиями и обработкой данных' }
  const market = ['DE', 'IL', 'GLOBAL'].includes(s(f, 'market')) ? s(f, 'market') : 'DE'
  // Документы к заявке (разрешение маклера, выписка): без входа, поэтому до 3 файлов по 10 МБ, только PDF и фото
  const docs = f.getAll('docs').filter(isFile)
  const DOC = { exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'], max: 10 * 1024 * 1024 }
  if (docs.length > 3) return { error: 'Не больше 3 файлов' }
  if (docs.some((d) => !DOC.exts.includes((d.name.split('.').pop() || '').toLowerCase()))) return { error: 'Документы — PDF или фото (JPG, PNG, HEIC)' }
  if (docs.some((d) => d.size > DOC.max)) return { error: 'Файл больше 10 МБ' }
  const token = crypto.randomBytes(12).toString('hex')
  const app = await one<{ id: string }>(`insert into portal.agent_applications (kind, name, company, email, phone, city, languages, license, volume, channels, market, status_token) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [['agency', 'referrer'].includes(s(f, 'kind')) ? s(f, 'kind') : 'agent', s(f, 'name'), s(f, 'company') || null, s(f, 'email'), s(f, 'phone'), s(f, 'city'), s(f, 'languages'), s(f, 'license'), s(f, 'volume'), s(f, 'channels'), market, token])
  if (ip) await q('update portal.agent_applications set ip = $2 where id = $1', [app!.id, ip])
  for (const d of docs) await q('insert into portal.application_files (application_id, file_id) values ($1,$2)', [app!.id, await storeFile(d, null, DOC)])
  await queueApp(app!.id, `заявка подана в портале, документов: ${docs.length}`) // §13 п.18
  // §6 П9: рекомендатель — короткая оферта и соглашение о данных в форме, доступ сразу (Access granted), вход по ссылке из письма
  if (s(f, 'kind') === 'referrer') {
    const g = await grantAccess(app!.id, null)
    if ('error' in g) return { error: g.error === 'Такой e-mail уже есть' ? 'Этот e-mail уже зарегистрирован — войдите по ссылке из письма' : g.error }
    return { ok: true, token, referrer: true }
  }
  // Владельцу, руководителю и менеджерам рынка заявки (проверку проводит менеджер рынка)
  for (const o of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role in ('market_head','seller') and market = $1))`, [market])) await notify(o.id, 'application', 'Новая заявка: {n}', `/admin/agents/app/${app!.id}`, { n: s(f, 'name') })
  // QA 09.11: ссылка на статус была только на экране — дублируем письмом, на языке формы
  const al = (LANGS.includes(s(f, 'lang') as Lang) ? s(f, 'lang') : market === 'IL' ? 'he' : market === 'DE' ? 'de' : 'en') as Lang
  const link = `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/apply/status/${token}?lang=${al}`
  await q(`insert into portal.outbox_messages (channel, to_addr, subject, body, kind) values ('email',$1,$2,$3,'application')`,
    [s(f, 'email'), 'GetsEstate · ' + t(al, 'Заявка на партнёрство'), [t(al, 'Здравствуйте, {n}!', { n: s(f, 'name') }), t(al, 'Мы получили вашу заявку и ответим в течение 2 рабочих дней.'), t(al, 'Статус заявки') + ': ' + link].join('\n\n')])
  return { ok: true, token }
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
  await queueApp(id, `статус заявки в портале: ${status}${s(f, 'note') ? ' — ' + s(f, 'note').slice(0, 300) : ''}`)
  revalidatePath('/admin/agents'); revalidatePath(`/admin/agents/app/${id}`)
}

/* ── Условия проекта ── */
export async function saveConditions(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canEditConditions(c.user.role)) return { error: 'Только владелец' }
  const pid = s(f, 'project')
  const n = (k: string) => Number(s(f, k).replace(',', '.'))
  const fields = ['fix_pct', 'pool_pct', 'agent_fix_pct', 'agent_pool_pct', 'agent_our_pool_share', 'seller_share_pct', 'seller_self_disc', 'seller_max_disc', 'booking_days', 'booking_ext_days', 'protect_months', 'max_bookings_client', 'max_bookings_agent', 'max_bookings_total', 'booking_fee']
  if (!s(f, 'booking_fee')) f.set('booking_fee', '0')
  for (const k of fields) if (Number.isNaN(n(k))) return { error: 'Проверьте числа: ' + k }
  if (n('agent_pool_pct') > n('pool_pct')) return { error: 'Часть пула агента больше всего пула' }
  if (n('agent_fix_pct') > n('fix_pct')) return { error: 'Фикс агента больше нашего фикса' }
  // 344 (11.11): на каждом рынке сделки партнёр + консультант + рекомендатель — не больше нашего фикса этого рынка
  {
    const rbm: Record<string, number> = {}
    for (const m of ['DE', 'IL', 'GLOBAL']) { const v = Number(s(f, 'rate_' + m).replace(',', '.')); if (s(f, 'rate_' + m) && v > 0) rbm[m] = v }
    const num0 = (k: string, d: number) => (s(f, k) === '' || Number.isNaN(n(k)) ? d : n(k))
    const over = marketOverflow({ fix_pct: n('fix_pct'), agent_fix_pct: n('agent_fix_pct'), consultant_pct: num0('consultant_pct', 1), referrer_pct: num0('referrer_pct', 2), rates_by_market: rbm },
      await q<{ market: string | null; agent_fix_pct: number; referrer_pct: number | null }>(`select market, agent_fix_pct::float, referrer_pct::float from portal.agent_rates where project_id = $1 and market is not null and agent_id is null and agency_id is null`, [pid]))
    if (over.length) return { error: 'Доли больше нашего фикса: ' + over.map((o) => `${o.market} — партнёр + консультант + рекомендатель ${o.total}% при фиксе ${o.fix}%`).join('; ') + '. Задайте ставки рынка в исключениях' }
  }
  if (n('booking_fee') < 0) return { error: 'Взнос за бронь не может быть отрицательным' }
  const feeCur = ['USD', 'AZN', 'EUR'].includes(s(f, 'booking_fee_currency')) ? s(f, 'booking_fee_currency') : 'USD'
  const draft = await one<{ id: string }>(`select id from portal.conditions where project_id = $1 and status = 'draft' order by version desc limit 1`, [pid])
  const vals = fields.map(n)
  if (draft) {
    await q(`update portal.conditions set ${fields.map((k, i) => `${k} = $${i + 3}`).join(', ')}, valid_from = $2, pay_timing = $${fields.length + 3}, note = $${fields.length + 4}, booking_fee_currency = $${fields.length + 5} where id = $1`, [draft.id, s(f, 'valid_from'), ...vals, s(f, 'pay_timing'), s(f, 'note') || null, feeCur])
  } else {
    const v = await one<{ v: number }>('select coalesce(max(version),0)+1 v from portal.conditions where project_id = $1', [pid])
    await q(`insert into portal.conditions (project_id, version, status, valid_from, ${fields.join(', ')}, pay_timing, note, payment_plans, created_by, booking_fee_currency) values ($1,$2,'draft',$3, ${fields.map((_, i) => '$' + (i + 4)).join(', ')}, $${fields.length + 4}, $${fields.length + 5},
      coalesce((select payment_plans from portal.conditions where project_id = $1 order by version desc limit 1), '[]'), $${fields.length + 6}, $${fields.length + 7})`, [pid, v!.v, s(f, 'valid_from'), ...vals, s(f, 'pay_timing'), s(f, 'note') || null, c.user.id, feeCur])
  }
  // 2.2: условия договора на проект (регистрация, молчание, защита, комиссия, клаубэк, НДС, опции, АЗ)
  const ints = ['reg_response_days', 'silence_extra_days', 'reg_protect_months', 'renew_remind_days', 'clawback_months', 'payment_wait_days'].map((k) => { const v = Number(s(f, k)); return Number.isInteger(v) && v >= 0 ? v : null })
  if (ints.some((v) => v === null)) return { error: 'Проверьте сроки регистрации и клаубэка' }
  const rates: Record<string, number> = {}
  for (const m of ['DE', 'IL', 'GLOBAL']) { const v = s(f, 'rate_' + m).replace(',', '.'); if (v) { if (Number.isNaN(Number(v))) return { error: 'Ставка рынка ' + m }; rates[m] = Number(v) } }
  const pick = (k: string, ok: string[], d: string) => (ok.includes(s(f, k)) ? s(f, k) : d)
  // 11.11: от чего считается фикс застройщика
  await q(`update portal.conditions set fix_base = $2 where project_id = $1 and status = 'draft'`, [pid, s(f, 'fix_base') === 'list' ? 'list' : 'final'])
  await q(`update portal.conditions set reg_method = $2, silence_rule = $3, vat_mode = $4, clawback_offset = $5, fx_rule = $6, booking_write_api = $7, options_in_base = $8, sells_to_az = $9,
      rates_by_market = $10, reg_protect_months_sub = $11, reg_response_days = $12, silence_extra_days = $13, reg_protect_months = $14, renew_remind_days = $15, clawback_months = $16, payment_wait_days = $17,
      head_bonus_pct = $18, escort_fix_usd = $19, referrer_pct = $20, consultant_pct = $21, vat_rate = $22
    where project_id = $1 and status = 'draft'`, [pid, pick('reg_method', ['crm', 'email', 'api', 'file'], 'email'), pick('silence_rule', ['confirm', 'remind'], 'remind'), pick('vat_mode', ['over', 'incl'], 'over'),
      pick('clawback_offset', ['any', 'same_client'], 'any'), s(f, 'fx_rule') || null, f.get('booking_write_api') === 'on', f.get('options_in_base') === 'on', f.get('sells_to_az') === 'on',
      JSON.stringify(rates), s(f, 'reg_protect_months_sub') ? Number(s(f, 'reg_protect_months_sub')) : null, ...ints,
      ...(['head_bonus_pct', 'escort_fix_usd', 'referrer_pct', 'consultant_pct', 'vat_rate'] as const).map((k, i) => { const v = Number(s(f, k).replace(',', '.')); return s(f, k) === '' || Number.isNaN(v) ? [0, 500, 2, 1, 18][i] : v })])
  await audit(c.real.id, 'conditions.save', 'project', pid)
  if (s(f, 'publish')) {
    const pub = await one<{ version: number }>(`update portal.conditions set status = 'published' where project_id = $1 and status = 'draft' returning version`, [pid])
    await audit(c.real.id, 'conditions.publish', 'project', pid)
    // Лента партнёров (М9): новые условия — партнёру стоит проверить свою ставку
    if (pub) { const pr = await one<{ name: string; slug: string }>('select name, slug from projects where id = $1', [pid]); await autoPost(`cond:${pid}:${pub.version}`, 'Новые условия по проекту {p} — проверьте ставку и сроки брони', { p: pr?.name || '' }, pid, `/projects/${pr?.slug}?tab=terms`) }
  }
  revalidatePath('/admin/conditions')
  return { ok: s(f, 'publish') ? 'Опубликовано' : 'Черновик сохранён' }
}

/* ── Пользователи ── */
// Новый пользователь без пароля: случайный хеш, пароль задаёт сам по ссылке-приглашению
export async function createUser(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canManageUsers(c.user.role)) return { error: 'Только владелец' }
  if (!ROLES_ALL.includes(s(f, 'role') as Role)) return { error: 'Нет прав' }
  let uid: string
  try {
    uid = (await one<{ id: string }>(`insert into portal.users (email, name, password_hash, password_set, role, market, locale, agency_id) values ($1,$2,$3,false,$4,$5,$6,$7) returning id`,
      [s(f, 'email').toLowerCase(), s(f, 'name'), noPassword(), s(f, 'role'), s(f, 'market') || null, s(f, 'locale') || 'ru', s(f, 'agency') || null]))!.id
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  await audit(c.real.id, 'user.create', 'user', uid, { email: s(f, 'email') })
  revalidatePath('/admin/users')
  return { ok: true, ...(await invite(uid, c.real.id)) }
}
// Руководитель агентства заводит и отключает своих сотрудников (роль «саб-агент», агентство и рынок — его)
export async function createAgencyAgent(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (c.user.role !== 'agency_head' || !c.user.agency_id) return { error: 'Нет прав' }
  if (!s(f, 'name') || !s(f, 'email')) return { error: 'Нужны имя и e-mail' }
  let uid: string
  try {
    uid = (await one<{ id: string }>(`insert into portal.users (email, name, password_hash, password_set, role, market, locale, agency_id, curator_id) values ($1,$2,$3,false,'agent',$4,$5,$6,$7) returning id`,
      [s(f, 'email').toLowerCase(), s(f, 'name'), noPassword(), c.user.market, LANGS.includes(s(f, 'locale') as Lang) ? s(f, 'locale') : c.user.locale, c.user.agency_id, c.user.curator_id]))!.id
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  await audit(c.real.id, 'user.create', 'user', uid, { by: 'agency_head', email: s(f, 'email') }, c.impersonating ? c.user.id : null)
  // 248: доступ сразу, менеджеру по партнёрам (на старте — руководитель рынка) — уведомление
  for (const h of await q<{ id: string }>(`select id from portal.users where active and role = 'market_head' and (market = $1 or $1 is null)`, [c.user.market]))
    await notify(h.id, 'access', 'Агентство {a} пригласило сотрудника: {n}', '/admin/agents', { a: c.user.name, n: s(f, 'name') })
  revalidatePath('/team')
  return { ok: true, ...(await invite(uid, c.real.id)) }
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
  if (f.has('languages')) await q(`update portal.users set languages = $2 where id = $1`, [u.id, s(f, 'languages').toUpperCase().split(/[\s,;]+/).filter((x) => ['RU', 'EN', 'DE', 'HE', 'AZ', 'TR'].includes(x))])
  await audit(c.real.id, 'user.update', 'user', u.id, { role, market, from: { role: u.role, market: u.market } }, c.impersonating ? c.user.id : null)
  revalidatePath('/admin/users'); revalidatePath(`/admin/users/${u.id}`); revalidatePath('/admin/agents')
  return { ok: true }
}
export async function resetPassword(_: unknown, f: FormData) {
  const c = await writeCtx()
  // Руководитель агентства перевыпускает ссылку своему агенту (потерял приглашение), остальное — по правам редактирования
  let u = await editableUser(c, s(f, 'id'))
  if (!u && c.user.role === 'agency_head') {
    const a = await one<UserRow>('select id, role, market, curator_id, agency_id, email, name from portal.users where id = $1', [s(f, 'id')])
    if (a && a.role === 'agent' && a.agency_id && a.agency_id === c.user.agency_id) u = a
  }
  if (!u) return { error: 'Нет прав' }
  // Ссылка на новый пароль (48 часов); старый пароль действует, пока пользователь не задаст новый
  const full = (await one<{ id: string; email: string; name: string; locale: Lang; password_set: boolean }>('select id, email, name, locale, password_set from portal.users where id = $1', [u.id]))!
  const kind = full.password_set ? 'reset' : 'invite'
  const link = await issueLink(u.id, kind, c.real.id, kind === 'invite' ? 168 : 48)
  await mailLink(full, kind, link)
  await audit(c.real.id, 'user.password_link', 'user', u.id, { kind }, c.impersonating ? c.user.id : null)
  return { ok: true, link, mailed: mailOn() }
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
  ;(await cookies()).delete('ge_lang')
  revalidatePath('/', 'layout')
}

/* ── Заявка агента → доступ: агентство (если заявка от агентства), пользователь, куратор, ссылка-приглашение ── */
export async function createFromApplication(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) return { error: 'Нет прав' }
  const a = await one<{ market: string }>('select market from portal.agent_applications where id = $1', [s(f, 'id')])
  if (!a) return { error: 'Доступ уже создан' }
  if (c.user.role === 'market_head' && a.market !== c.user.market) return { error: 'Нет прав' }
  // Без revalidatePath: иначе строка заявки перерисуется и ссылка-приглашение исчезнет с экрана
  return grantAccess(s(f, 'id'), c.real.id, { curator: s(f, 'curator') || null, contract: s(f, 'contract') || null, asUser: c.impersonating ? c.user.id : null })
}

/* ── Исключения по ставкам агентов и агентств ── */
// Удаление — простой формой; добавление — с ответом (ошибка проверки долей видна на месте)
export async function saveAgentRate(f: FormData) { await saveAgentRateState(null, f) }
export async function saveAgentRateState(_: unknown, f: FormData): Promise<{ ok?: boolean; error?: string } | undefined> {
  const c = await writeCtx()
  if (!canEditConditions(c.user.role)) return { error: 'Нет прав' }
  if (s(f, 'delete')) {
    await q('delete from portal.agent_rates where id = $1', [s(f, 'delete')])
  } else {
    const [kind, id] = s(f, 'who').split(':')
    const fix = Number(s(f, 'fix').replace(',', '.')), pool = Number(s(f, 'pool').replace(',', '.')), ref = s(f, 'ref') ? Number(s(f, 'ref').replace(',', '.')) : null
    if (!id || Number.isNaN(fix) || Number.isNaN(pool) || (ref != null && Number.isNaN(ref))) return { error: 'Проверьте числа' }
    // 344 (11.11): ставка рынка — партнёр + консультант + рекомендатель не больше нашего фикса на этом рынке
    if (kind === 'market') {
      const k = await one<{ fix_pct: number; agent_fix_pct: number; consultant_pct: number | null; referrer_pct: number | null; rates_by_market: Record<string, number> | null }>(
        'select fix_pct::float, agent_fix_pct::float, consultant_pct::float, referrer_pct::float, rates_by_market from portal.cur_conditions($1)', [s(f, 'project')])
      const over = k ? marketOverflow(k, [{ market: id, agent_fix_pct: fix, referrer_pct: ref }]).filter((o) => o.market === id) : []
      if (over.length) return { error: `${id}: партнёр + консультант + рекомендатель ${over[0].total}% больше нашего фикса ${over[0].fix}%` }
    }
    await q(`insert into portal.agent_rates (project_id, agent_id, agency_id, market, agent_fix_pct, agent_pool_pct, referrer_pct, note) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s(f, 'project'), kind === 'user' ? id : null, kind === 'agency' ? id : null, kind === 'market' ? id : null, fix, pool, ref, s(f, 'note') || null])
  }
  await audit(c.real.id, 'conditions.rate', 'project', s(f, 'project'), { who: s(f, 'who'), del: s(f, 'delete') || undefined }, c.impersonating ? c.user.id : null)
  revalidatePath('/admin/conditions')
  return { ok: true }
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
  await q(`update portal.clients set name = $2, phone = $3, phone_norm = $4, email = $5, email_norm = $6, country = $7, language = $8 where id = $1`, [id, name, phone, pn, email, em, s(f, 'country') || null, langCode(s(f, 'language')) || null])
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
  const d = await one<{ client_id: string }>('update portal.deals set paid_pct = $2 where id = $1 returning client_id', [s(f, 'id'), v])
  if (d) await q('select portal.sync_client_stage($1)', [d.client_id]) // первый платёж — стадия «Платежи»
  if (d) await buildTranches(s(f, 'id')) // §8: условие транша выполнено — ждём поступление от застройщика
  if (d) await pushDeal(d.client_id, `оплата клиента по сделке: ${v}%`) // §13 п.13: Won, Installments, Aftercare
  await audit(c.real.id, 'deal.paid', 'deal', s(f, 'id'), { paid_pct: v }, c.impersonating ? c.user.id : null)
  revalidatePath('/finance')
  if (d) revalidatePath(`/b24/units/${d.client_id}`)
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
  const kind = ['passport', 'address', 'funds', 'kyc', 'booking', 'contract', 'payment', 'other'].includes(s(f, 'kind')) ? s(f, 'kind') : 'other'
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
  // Процент оплаты клиента (paid_pct) — отдельно от нашего вознаграждения: стадия сделки его не меняет
  await q(`update portal.deals set stage = $2, paid_out_at = case when $2 = 'paid_out' then current_date else paid_out_at end where id = $1`, [s(f, 'id'), st])
  const d = await one<{ agent_id: string | null; client_id: string }>('select agent_id, client_id from portal.deals where id = $1', [s(f, 'id')])
  if (d) await q('select portal.sync_client_stage($1)', [d.client_id])
  if (d?.agent_id && st === 'paid_out') await notify(d.agent_id, 'payout', 'Комиссия выплачена', '/commission')
  await syncAct(s(f, 'id')) // М4: акт вознаграждения следует за стадией сделки
  await audit(c.real.id, 'deal.' + st, 'deal', s(f, 'id'))
  revalidatePath('/', 'layout') // стадия сделки в селекте, акты и стадия клиента — сразу
}

/* ── Импорт клиентов из xlsx (v2 · М13): первая строка — заголовки; согласие клиента подтверждает тот, кто загружает ── */
// заголовки — RU / EN / DE / HE
const IMPORT_COLS: Record<string, string[]> = {
  name: ['имя', 'name', 'клиент', 'kunde', 'שם'], phone: ['телефон', 'phone', 'telefon', 'טלפון'], email: ['e-mail', 'email', 'почта', 'mail', 'דוא״ל', 'דוא"ל', 'אימייל'],
  country: ['страна', 'country', 'land', 'מדינה', 'ארץ'], language: ['язык', 'language', 'lang', 'sprache', 'שפה'],
  source: ['источник', 'source', 'quelle', 'מקור'], goal: ['цель', 'goal', 'ziel', 'מטרה'], budget: ['бюджет', 'budget', 'תקציב'], consent: ['согласие', 'consent', 'einwilligung', 'zustimmung', 'הסכמה'],
}
const YES = ['да', 'yes', 'ja', '1', 'true', 'x', '+', 'כן', 'y']
export async function importClients(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canRegisterClient(c.user.role)) return { error: 'Нет прав на регистрацию клиента' }
  // импорт — заодно массовая проверка «есть ли такой клиент»: не чаще раза в 10 минут
  const file = f.get('file')
  if (!isFile(file) || !file.name.toLowerCase().endsWith('.xlsx')) return { error: t(c.lang, 'Нужен файл .xlsx') }
  let rows: string[][]
  try { rows = readXlsx(Buffer.from(await file.arrayBuffer())) } catch { return { error: t(c.lang, 'Не получилось прочитать файл') } }
  // пустые строки после форматирования Excel не считаются; номер строки в сообщениях — как в Excel (индекс + 2)
  const filled = rows.slice(1).filter((r) => r.some((x) => x)).length
  if (filled < 1) return { error: t(c.lang, 'В файле нет строк с клиентами') }
  if (filled > 500) return { error: t(c.lang, 'Не больше 500 клиентов за раз') }
  // лимит частоты: проверка и отметка о начале — под блокировкой пользователя (две вкладки сразу не пройдут обе)
  const busy = await tx(async (tq) => {
    await tq.query('select pg_advisory_xact_lock(hashtext($1))', ['import:' + c.real.id])
    if ((await tq.query(`select 1 from portal.audit where user_id = $1 and action = 'client.import' and created_at > now() - interval '10 minutes'`, [c.real.id])).rowCount) return true
    await tq.query(`insert into portal.audit (user_id, action, entity, data) values ($1, 'client.import', 'client', $2)`, [c.real.id, JSON.stringify({ rows: filled })])
    return false
  })
  if (busy) return { error: t(c.lang, 'Импорт — не чаще раза в 10 минут') }
  const head = rows[0].map((h) => h.toLowerCase().trim())
  const col = Object.fromEntries(Object.entries(IMPORT_COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]))
  if (col.name < 0 || (col.phone < 0 && col.email < 0)) return { error: t(c.lang, 'Нужны колонки «Имя» и «Телефон» или «E-mail»') }
  let made = 0
  const skipped: string[] = []
  for (const [i, r] of rows.slice(1).entries()) {
    const get = (k: string) => (col[k] >= 0 ? r[col[k]] || '' : '')
    if (!get('name') && !get('phone') && !get('email')) continue
    if (!YES.includes(get('consent').toLowerCase())) { skipped.push(t(c.lang, 'строка {n}: нет согласия', { n: i + 2 })); continue }
    const fd = new FormData()
    for (const k of ['name', 'phone', 'email', 'country', 'language', 'source', 'goal', 'budget']) fd.set(k, get(k))
    fd.set('consent', 'on')
    const res: any = await registerClient(null, fd)
    if (res?.ok) made++
    else skipped.push(t(c.lang, 'строка {n}: {e}', { n: i + 2, e: res?.duplicate ? t(c.lang, 'уже есть в базе') : t(c.lang, res?.error || 'ошибка') }))
  }
  await audit(c.real.id, 'client.import_result', 'client', '', { made, skipped: skipped.length }, c.impersonating ? c.user.id : null)
  // много совпадений с чужими клиентами — сигнал руководителю рынка
  const dups = skipped.filter((x) => x.includes(t(c.lang, 'уже есть в базе'))).length
  if (dups >= 20) for (const h of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role = 'market_head' and market = $1))`, [c.user.market])) await notify(h.id, 'client', 'Импорт клиентов у {u}: совпадений с базой {n}', '/admin/journal', { u: c.user.name, n: dups })
  revalidatePath('/clients')
  return { ok: true, made, skipped }
}

/* ── Без входа: «Забыли пароль?» и задание пароля по ссылке ── */
// Ответ всегда одинаковый — по нему нельзя узнать, есть ли такой e-mail. Не чаще 3 ссылок в час на пользователя.
export async function requestReset(_: unknown, f: FormData) {
  const email = s(f, 'email').toLowerCase()
  const u = /^[^@\s]+@[^@\s]+$/.test(email) ? await one<{ id: string; email: string; name: string; locale: Lang; market: string | null; password_set: boolean }>('select id, email, name, locale, market, password_set from portal.users where lower(email) = $1 and active', [email]) : undefined
  if (u && !(await one(`select 1 from portal.auth_tokens where user_id = $1 and created_at > now() - interval '1 hour' having count(*) >= 3`, [u.id]))) {
    const kind = u.password_set ? 'reset' : 'invite'
    const link = await issueLink(u.id, kind, null, kind === 'invite' ? 168 : 2)
    await mailLink(u, kind, link)
    // Пока почта не подключена — руководителю в портале: выдать ссылку из карточки пользователя
    if (!mailOn()) for (const o of await q<{ id: string }>(`select id from portal.users where active and (role = 'owner' or (role = 'market_head' and market = $1))`, [u.market]))
      await notify(o.id, 'access', 'Запрошен сброс пароля: {n} — выдайте ссылку в карточке пользователя', `/admin/users/${u.id}`, { n: u.name })
    await audit(u.id, 'user.password_request')
  }
  return { ok: true }
}
export async function setPassword(_: unknown, f: FormData) {
  const tk = await tokenUser(s(f, 'token'))
  if (!tk) return { error: 'Ссылка устарела или уже использована — запросите новую' }
  const pw = s(f, 'password'), pin = s(f, 'pin')
  if (pw.length < 10) return { error: 'Пароль — не короче 10 символов' }
  if (pw !== s(f, 'password2')) return { error: 'Пароли не совпадают' }
  const needPin = !(await one<{ pin_hash: string | null }>('select pin_hash from portal.users where id = $1', [tk.user_id]))?.pin_hash
  if ((needPin || pin) && !/^\d{4}$/.test(pin)) return { error: 'PIN — 4 цифры' }
  const ok = await tx(async (t) => {
    // Ссылка одноразовая: гасим её в той же транзакции; две вкладки не зададут пароль дважды
    if (!(await t.query('update portal.auth_tokens set used_at = now() where id = $1 and used_at is null', [tk.id])).rowCount) return false
    await t.query(`update portal.users set password_hash = $2, password_set = true, session_ver = session_ver + 1 ${pin ? ', pin_hash = $3' : ''} where id = $1`, pin ? [tk.user_id, bcrypt.hashSync(pw, 10), bcrypt.hashSync(pin, 10)] : [tk.user_id, bcrypt.hashSync(pw, 10)])
    await t.query(`update portal.auth_tokens set used_at = now() where user_id = $1 and used_at is null`, [tk.user_id])
    return true
  })
  if (!ok) return { error: 'Ссылка устарела или уже использована — запросите новую' }
  await audit(tk.user_id, tk.kind === 'invite' ? 'user.invite_accept' : 'user.password_set')
  await signSession(tk.user_id)
  redirect('/')
}

/* ── Профиль: уведомления вне портала (e-mail, Telegram, сводка) ── */
export async function saveNotifyPrefs(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return
  await q('update portal.users set notify_email = $2, notify_telegram = $3, notify_digest = $4 where id = $1', [c.real.id, f.get('email') === '1', f.get('telegram') === '1', f.get('digest') === '1'])
  revalidatePath('/profile')
}
// Привязка Telegram: одноразовый код в ссылке на бота; бот (tick) по /start <код> запоминает чат. «Отвязать» — стирает чат.
export async function linkTelegram(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return
  if (s(f, 'unlink')) await q('update portal.users set telegram_chat_id = null, tg_link_code = null where id = $1', [c.real.id])
  else await q('update portal.users set tg_link_code = $2 where id = $1', [c.real.id, crypto.randomBytes(9).toString('base64url')])
  revalidatePath('/profile')
}
