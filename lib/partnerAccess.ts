// Кабинет партнёра по заявке: агентство (если заявка от агентства), пользователь без пароля, приглашение письмом.
// Вызывается кнопкой «Открыть доступ» в админке и стадией Access granted в Bitrix24 (§13 п.19, через /api/internal/b24).
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { one, tx, audit } from './db'
import { issueLink, mailLink, mailOn } from './access'
import type { Lang } from './i18n'
import { queueApp } from './b24sync'

export const noPassword = () => bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10)

export async function invite(uid: string, by: string | null, kind: 'invite' | 'login' = 'invite') {
  const u = (await one<{ id: string; email: string; name: string; locale: Lang }>('select id, email, name, locale from portal.users where id = $1', [uid]))!
  const link = await issueLink(uid, kind, by)
  await mailLink(u, kind, link)
  return { link, mailed: mailOn() }
}

export async function grantAccess(appId: string, by: string | null, opts: { curator?: string | null; contract?: string | null; asUser?: string | null } = {}) {
  const a = await one<{ id: string; kind: string; name: string; company: string | null; email: string; market: string; license: string | null; user_id: string | null }>('select * from portal.agent_applications where id = $1', [appId])
  if (!a) return { error: 'Заявка не найдена' }
  if (a.user_id) return { error: 'Доступ уже создан' }
  let uid: string
  try {
    uid = await tx(async (t) => {
      let agency: string | null = null
      if (a.kind === 'agency') agency = (await t.query(`insert into portal.agencies (name, market) values ($1,$2) returning id`, [a.company || a.name, a.market])).rows[0].id
      const u = await t.query(`insert into portal.users (email, name, password_hash, password_set, role, market, locale, agency_id, curator_id, license_note, contract_signed_at) values ($1,$2,$3,false,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [a.email.toLowerCase(), a.name, noPassword(), a.kind === 'agency' ? 'agency_head' : a.kind === 'referrer' ? 'referrer' : 'agent', a.market, a.market === 'IL' ? 'he' : 'de', agency, opts.curator || null, a.license, opts.contract || null])
      await t.query(`update portal.agent_applications set status = 'approved', user_id = $2, reviewed_by = coalesce($3, reviewed_by) where id = $1`, [a.id, u.rows[0].id, by])
      return u.rows[0].id as string
    })
  } catch {
    return { error: 'Такой e-mail уже есть' }
  }
  await audit(by, 'application.access', 'user', uid, { application: a.id, via: by ? 'portal' : 'b24' }, opts.asUser ?? null)
  await queueApp(a.id, 'кабинет партнёра открыт, приглашение отправлено')
  // рекомендатель входит по ссылке из письма без пароля (решение 249)
  return { ok: true as const, email: a.email, ...(await invite(uid, by, a.kind === 'referrer' ? 'login' : 'invite')) }
}
