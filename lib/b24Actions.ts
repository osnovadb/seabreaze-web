'use server'
// 2.2 · Вкладки модуля в Bitrix24: связь сделки, контакта или лида с клиентом портала (§12, §13 события 2–6)
import { redirect } from 'next/navigation'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { b24Person, COL, type Kind } from './b24link'


// Клиент команды из карточки Bitrix24: закрепление сразу (§10), регистрации у застройщиков (§7)
export async function createFromB24(f: FormData) {
  const c = await requireCtx()
  if (!['owner', 'market_head', 'seller', 'office'].includes(c.user.role)) throw new Error('forbidden')
  const kind = String(f.get('kind')) as Kind, id = Number(f.get('id'))
  if (!COL[kind] || !id) throw new Error('bad')
  const p = await b24Person(kind, id)
  if (!p || (!p.phoneNorm && !p.emailNorm)) redirect(`/b24/${kind}/${id}?embed=1&err=nophone`)
  const n = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
  const reg = `R-${new Date().getFullYear()}-${String(n!.n).padStart(4, '0')}`
  const r = await one<{ id: string }>(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, market, consent_at, source, stage, owner_type, attach_status, protected_until, attached_at, ${COL[kind]}, b24_contact_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8, now(), 'bitrix24', 'lead', 'team', 'protected', current_date + interval '6 months', now(), $9, $10) returning id`,
    [reg, c.user.id, p!.name, p!.phone, p!.phoneNorm, p!.email, p!.emailNorm, p!.market || c.user.market, id, p!.contactId])
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Клиент заведён из Bitrix24 ({r}), закреплён за командой',$3)`, [r!.id, c.user.id, { r: reg }])
  await q('select portal.enqueue_registrations($1, null, false, $2)', [r!.id, c.user.id])
  await audit(c.real.id, 'client.from_b24', 'client', r!.id, { kind, id })
  redirect(`/clients/${r!.id}?embed=1`)
}
