// 2.2 · §8 Отчёт агента застройщику за месяц: продажи и транши к оплате по каждому застройщику, суммы без НДС — по нему бухгалтер Caspian выставляет акт и e-qaimə
import { NextResponse } from 'next/server'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { makeXlsx } from '@/lib/xlsx'

export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const c = await requireCtx()
  if (!['owner', 'finance'].includes(c.user.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const m = new URL(req.url).searchParams.get('month') || ''
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: 'month=YYYY-MM' }, { status: 400 })
  const rows = await q<{ dev: string; project: string; unit: string; buyer: string; signed: string; price: number; total: number; no: number; pct: number; amount: number; status: string; expected_at: string | null; received_at: string | null }>(`
    select dv.name dev, p.name project, portal.unit_no(bl.external_id, un.number) unit, cl.name buyer, (d.created_at at time zone 'Asia/Baku')::date::text signed, d.final_price::float price, d.commission_total::float total,
      t.no, t.pct::float, t.amount::float, t.status, t.expected_at::text, (t.received_at at time zone 'Asia/Baku')::date::text
    from portal.tranches t join portal.deals d on d.id = t.deal_id join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id
      join public.projects p on p.id = d.project_id join public.developers dv on dv.id = p.developer_id join portal.clients cl on cl.id = d.client_id
    where t.status in ('expected','received') and d.terminated_at is null
      and (t.status = 'expected' and t.expected_at < (to_date($1, 'YYYY-MM') + interval '1 month') or date_trunc('month', t.received_at) = to_date($1, 'YYYY-MM'))
    order by dv.name, p.name, unit, t.no`, [m])
  const devs = Array.from(new Set(rows.map((r) => r.dev)))
  const head = ['Project', 'Unit', 'Buyer', 'SPA signed', 'Contract price, USD', 'Commission total, USD (excl. VAT)', 'Tranche', 'Share %', 'Amount, USD (excl. VAT)', 'Status', 'Expected', 'Received']
  const sheets = (devs.length ? devs : ['—']).map((dv) => ({ name: dv, rows: [head, ...rows.filter((r) => r.dev === dv).map((r) => [r.project, r.unit, r.buyer, r.signed, r.price, r.total, r.no, r.pct, r.amount, r.status === 'received' ? 'Received' : 'Expected', r.expected_at, r.received_at])] }))
  return new NextResponse(new Uint8Array(makeXlsx(sheets)), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="agent-report-${m}.xlsx"` } })
}
