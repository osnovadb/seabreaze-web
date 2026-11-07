'use server'
// 2.2 · §15 «Хранение и удаление»: запрос выполняется в портале за месяц, портал сам удаляет в Bitrix24.
// Лиды без сделки и маркетинговые данные — удаляем; договоры и KYC — храним по закону; остальное обезличиваем; застройщикам — уведомление (задача бэк-офису).
import { revalidatePath } from 'next/cache'
import { q, one, tx, audit } from './db'
import { requireCtx } from './auth'
import { enqueuePrivacy, processJob } from './b24x.mjs'
import { queueTask } from './b24sync'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function staff() {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role) || c.impersonating) throw new Error('forbidden')
  return c
}

export async function createPrivacyRequest(_: unknown, f: FormData) {
  const c = await staff()
  const key = s(f, 'client')
  const cl = await one<{ id: string; reg_no: string; name: string }>(`select id, reg_no, name from portal.clients where anonymized_at is null and (reg_no = $1 or (length($2) >= 9 and right(phone_norm, 9) = right($2, 9)) or (email_norm <> '' and email_norm = lower($1))) limit 1`,
    [key, key.replace(/\D/g, '')])
  if (!cl) return { error: 'Клиент не найден: укажите номер R-…, телефон или e-mail' }
  await q(`insert into portal.privacy_requests (client_id, client_label, channel, note, created_by) values ($1,$2,$3,$4,$5)`, [cl.id, `${cl.reg_no} · ${cl.name}`, s(f, 'channel') || 'email', s(f, 'note') || null, c.user.id])
  await q(`update portal.clients set do_not_contact = true, marketing_consent_at = null where id = $1`, [cl.id]) // до исполнения — не связываемся и не берём в рекламу
  await audit(c.real.id, 'privacy.request', 'client', cl.id)
  revalidatePath('/admin/privacy')
  return { ok: true }
}

export async function executePrivacyRequest(f: FormData) {
  const c = await staff()
  const r = await one<{ id: string; client_id: string | null; status: string }>('select id, client_id, status from portal.privacy_requests where id = $1', [s(f, 'id')])
  if (!r || r.status !== 'open' || !r.client_id) return
  const cl = (await one<{ id: string; reg_no: string; name: string; b24_lead_id: number | null; b24_contact_id: number | null }>('select id, reg_no, name, b24_lead_id, b24_contact_id from portal.clients where id = $1', [r.client_id]))!
  const deals = await q<{ id: string; b24_deal_id: number | null }>(`select d.id, null::bigint b24_deal_id from portal.deals d where d.client_id = $1 and d.stage <> 'cancelled'`, [cl.id])
  const hasDeal = deals.length > 0
  const b24deals = (await q<{ id: number }>(`select b24_deal_id id from portal.clients where id = $1 and b24_deal_id is not null
    union select b24_inst_id from portal.deals where client_id = $1 and b24_inst_id is not null union select b24_after_id from portal.deals where client_id = $1 and b24_after_id is not null`, [cl.id])).map((x) => Number(x.id))
  const result = await tx(async (t) => {
    const n = (sql: string) => t.query(sql, [cl.id]).then((x) => x.rowCount || 0)
    const out: Record<string, number | boolean> = { hasDeal }
    out.selections = await n('delete from portal.selections where client_id = $1')
    out.notes = await n(`delete from portal.activities where client_id = $1 and kind <> 'system'`)
    out.tasks = await n('delete from portal.tasks where client_id = $1')
    out.inbound = await n(`update portal.inbound_leads set name = null, phone = null, phone_norm = null, email = null, email_norm = null, payload = '{}', utm = null where client_id = $1`)
    out.waitlist = await n('delete from portal.waitlist where client_id = $1')
    // договоры и KYC храним по закону (GwG, 5 лет) — только если есть сделка; без сделки документы удаляем
    if (!hasDeal) out.documents = await n('delete from portal.client_documents where client_id = $1')
    await t.query(`update portal.clients set name = $2, phone = null, phone_norm = '', email = null, email_norm = '', country = null, goal = null, budget = null, timeline = null, payment = null, interest = null,
        segment = null, nurture = null, marketing_consent_at = null, consent_token = null, do_not_contact = true, anonymized_at = now(),
        kyc_citizenship = case when $3 then kyc_citizenship end, kyc_tax_residence = case when $3 then kyc_tax_residence end, kyc_pep = case when $3 then kyc_pep end
      where id = $1`, [cl.id, `Удалено по запросу · ${cl.reg_no}`, hasDeal])
    await t.query(`insert into portal.consents (client_id, kind, granted, source, by_user) values ($1,'data',false,'withdraw',$2), ($1,'marketing',false,'withdraw',$2)`, [cl.id, c.user.id])
    await t.query(`update portal.privacy_requests set status = 'done', done_by = $2, done_at = now(), result = $3 where id = $1`, [r.id, c.user.id, JSON.stringify(out)])
    return out
  })
  const job = await enqueuePrivacy(q, { lead: cl.b24_lead_id, contact: cl.b24_contact_id, deals: b24deals, hasDeal, reg: cl.reg_no })
  if (job) await processJob(q, job).catch(() => null)
  // застройщикам — уведомление об удалении по шаблону: задача бэк-офису, отметка в журнале
  const regs = await q<{ name: string }>(`select distinct d.name from portal.registrations r join portal.developers d on d.id = r.developer_id where r.client_id = $1 and r.status <> 'to_send'`, [cl.id])
  if (regs.length) await queueTask(cl.id, `Privacy: notify developers · ${cl.reg_no}`, `Клиент ${cl.reg_no} попросил удалить данные. Уведомите застройщиков по шаблону: ${regs.map((x) => x.name).join(', ')}.`, 'office')
  await audit(c.real.id, 'privacy.done', 'client', cl.id, result)
  revalidatePath('/admin/privacy')
}
export async function rejectPrivacyRequest(f: FormData) {
  const c = await staff()
  await q(`update portal.privacy_requests set status = 'rejected', done_by = $2, done_at = now(), note = coalesce(note || ' · ', '') || $3 where id = $1 and status = 'open'`, [s(f, 'id'), c.user.id, s(f, 'reason') || 'отклонён'])
  await audit(c.real.id, 'privacy.reject', 'privacy', s(f, 'id'))
  revalidatePath('/admin/privacy')
}
