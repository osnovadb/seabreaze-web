// 2.2 · 355 (Денис 11.11): ежемесячная выгрузка дат контактов по клиентам, зарегистрированным у застройщика (договор Арада:
// защита 6 месяцев от регистрации, последнего записанного в CRM контакта или покупки — застройщику нужны даты контактов).
import { NextResponse } from 'next/server'
import { requireCtx } from '@/lib/auth'
import { q, one, audit } from '@/lib/db'
import { makeXlsx } from '@/lib/xlsx'

export const dynamic = 'force-dynamic'
const fmt = (s: string | null) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '')

export async function GET(req: Request) {
  const c = await requireCtx()
  if (!['owner', 'office', 'finance', 'market_head'].includes(c.user.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const u = new URL(req.url).searchParams
  const dev = u.get('dev') || ''
  if (!/^[0-9a-f-]{36}$/.test(dev)) return NextResponse.json({ error: 'developer required' }, { status: 400 })
  const now = new Date(Date.now() + 4 * 3600000)
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const m = /^\d{4}-\d{2}$/.test(u.get('m') || '') ? u.get('m')! : prev
  const d = await one<{ name: string }>('select name from portal.developers where id = $1', [dev])
  if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const rows = await q<{ reg_no: string; client: string; project: string; sent: string | null; decided: string | null; contacts: string | null; last: string | null; deal: string | null }>(
    `select cl.reg_no, cl.name client, p.name project, r.sent_at::date::text sent, r.decided_at::date::text decided,
       (select string_agg(to_char(a.created_at, 'DD.MM.YYYY'), ', ' order by a.created_at) from portal.activities a where a.client_id = cl.id and a.kind <> 'system'
          and a.created_at >= $2::date and a.created_at < ($2::date + interval '1 month')) contacts,
       (select max(a.created_at)::date::text from portal.activities a where a.client_id = cl.id and a.kind <> 'system') last,
       (select min(dl.created_at)::date::text from portal.deals dl where dl.client_id = cl.id and dl.project_id = r.project_id and dl.stage <> 'cancelled') deal
     from portal.registrations r join portal.clients cl on cl.id = r.client_id join public.projects p on p.id = r.project_id
     where r.developer_id = $1 and r.status in ('sent','confirmed','confirmed_silence') and cl.anonymized_at is null
       and ($3 <> 'market_head' or cl.market = $4)
     order by p.name, cl.reg_no`, [dev, m + '-01', c.user.role, c.user.market || ''])
  const head = ['Рег. номер GetsEstate', 'Клиент', 'Проект', 'Регистрация отправлена', 'Регистрация подтверждена', `Контакты за ${m.split('-').reverse().join('.')}`, 'Последний контакт', 'Покупка']
  const buf = makeXlsx([{ name: 'Contacts', head: 2, rows: [[`GetsEstate — контакты с клиентами · ${d.name} · ${m}`], [], head, ...rows.map((r) => [r.reg_no, r.client, r.project, fmt(r.sent), fmt(r.decided), r.contacts || '', fmt(r.last), fmt(r.deal)])] }])
  await audit(c.real.id, 'registration.contacts_export', 'developer', dev, { month: m, n: rows.length })
  const name = `GetsEstate-contacts-${d.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${m}.xlsx`
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}` } })
}
