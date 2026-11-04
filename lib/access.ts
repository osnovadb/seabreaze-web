// Доступы (запуск): одноразовые ссылки приглашения и сброса пароля — в базе только sha256 токена;
// письма — в очередь portal.outbox_messages (уйдут, когда подключат SMTP); защита входа от подбора пароля.
import crypto from 'node:crypto'
import { headers } from 'next/headers'
import { q, one } from './db'
import { t, type Lang } from './i18n'

export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export function baseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '')
  const h = headers()
  return `${h.get('x-forwarded-proto') || 'https'}://${h.get('x-forwarded-host') || h.get('host')}`
}
// Новая ссылка гасит прежние неиспользованные ссылки того же вида
export async function issueLink(userId: string, kind: 'invite' | 'reset', by: string | null, hours = kind === 'invite' ? 168 : 2) {
  const raw = crypto.randomBytes(24).toString('base64url')
  await q(`update portal.auth_tokens set used_at = now() where user_id = $1 and kind = $2 and used_at is null`, [userId, kind])
  await q(`insert into portal.auth_tokens (token_hash, user_id, kind, expires_at, created_by) values ($1,$2,$3, now() + ($4 || ' hours')::interval, $5)`,
    [sha(raw), userId, kind, hours, by])
  return `${baseUrl()}/set-password/${raw}`
}
export const tokenUser = (raw: string) => one<{ id: string; user_id: string; kind: string; email: string; name: string; locale: Lang }>(`select t.id, t.user_id, t.kind, u.email, u.name, u.locale from portal.auth_tokens t join portal.users u on u.id = t.user_id
  where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and u.active`, [sha(raw)])

// Письмо со ссылкой — в очередь на языке пользователя
export async function mailLink(u: { id: string; email: string; name: string; locale: Lang }, kind: 'invite' | 'reset', link: string) {
  const L = u.locale || 'en'
  const subject = kind === 'invite' ? t(L, 'Доступ к порталу партнёров GetsEstate') : t(L, 'Сброс пароля в портале GetsEstate')
  const body = [t(L, 'Здравствуйте, {n}!', { n: u.name }), '',
    kind === 'invite' ? t(L, 'Для вас открыт доступ к порталу партнёров GetsEstate. Задайте пароль по ссылке (действует 7 дней):') : t(L, 'Чтобы задать новый пароль, перейдите по ссылке:'),
    link, '', t(L, 'Если вы не ждали этого письма, просто проигнорируйте его.'), '', 'GetsEstate'].join('\n')
  await q(`insert into portal.outbox_messages (channel, to_addr, user_id, subject, body, kind) values ('email',$1,$2,$3,$4,$5)`, [u.email, u.id, subject, body, kind])
}

// Подбор пароля: 5 неудач по e-mail или 20 с одного адреса за 15 минут — пауза
export async function loginBlocked(email: string, ip: string) {
  const r = await one<{ e: number; i: number }>(`select count(*) filter (where email = $1)::int e, count(*) filter (where ip = $2)::int i from portal.login_attempts
    where not ok and at > now() - interval '15 minutes' and (email = $1 or ip = $2)`, [email, ip])
  return (r?.e || 0) >= 5 || (r?.i || 0) >= 20
}
export const noteLogin = (email: string, ip: string, ok: boolean) => q('insert into portal.login_attempts (email, ip, ok) values ($1,$2,$3)', [email, ip, ok])
export const clientIp = () => (headers().get('cf-connecting-ip') || headers().get('x-forwarded-for') || headers().get('x-real-ip') || '').split(',')[0].trim()
export const mailOn = () => !!process.env.SMTP_URL && process.env.SMTP_URL !== 'log' // log — режим проверки, письма не уходят
