// 2.2 · §8 Реестр выплат за месяц в xlsx: партнёры и рекомендатели; ведомость бонусов сотрудников (в зарплату включает бухгалтер юрлица);
// по рынку — приложение к счёту офиса «затраты + наценка» (агентские и бонусы рынка)
import { NextResponse } from 'next/server'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { makeXlsx } from '@/lib/xlsx'

export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const c = await requireCtx()
  if (!['owner', 'finance'].includes(c.user.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const u = new URL(req.url).searchParams, m = u.get('month') || '', market = u.get('market') || ''
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: 'month=YYYY-MM' }, { status: 400 })
  const rows = await q<{ role: string; who: string | null; email: string | null; market: string | null; gross: number; withheld: number; net: number; carried: boolean; act_no: string | null; currency: string | null; amount_cur: number | null; agreed: boolean; tax_no: string | null; note: string | null }>(
    `select l.role, coalesce(us.name, l.recipient) who, us.email, l.market, l.gross::float, l.withheld::float, l.net::float, l.carried, l.act_no, l.currency, l.amount_cur::float, l.agreed_at is not null agreed, us.tax_no, l.note
     from portal.payout_lines l join portal.payout_registers r on r.id = l.register_id left join portal.users us on us.id = l.user_id
     where r.month = to_date($1, 'YYYY-MM') and ($2 = '' or l.market = $2) order by l.role, who`, [m, market])
  const ext = rows.filter((r) => ['partner', 'referrer', 'consultant'].includes(r.role)), staff = rows.filter((r) => ['seller', 'market_head', 'escort'].includes(r.role))
  const head = ['Recipient', 'Role', 'Market', 'E-mail', 'Tax No.', 'Act', 'Gross USD', 'Withheld USD', 'Net USD', 'Currency', 'Amount in currency', 'Agreed', 'Carried', 'Note']
  const map = (r: (typeof rows)[number]) => [r.who, r.role, r.market, r.email, r.tax_no, r.act_no, r.gross, r.withheld, r.net, r.currency || 'USD', r.amount_cur ?? r.net, r.agreed ? 'yes' : '', r.carried ? 'yes' : '', r.note]
  const buf = makeXlsx([{ name: 'Partners', rows: [head, ...ext.map(map)] }, { name: 'Staff bonuses', rows: [head, ...staff.map(map)] }])
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="payout-register-${m}${market ? '-' + market : ''}.xlsx"` } })
}
