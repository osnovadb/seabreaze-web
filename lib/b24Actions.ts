'use server'
// 2.2 · Вкладки модуля в Bitrix24: связь сделки, контакта или лида с клиентом портала (§12, §13 события 2–6)
import { redirect } from 'next/navigation'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { b24Person, COL, dealPipeline, isPartnerPipeline, type Kind } from './b24link'
import { pushDeal } from './b24sync'
import { requestConsent } from './consent'
import { processJob, pull, runQueue } from './b24x.mjs'
import { revalidatePath } from 'next/cache'


// Клиент команды из карточки Bitrix24: закрепление сразу (§10), регистрации у застройщиков (§7)
export async function createFromB24(f: FormData) {
  const c = await requireCtx()
  if (!['owner', 'market_head', 'seller', 'office', 'finance'].includes(c.user.role)) throw new Error('forbidden')
  const kind = String(f.get('kind')) as Kind, id = Number(f.get('id'))
  if (!COL[kind] || !id) throw new Error('bad')
  if (kind === 'deal' && isPartnerPipeline(await dealPipeline(id))) throw new Error('partner application') // О101: заявителя клиентом не заводим
  const p = await b24Person(kind, id)
  if (!p || (!p.phoneNorm && !p.emailNorm)) redirect(`/b24/${kind}/${id}?embed=1&err=nophone`)
  const n = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
  const reg = `R-${new Date().getFullYear()}-${String(n!.n).padStart(4, '0')}`
  const r = await one<{ id: string }>(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, market, consent_at, source, stage, owner_type, attach_status, protected_until, attached_at, ${COL[kind]}, b24_contact_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8, null, 'bitrix24', 'lead', 'team', 'protected', current_date + interval '6 months', now(), $9, $10) returning id`,
    [reg, c.user.id, p!.name, p!.phone, p!.phoneNorm, p!.email, p!.emailNorm, p!.market || c.user.market, id, p!.contactId])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Клиент заведён из Bitrix24 ({r}), закреплён за командой',$3)`, [r!.id, c.user.id, { r: reg }])
  await q('select portal.enqueue_registrations($1, null, false, $2)', [r!.id, c.user.id])
  await audit(c.real.id, 'client.from_b24', 'client', r!.id, { kind, id })
  await requestConsent(r!.id, null, { mail: false }) // §15: ссылку на согласие сейлз отправляет при первом контакте (WhatsApp или письмом)
  await pushDeal(r!.id, `клиент заведён в портале (${reg}), регистрации у застройщиков — в очереди`)
  redirect(`/b24/ctx?client=${r!.id}`)
}

// Админка «Обмен с Bitrix24»: переотправить задачу, все недоставленные, забрать изменения сейчас
async function ownerOnly() {
  const c = await requireCtx()
  if (c.user.role !== 'owner' || c.impersonating) throw new Error('forbidden')
  return c
}
export async function b24Retry(f: FormData) {
  const c = await ownerOnly()
  const id = Number(f.get('id'))
  if (id) {
    await q(`update portal.b24_jobs set status = 'pending', next_at = now(), attempts = least(attempts, 9) where id = $1 and status in ('error','dead','sent')`, [id])
    await processJob(q, id)
    await audit(c.real.id, 'b24.retry', 'b24_job', String(id))
  }
  revalidatePath('/admin/b24')
}
export async function b24RetryDead() {
  const c = await ownerOnly()
  const r = await q<{ id: number }>(`update portal.b24_jobs set status = 'pending', next_at = now(), attempts = 0 where status in ('dead','error') returning id`)
  await audit(c.real.id, 'b24.retry_all', 'b24_job', undefined, { n: r.length })
  await runQueue(q, Date.now() + 20000)
  revalidatePath('/admin/b24')
}
export async function b24PullNow() {
  const c = await ownerOnly()
  const out = await pull(q, {})
  await audit(c.real.id, 'b24.pull', undefined, undefined, out)
  revalidatePath('/admin/b24')
}
