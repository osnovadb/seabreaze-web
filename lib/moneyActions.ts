'use server'
// 2.2 · §8 Деньги: действия финансов, руководителя рынка и админа; реквизиты партнёра для выплат
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { receiveTranche, collectRegister, confirmMarket, approveRegister, payRegister, computeShares, addAdjustment, writeOffDebt } from './money22'
import { storeFile, isFile } from './files'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function role(roles: string[]) {
  const c = await requireCtx()
  if (!roles.includes(c.user.role) || c.impersonating) throw new Error('forbidden')
  return c
}
const done = () => { revalidatePath('/finance'); revalidatePath('/commission') }

export async function trancheReceived(f: FormData) {
  const c = await role(['owner', 'finance'])
  const r = await receiveTranche(s(f, 'id'), c.user.id)
  if (r) await audit(c.real.id, 'tranche.received', 'tranche', s(f, 'id'), { deal: r.deal_id, amount: r.amount })
  done()
}
export async function recomputeShares(f: FormData) {
  const c = await role(['owner', 'finance'])
  await computeShares(s(f, 'deal'))
  await audit(c.real.id, 'deal.shares', 'deal', s(f, 'deal'))
  done()
}
export async function registerCollect(f: FormData) {
  const c = await role(['owner', 'finance'])
  const m = /^\d{4}-\d{2}$/.test(s(f, 'month')) ? s(f, 'month') + '-01' : null
  if (!m) return
  const r = await collectRegister(m, c.user.id)
  await audit(c.real.id, 'register.collect', 'register', 'id' in r ? r.id : undefined, { month: m })
  done()
}
export async function registerConfirm(f: FormData) {
  const c = await role(['owner', 'market_head'])
  const market = c.user.role === 'market_head' ? c.user.market || '' : s(f, 'market')
  await confirmMarket(s(f, 'id'), market, c.user.id)
  await audit(c.real.id, 'register.confirm', 'register', s(f, 'id'), { market })
  done()
}
export async function registerApprove(f: FormData) {
  const c = await role(['owner'])
  await approveRegister(s(f, 'id'), c.user.id)
  await audit(c.real.id, 'register.approve', 'register', s(f, 'id'))
  done()
}
export async function registerPaid(f: FormData) {
  const c = await role(['owner', 'finance'])
  await payRegister(s(f, 'id'), c.user.id)
  await audit(c.real.id, 'register.paid', 'register', s(f, 'id'))
  done()
}
// Ставки удержания налога (юрлицо × страна) — настраивают финансы
export async function saveWithholding(f: FormData) {
  const c = await role(['owner', 'finance'])
  const entity = ['Caspian', 'GmbH', 'IL Ltd'].includes(s(f, 'entity')) ? s(f, 'entity') : 'Caspian'
  const country = s(f, 'country').toUpperCase().slice(0, 2), rate = Number(s(f, 'rate'))
  if (!country || Number.isNaN(rate)) return
  if (rate <= 0) await q('delete from portal.withholding where entity = $1 and country = $2', [entity, country])
  else await q(`insert into portal.withholding (entity, country, rate) values ($1,$2,$3) on conflict (entity, country) do update set rate = $3`, [entity, country, rate])
  await audit(c.real.id, 'withholding.save', undefined, undefined, { entity, country, rate })
  done()
}
// Данные партнёра для выплат: форма, НДС, налоговое резидентство и сертификат (проверяет бэк-офис при активации)
export async function savePayoutProfile(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) throw new Error('read-only')
  const self = ['agent', 'agency_head', 'referrer'].includes(c.user.role)
  const id = self ? c.user.id : s(f, 'user')
  if (!self && !['owner', 'office', 'finance'].includes(c.user.role)) throw new Error('forbidden')
  const form = ['company', 'sole', 'individual'].includes(s(f, 'partner_form')) ? s(f, 'partner_form') : null
  await q(`update portal.users set partner_form = $2, vat_payer = $3, vat_no = nullif($4, ''), tax_country = nullif(upper($5), ''), tax_no = nullif($6, ''),
      tax_cert_until = case when $7 = '' then null else $7::date end where id = $1`,
    [id, form, f.get('vat_payer') === 'on', s(f, 'vat_no'), s(f, 'tax_country').slice(0, 2), s(f, 'tax_no'), s(f, 'tax_cert_until')])
  await audit(c.real.id, 'user.payout_profile', 'user', id)
  revalidatePath('/commission'); revalidatePath('/profile')
}
// Сопровождающий в Баку — назначает бэк-офис при Reserved (фикс за продажу — из условий проекта)
export async function setEscort(f: FormData) {
  const c = await role(['owner', 'office'])
  const b = await one<{ client_id: string }>(`update portal.bookings set escort_id = nullif($2, '')::uuid where id = $1 returning client_id`, [s(f, 'id'), s(f, 'escort')])
  await q(`update portal.deals set escort_id = nullif($2, '')::uuid where booking_id = $1`, [s(f, 'id'), s(f, 'escort')])
  await audit(c.real.id, 'booking.escort', 'booking', s(f, 'id'), { escort: s(f, 'escort') || null })
  if (b) revalidatePath(`/b24/units/${b.client_id}`)
}

// Партнёр: «Согласен с актом» — запись в журнал (решение 247)
export async function agreeAct(f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) throw new Error('read-only')
  const l = await one<{ id: string }>(`update portal.payout_lines set agreed_at = now(), agreed_by = $2 where id = $1 and user_id = $2 and act_no is not null and agreed_at is null returning id`, [s(f, 'id'), c.user.id])
  if (l) await audit(c.real.id, 'act.agree', 'payout_line', l.id)
  revalidatePath('/commission'); revalidatePath(`/commission/act/${s(f, 'id')}`)
}
// Компания или ИП загружает счёт против нашего акта
export async function uploadInvoice(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (c.impersonating) return { error: 'Только чтение' }
  const file = f.get('file')
  if (!isFile(file)) return { error: 'Выберите файл' }
  const l = await one<{ id: string }>('select id from portal.payout_lines where id = $1 and user_id = $2 and act_no is not null', [s(f, 'id'), c.user.id])
  if (!l) return { error: 'Нет прав' }
  let fid: string
  try { fid = await storeFile(file, c.user.id, { exts: ['pdf', 'jpg', 'jpeg', 'png'], max: 10 * 1024 * 1024 }) } catch { return { error: 'Счёт — PDF или фото до 10 МБ' } }
  await q('update portal.payout_lines set invoice_file_id = $2, invoice_at = now() where id = $1', [l.id, fid])
  await audit(c.real.id, 'act.invoice', 'payout_line', l.id)
  revalidatePath('/commission'); revalidatePath(`/commission/act/${l.id}`)
  return { ok: true }
}
export async function adjustment(f: FormData) {
  const c = await role(['owner', 'finance'])
  const amt = Number(s(f, 'amount').replace(',', '.'))
  if (Number.isNaN(amt) || !amt) return
  await addAdjustment(s(f, 'deal'), s(f, 'role'), amt, s(f, 'note') || '—', c.user.id)
  await audit(c.real.id, 'accrual.adjustment', 'deal', s(f, 'deal'), { role: s(f, 'role'), amount: amt })
  done()
}
export async function writeOff(f: FormData) {
  const c = await role(['owner'])
  await writeOffDebt(s(f, 'user'), s(f, 'role'), c.user.id)
  await audit(c.real.id, 'accrual.writeoff', 'user', s(f, 'user'), { role: s(f, 'role') })
  done()
}
