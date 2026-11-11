'use server'
// 2.2 · §15 Клиент сам ставит галочки по ссылке; отказ или отзыв — сразу в Bitrix24 (поля контакта, выход из сегментов), бэк-офису — задача
import { headers, type UnsafeUnwrappedHeaders } from 'next/headers';
import { revalidatePath } from 'next/cache'
import { q, one, audit, notify } from './db'
import { requireCtx } from './auth'
import { requestConsent } from './consent'
import { pushDeal, queueTask } from './b24sync'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const ip = () => ((headers() as unknown as UnsafeUnwrappedHeaders).get('cf-connecting-ip') || (headers() as unknown as UnsafeUnwrappedHeaders).get('x-forwarded-for') || '').split(',')[0].trim()

export async function answerConsent(_: unknown, f: FormData) {
  const cl = await one<{ id: string; owner_id: string; consent_status: string; marketing_consent_at: string | null; name: string; language: string | null }>(
    'select id, owner_id, consent_status, marketing_consent_at, name, language from portal.clients where consent_token = $1 and anonymized_at is null', [s(f, 'token')])
  if (!cl) return { error: 'Ссылка больше не действует' }
  const lang = s(f, 'lang') || cl.language
  const act = s(f, 'act')
  const log = (kind: string, granted: boolean, source = 'consent_link') => q(`insert into portal.consents (client_id, kind, granted, source, lang, ip) values ($1,$2,$3,$4,$5,$6)`, [cl.id, kind, granted, source, lang, ip()])
  if (act === 'decline') {
    // отказ — Do not contact; бэк-офис решает с застройщиками (решение 250)
    await q(`update portal.clients set consent_status = 'declined', do_not_contact = true, marketing_consent_at = null where id = $1`, [cl.id])
    await log('data', false); await log('marketing', false)
    await notify(cl.owner_id, 'client', 'Клиент {c} отказался от согласия на обработку данных — Do not contact', `/clients/${cl.id}`, { c: cl.name })
    await queueTask(cl.id, `Consent declined · ${cl.name}`, 'Клиент отказался от согласия на обработку данных. Решите с застройщиками по регистрациям; клиент — Do not contact.', 'office')
    await pushDeal(cl.id, 'клиент отказался от согласия на обработку данных — Do not contact')
    return { ok: 'declined' }
  }
  // 386 (Денис 12.11): клиент отзывает согласие на обработку данных. Новых передач застройщикам нет (регистрации и брони требуют согласия),
  // офису — задача уведомить застройщиков; подтверждённая бронь остаётся (договорное основание)
  if (act === 'withdraw' && cl.consent_status === 'given') {
    await q(`update portal.clients set consent_status = 'withdrawn', marketing_consent_at = null where id = $1`, [cl.id])
    await log('data', false, 'withdraw'); if (cl.marketing_consent_at) await log('marketing', false, 'withdraw')
    await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1, null, 'system', 'Клиент отозвал согласие на обработку данных')`, [cl.id])
    await notify(cl.owner_id, 'client', 'Клиент {c} отозвал согласие на обработку данных — новые регистрации и брони недоступны', `/clients/${cl.id}`, { c: cl.name })
    await queueTask(cl.id, `Consent withdrawn · ${cl.name}`, 'Клиент отозвал согласие на обработку данных. Уведомите застройщиков, у которых он зарегистрирован. Подтверждённая бронь остаётся; новых передач данных нет.', 'office')
    await pushDeal(cl.id, 'клиент отозвал согласие на обработку данных — новых передач застройщикам нет, уведомить застройщиков')
    return { ok: 'withdrawn' }
  }
  if (act === 'marketing_off') {
    await q('update portal.clients set marketing_consent_at = null where id = $1', [cl.id])
    await log('marketing', false, 'withdraw')
    await pushDeal(cl.id, 'клиент отозвал согласие на рекламу — исключить из сегментов и аудиторий')
    return { ok: 'saved' }
  }
  if (!f.get('data')) return { error: 'Отметьте обязательное согласие или нажмите «Не согласен»' }
  const mkt = !!f.get('marketing')
  await q(`update portal.clients set consent_status = 'given', consent_at = coalesce(consent_at, now()), marketing_consent_at = case when $2 then coalesce(marketing_consent_at, now()) else null end,
      do_not_contact = false where id = $1`, [cl.id, mkt])
  if (cl.consent_status !== 'given') await log('data', true)
  if (mkt !== !!cl.marketing_consent_at) await log('marketing', mkt)
  await q(`insert into portal.activities (client_id, user_id, kind, text) values ($1, null, 'system', $2)`, [cl.id, mkt ? 'Клиент подтвердил согласие (данные и реклама)' : 'Клиент подтвердил согласие на обработку данных'])
  await pushDeal(cl.id, mkt ? 'клиент подтвердил согласие: данные и реклама' : 'клиент подтвердил согласие на обработку данных (без рекламы)')
  return { ok: 'saved' }
}

// Сотрудник или партнёр: отправить ссылку ещё раз (письмом; WhatsApp — кнопкой в карточке)
export async function sendConsentLink(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) throw new Error('read-only')
  const id = s(f, 'client')
  const cl = await one<{ owner_id: string; agency_id: string | null }>('select owner_id, agency_id from portal.clients where id = $1', [id])
  if (!cl) return
  const mine = cl.owner_id === c.user.id || (c.user.role === 'agency_head' && cl.agency_id === c.user.agency_id) || ['owner', 'market_head', 'seller', 'office', 'finance'].includes(c.user.role)
  if (!mine) throw new Error('forbidden')
  await q('update portal.clients set consent_reminders = 0, consent_requested_at = now() where id = $1 and consent_status <> $2', [id, 'given'])
  await requestConsent(id, c.user.id)
  await audit(c.real.id, 'consent.request', 'client', id)
  revalidatePath(`/clients/${id}`); revalidatePath(`/b24/units/${id}`)
}
