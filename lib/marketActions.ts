'use server'
// 2.2 · Рынки, офисы продаж и словари: настраивает админ (решения 270, 271; офисы — для записи на показ и автоответов)
import { revalidatePath } from 'next/cache'
import { q, audit } from './db'
import { requireCtx } from './auth'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function owner() { const c = await requireCtx(); if (c.user.role !== 'owner' || c.impersonating) throw new Error('forbidden'); return c }

export async function saveMarket(f: FormData) {
  const c = await owner()
  const code = s(f, 'code')
  const days = (s(f, 'wd_form') ? f.getAll('wd').map(String) : s(f, 'workdays').split(/[\s,]+/)).map(Number).filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b) // Л9: галочки по дням
  await q(`update portal.markets set price_negotiation = $2, sla_minutes = $3, work_from = $4::time, work_to = $5::time, workdays = $6, languages = $7, mailbox = nullif($8, '') where code = $1`,
    [code, f.get('price_negotiation') === 'on', Math.max(5, Number(s(f, 'sla_minutes')) || 15), s(f, 'work_from') || '09:00', s(f, 'work_to') || '18:00', days.length ? days : [1, 2, 3, 4, 5],
      s(f, 'languages').toUpperCase().split(/[\s,;]+/).filter(Boolean), s(f, 'mailbox').toLowerCase()])
  await audit(c.real.id, 'market.save', 'market', code)
  revalidatePath('/admin/markets')
}
export async function saveOffice(f: FormData) {
  const c = await owner()
  if (s(f, 'delete') && s(f, 'id')) await q('delete from portal.offices where id = $1', [s(f, 'id')])
  else if (s(f, 'id')) await q('update portal.offices set city = $2, address = $3, phone = $4, schedule = $5, tz = $6 where id = $1', [s(f, 'id'), s(f, 'city'), s(f, 'address') || null, s(f, 'phone') || null, s(f, 'schedule') || null, s(f, 'tz') || 'Asia/Baku'])
  else if (s(f, 'city')) await q('insert into portal.offices (market, city, address, phone, schedule, tz) values ($1,$2,$3,$4,$5,$6)', [s(f, 'market') || 'GLOBAL', s(f, 'city'), s(f, 'address') || null, s(f, 'phone') || null, s(f, 'schedule') || null, s(f, 'tz') || 'Asia/Baku'])
  await audit(c.real.id, 'office.save', 'office', s(f, 'id') || undefined)
  revalidatePath('/admin/markets')
}
export async function saveDict(f: FormData) {
  const c = await owner()
  const kind = ['lost_reason', 'segment', 'taboo', 'decline_reason'].includes(s(f, 'kind')) ? s(f, 'kind') : null
  if (!kind) return
  const market = ['DE', 'IL', 'GLOBAL'].includes(s(f, 'market')) ? s(f, 'market') : ''
  if (s(f, 'delete')) await q('delete from portal.dict where kind = $1 and code = $2 and market = $3', [kind, s(f, 'code'), market])
  else if (s(f, 'label')) {
    const code = s(f, 'code') || s(f, 'label').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_').slice(0, 40)
    await q(`insert into portal.dict (kind, code, label, market) values ($1,$2,$3,$4) on conflict (kind, code, market) do update set label = $3`, [kind, code, s(f, 'label'), market])
  }
  await audit(c.real.id, 'dict.save', 'dict', kind)
  revalidatePath('/admin/markets')
}
