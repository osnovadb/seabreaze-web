// 2.2 · §15 Согласие клиента: один документ, две галочки — обязательная (данные и передача застройщикам, включая будущих) и необязательная (реклама).
// Партнёр и сейлз согласиться за клиента не могут: клиенту уходит ссылка, галочки он ставит сам. До этого регистрируем у застройщиков, в рекламу не берём.
import crypto from 'node:crypto'
import { q, one } from './db'
import { t, type Lang } from './i18n'

export const consentUrl = (token: string) => `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/c/${token}`
const LANGS = ['ru', 'en', 'de', 'he']

// Выдать ссылку (одна на клиента) и, если есть e-mail, поставить письмо в очередь на языке клиента
export async function requestConsent(clientId: string, by: string | null, opts: { mail?: boolean } = {}) {
  const cl = await one<{ id: string; name: string; email: string | null; language: string | null; consent_token: string | null; consent_status: string }>(
    'select id, name, email, language, consent_token, consent_status from portal.clients where id = $1', [clientId])
  if (!cl || cl.consent_status === 'given') return null
  const token = cl.consent_token || crypto.randomBytes(12).toString('base64url')
  await q(`update portal.clients set consent_token = $2, consent_status = case when consent_status = 'none' then 'pending' else consent_status end, consent_requested_at = coalesce(consent_requested_at, now()) where id = $1`, [clientId, token])
  if (opts.mail !== false && cl.email) await mailConsent(cl.id, cl.email, cl.name, (LANGS.includes(cl.language || '') ? cl.language : 'en') as Lang, token)
  if (by) await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1,$2,'system','Клиенту отправлена ссылка на согласие')`, [clientId, by])
  return consentUrl(token)
}
export async function mailConsent(clientId: string, email: string, name: string, L: Lang, token: string, reminder = false) {
  const subject = t(L, reminder ? 'Напоминание: подтвердите согласие — GetsEstate' : 'Подтвердите согласие на обработку данных — GetsEstate')
  const body = [t(L, 'Здравствуйте, {n}!', { n: name }), '', t(L, 'Чтобы мы могли подобрать для вас квартиры и зарегистрировать вас у застройщиков, подтвердите согласие по ссылке:'), consentUrl(token), '', 'GetsEstate'].join('\n')
  await q(`insert into portal.outbox_messages (channel, to_addr, subject, body, kind) values ('email',$1,$2,$3,'consent')`, [email, subject, body])
}
// Текст для WhatsApp — партнёр или сейлз отправляет со своего номера
export const waText = (L: Lang, url: string) => t(L, 'Здравствуйте! Подтвердите, пожалуйста, согласие на обработку данных для подбора квартир: {u}', { u: url })
