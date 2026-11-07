// 2.2 · Внутренний вызов приложения из обработчика обмена (scripts/b24worker.mjs): только с самого сервера и с подписью от SESSION_SECRET.
// grant — стадия Access granted в Bitrix24 открывает кабинет партнёра той же логикой, что кнопка в админке (§13 п.19).
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { grantAccess } from '@/lib/partnerAccess'
import { clawbackDeal, computeShares } from '@/lib/money22'
import { q } from '@/lib/db'

export const dynamic = 'force-dynamic'

const sig = (action: string) => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update('b24-internal:' + action).digest('hex')

export async function POST(req: Request) {
  // только с самого сервера: снаружи запрос идёт через Cloudflare и nginx (cf-connecting-ip, x-forwarded-for — адрес клиента);
  // обработчик ходит напрямую на 127.0.0.1, и Next.js сам ставит x-forwarded-for = 127.0.0.1
  const xff = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim())
  if (req.headers.get('cf-connecting-ip') || xff.length !== 1 || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(xff[0])) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const got = req.headers.get('x-internal') || ''
  const want = sig(action)
  if (!process.env.SESSION_SECRET || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (action === 'grant') {
    const r = await grantAccess(String(body.app || ''), null)
    // ссылку-приглашение наружу не отдаём: она ушла письмом (или лежит в очереди писем в админке)
    return NextResponse.json('error' in r ? { error: r.error } : { ok: true, mailed: r.mailed })
  }
  // shares — доли и транши по сделкам без долей (после выкладки §8)
  if (action === 'shares') {
    const ds = await q<{ id: string }>(`select d.id from portal.deals d where d.stage <> 'cancelled' and not exists (select 1 from portal.deal_shares s where s.deal_id = d.id)`)
    for (const d of ds) await computeShares(d.id)
    return NextResponse.json({ ok: true, deals: ds.length })
  }
  // clawback — расторжение из Bitrix24 (§13 п.14): по всем сделкам клиента в работе
  if (action === 'clawback') {
    const ds = await q<{ id: string }>(`select id from portal.deals where client_id = $1 and stage <> 'cancelled'`, [String(body.client || '')])
    const out = []
    for (const d of ds) out.push(await clawbackDeal(d.id, null, 'расторжение в Bitrix24'))
    return NextResponse.json({ ok: true, deals: out.length, claw: out.reduce((a, x) => a + (x?.claw.length || 0), 0) })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
