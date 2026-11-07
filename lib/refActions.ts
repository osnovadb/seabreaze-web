'use server'
// 2.2 · §6 П9 Рекомендатель: ссылка для входа и передача контакта. Клиент рекомендателя — клиент команды: лид в воронку команды,
// в лиде и сделке поле Referrer; ведёт наш сейлз; вознаграждение — 2% от итоговой цены договора после получения нашей комиссии.
import { revalidatePath } from 'next/cache'
import { q, one, audit, notify } from './db'
import { requireCtx } from './auth'
import { issueLink, mailLink, loginBlocked, noteLogin, clientIp } from './access'
const norm = { phone: (p: string) => p.replace(/\D/g, '').replace(/^00/, ''), email: (e: string) => e.trim().toLowerCase() }
import { bakuYear, type Lang } from './i18n'
import { pushDeal } from './b24sync'
import { requestConsent } from './consent'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

// Ссылка для входа: ответ всегда одинаковый (не раскрываем, есть ли такой e-mail); не больше 5 запросов за 15 минут
export async function requestLoginLink(_: unknown, f: FormData) {
  const email = s(f, 'email').toLowerCase(), ip = clientIp()
  if (!email) return { error: 'Укажите e-mail' }
  if (await loginBlocked(email, ip)) return { error: 'Слишком много попыток — подождите 15 минут' }
  await noteLogin(email, ip, false)
  const u = await one<{ id: string; email: string; name: string; locale: Lang }>(`select id, email, name, locale from portal.users where lower(email) = $1 and active and role = 'referrer'`, [email])
  if (u) await mailLink(u, 'login', await issueLink(u.id, 'login', null))
  return { ok: true }
}

export async function referClient(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.user.role !== 'referrer' || c.impersonating) return { error: 'Нет прав' }
  const name = s(f, 'name'), phone = s(f, 'phone'), email = s(f, 'email')
  if (!name || (!phone && !email)) return { error: 'Нужны имя и телефон или e-mail' }
  if (!f.get('consent')) return { error: 'Подтвердите, что человек согласен, чтобы мы с ним связались' }
  const pn = norm.phone(phone), em = norm.email(email)
  const dup = await one(`select 1 from portal.clients where ((length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or ($2 <> '' and email_norm = $2)) and attach_status <> 'junk' limit 1`, [pn, em])
  // уже есть в базе — без подробностей (чей клиент, не раскрываем)
  if (dup) return { error: 'Этот человек уже есть в нашей базе — рекомендация не засчитывается' }
  const owner = await one<{ id: string }>(`select id from portal.users where active and (role = 'market_head' and market = $1 or role = 'owner') order by (role = 'market_head') desc, created_at limit 1`, [c.user.market])
  const n = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
  const reg = `R-${bakuYear()}-${String(n!.n).padStart(4, '0')}`
  const r = await one<{ id: string }>(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, market, country, interest, source, stage, owner_type, attach_status, protected_until, attached_at, referrer_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'referral','lead','referrer','protected', current_date + interval '6 months', now(), $11) returning id`,
    [reg, owner!.id, name, phone, pn, email, em, c.user.market, s(f, 'country') || null, s(f, 'comment') || null, c.user.id])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Рекомендация от {p} ({r}): ведёт команда',$3)`, [r!.id, c.user.id, { p: c.user.name, r: reg }])
  if (s(f, 'comment')) await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'note',$3)`, [r!.id, c.user.id, s(f, 'comment').slice(0, 2000)])
  await q('select portal.enqueue_registrations($1, null, false, $2)', [r!.id, c.user.id])
  await notify(owner!.id, 'client', 'Новая рекомендация от {p}: {c}', `/clients/${r!.id}`, { p: c.user.name, c: name })
  await audit(c.real.id, 'client.referral', 'client', r!.id, { reg })
  await requestConsent(r!.id, null) // §15: клиенту — ссылка на согласие
  await pushDeal(r!.id, `рекомендация от ${c.user.name} (${reg})`) // лид в воронку команды с полем Referrer
  revalidatePath('/refer')
  return { ok: true }
}
