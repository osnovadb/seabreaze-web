'use server'
// 2.2 · §6 П8 Личная ссылка и белый фид партнёра; заявка со страницы ссылки — кандидат партнёра (14 дней, квалифицирует партнёр)
import crypto from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { q, one, audit, notify, withKeyLock, personKeys } from './db'
import { requireCtx } from './auth'
import { isExternal } from './perm'
import { listProjects } from './catalog'
import { bakuYear } from './i18n'
import { pushDeal } from './b24sync'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const norm = { phone: (p: string) => p.replace(/\D/g, '').replace(/^00/, ''), email: (e: string) => e.trim().toLowerCase() }

export async function saveLink(f: FormData) {
  const c = await requireCtx()
  if (!isExternal(c.user.role) || c.impersonating) throw new Error('forbidden')
  const visible = new Set((await listProjects(c.user)).map((p) => p.id))
  const ids = f.getAll('project').map(String).filter((id) => visible.has(id))
  const lang = ['de', 'en', 'ru', 'he'].includes(s(f, 'lang')) ? s(f, 'lang') : 'de'
  const mode = s(f, 'price_mode') === 'none' ? 'none' : 'from'
  const id = s(f, 'id')
  if (id) await q(`update portal.partner_links set title = $3, project_ids = $4, lang = $5, price_mode = $6 where id = $1 and user_id = $2`, [id, c.user.id, s(f, 'title') || null, ids, lang, mode])
  else await q(`insert into portal.partner_links (user_id, code, title, project_ids, lang, price_mode) values ($1,$2,$3,$4,$5,$6)`, [c.user.id, crypto.randomBytes(5).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x'), s(f, 'title') || null, ids, lang, mode])
  await audit(c.real.id, 'link.save', 'user', c.user.id, { projects: ids.length })
  revalidatePath('/links')
}
export async function toggleLink(f: FormData) {
  const c = await requireCtx()
  if (!isExternal(c.user.role) || c.impersonating) throw new Error('forbidden')
  await q(`update portal.partner_links set active = not active where id = $1 and user_id = $2`, [s(f, 'id'), c.user.id])
  revalidatePath('/links')
}

// Публичная форма страницы ссылки: две галочки согласия (обязательная — данные и застройщики, необязательная — реклама)
export async function linkLead(_: unknown, f: FormData) {
  // QA 09.11: «чей клиент» + создание — под блокировкой по телефону и e-mail
  return withKeyLock(personKeys(norm.phone(s(f, 'phone')), norm.email(s(f, 'email'))), () => linkLeadLocked(f))
}
async function linkLeadLocked(f: FormData) {
  if (s(f, 'website')) return { ok: true } // поле-ловушка для ботов
  const code = s(f, 'code')
  const l = await one<{ id: string; user_id: string; active: boolean; uactive: boolean; name: string; agency_id: string | null; market: string | null }>(
    `select l.id, l.user_id, l.active, u.active uactive, u.name, u.agency_id, u.market from portal.partner_links l join portal.users u on u.id = l.user_id where l.code = $1`, [code])
  if (!l || !l.active || !l.uactive) return { error: 'Ссылка больше не действует' }
  const name = s(f, 'name'), phone = s(f, 'phone'), email = s(f, 'email')
  if (!name || (!phone && !email)) return { error: 'Нужны имя и телефон или e-mail' }
  if (!f.get('consent')) return { error: 'Без согласия на обработку данных мы не можем передать заявку' }
  const pn = norm.phone(phone), em = norm.email(email)
  const ip = ((await headers()).get('cf-connecting-ip') || (await headers()).get('x-forwarded-for') || '').split(',')[0].trim()
  // повтор той же заявки за 10 минут не дублируем; не больше 10 заявок с адреса за час
  const flood = await one<{ same: number; ip: number }>(`select count(*) filter (where ((phone_norm = $1 and $1 <> '') or (email_norm = $2 and $2 <> '')) and created_at > now() - interval '10 minutes')::int same,
      count(*) filter (where payload->>'ip' = $3)::int ip from portal.inbound_leads where source = 'partner_link' and created_at > now() - interval '1 hour'`, [pn, em, ip])
  if (flood && (flood.same > 0 || flood.ip >= 10)) return { ok: true }
  const consent = { text: 'partner_link', version: '2.2', at: new Date().toISOString(), marketing: !!f.get('marketing') }
  const lead = await one<{ id: string }>(`insert into portal.inbound_leads (source, site, payload, name, phone, phone_norm, email, email_norm, lang, market, consent) values ('partner_link', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [code, JSON.stringify({ ip, comment: s(f, 'comment'), project: s(f, 'project') }), name, phone, pn, email, em, s(f, 'lang'), l.market, JSON.stringify(consent)])
  // уже есть в базе (у кого угодно) — кандидата не создаём; посетителю — то же «спасибо», партнёру — уведомление без владельца
  const dup = await one<{ id: string }>(`select id from portal.clients where ((length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or ($2 <> '' and email_norm = $2)) and attach_status <> 'junk' limit 1`, [pn, em])
  if (dup) {
    await q(`update portal.inbound_leads set result = 'existing', client_id = $2 where id = $1`, [lead!.id, dup.id])
    await notify(l.user_id, 'client', 'Заявка по вашей ссылке: {n} — уже есть в базе, можно открыть проверку «чей клиент»', '/clients/new', { n: name })
    return { ok: true }
  }
  const n = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
  const reg = `R-${bakuYear()}-${String(n!.n).padStart(4, '0')}`
  const cl = await one<{ id: string }>(`insert into portal.clients (reg_no, owner_id, agency_id, name, phone, phone_norm, email, email_norm, country, language, market, consent_at, marketing_consent_at, source, interest, stage, owner_type, attach_status, candidate_until)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), case when $12 then now() end, 'partner_link', $13, 'lead', 'partner', 'candidate', current_date + 14) returning id`,
    [reg, l.user_id, l.agency_id, name, phone, pn, email, em, s(f, 'country') || null, s(f, 'lang') || null, l.market, !!f.get('marketing'), [s(f, 'project'), s(f, 'comment')].filter(Boolean).join(' · ') || null])
  await q(`update portal.inbound_leads set result = 'partner_client', client_id = $2 where id = $1`, [lead!.id, cl!.id])
  // галочки поставил сам клиент — журнал согласий
  await q(`update portal.clients set consent_status = 'given' where id = $1`, [cl!.id])
  await q(`insert into portal.consents (client_id, kind, granted, source, lang, ip) values ($1,'data',true,'partner_link',$3,$4), ($1,'marketing',$2,'partner_link',$3,$4)`, [cl!.id, !!f.get('marketing'), s(f, 'lang') || null, ip])
  await q(`update portal.partner_links set leads = leads + 1 where id = $1`, [l.id])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1, null, 'system', 'Заявка по личной ссылке партнёра ({r}): квалифицируйте до 14 дней', $2)`, [cl!.id, { r: reg }])
  await notify(l.user_id, 'client', 'Новая заявка по вашей ссылке: {n} — квалифицируйте за 14 дней', `/clients/${cl!.id}`, { n: name })
  await pushDeal(cl!.id, `заявка по личной ссылке партнёра ${l.name} (${reg})`)
  return { ok: true }
}
