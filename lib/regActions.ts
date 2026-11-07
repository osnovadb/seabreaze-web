'use server'
// 2.2 · Регистрации у застройщиков (§7, экран Бэк-офис 01): отправка пакетом, ответ застройщика, продление, массовая регистрация базы
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const BACKOFFICE = ['owner', 'office']

async function office() {
  const c = await requireCtx()
  if (!BACKOFFICE.includes(c.user.role)) throw new Error('forbidden')
  if (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1') throw new Error('read-only: impersonation')
  return c
}

// Отметить отправленными: срок ответа — по договору застройщика (рабочие дни + запас «3 + 2»)
export async function sendRegistrations(f: FormData) {
  const c = await office()
  const ids = f.getAll('id').map(String).filter(Boolean)
  if (!ids.length) return
  await q(`update portal.registrations r set status = 'sent', sent_at = now(),
      answer_due = portal.add_workdays(current_date, d.reg_response_days + d.silence_extra_days)
    from portal.developers d where d.id = r.developer_id and r.id = any($1::uuid[]) and r.status in ('to_send','expired')`, [ids])
  await audit(c.real.id, 'registration.send', 'registration', ids[0], { n: ids.length })
  revalidatePath('/registrations')
}

// Ответ застройщика: Confirmed — защита на срок договора (у клиентов саб-агентов — свой срок, если задан); Rejected — с причиной
export async function decideRegistration(f: FormData) {
  const c = await office()
  const id = s(f, 'id'), verdict = s(f, 'verdict')
  if (verdict === 'confirmed') {
    await q(`update portal.registrations r set status = 'confirmed', decided_at = now(), reject_reason = null,
        valid_until = current_date + (case when cl.owner_type = 'partner' and u.agency_id is null and d.protect_months_sub is not null then d.protect_months_sub else d.protect_months end || ' months')::interval
      from portal.developers d, portal.clients cl left join portal.users u on u.id = cl.owner_id
      where r.id = $1 and d.id = r.developer_id and cl.id = r.client_id`, [id])
  } else if (verdict === 'rejected') {
    const reason = ['developer_client', 'other_agency', 'other'].includes(s(f, 'reason')) ? s(f, 'reason') : 'other'
    await q(`update portal.registrations set status = 'rejected', decided_at = now(), reject_reason = $2, valid_until = null where id = $1`, [id, reason])
  } else return
  const r = await one<{ client_id: string }>('select client_id from portal.registrations where id = $1', [id])
  if (r) await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system',$3,$4)`,
    [r.client_id, c.user.id, verdict === 'confirmed' ? 'Регистрация у застройщика подтверждена' : 'Застройщик отказал в регистрации', {}])
  await audit(c.real.id, 'registration.' + verdict, 'registration', id)
  revalidatePath('/registrations')
}

// Продлить: снова в очередь на отправку (перерегистрация)
export async function renewRegistration(f: FormData) {
  const c = await office()
  const id = s(f, 'id')
  await q(`update portal.registrations set status = 'to_send', due_send = portal.add_workdays(current_date, 1), renew_task_at = null, sent_at = null, answer_due = null where id = $1`, [id])
  await audit(c.real.id, 'registration.renew', 'registration', id)
  revalidatePath('/registrations')
}

// Новый застройщик: вся база (кроме Do not contact и отозвавших согласие) — в очередь, срок 10 рабочих дней, передача файлом
export async function massEnqueue(f: FormData) {
  const c = await requireCtx()
  if (c.user.role !== 'owner' || c.impersonating) throw new Error('forbidden')
  const dev = s(f, 'developer')
  const r = await one<{ n: number }>(`select coalesce(sum(portal.enqueue_registrations(id, $1::uuid, true, $2::uuid)), 0)::int n from portal.clients
    where attach_status in ('protected','extended','transferred') and consent_at is not null and not do_not_contact`, [dev, c.user.id])
  await audit(c.real.id, 'registration.mass', 'developer', dev, { n: r?.n })
  revalidatePath('/registrations')
}
