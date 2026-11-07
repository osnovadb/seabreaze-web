// 2.2 · Внутренний вызов приложения из обработчика обмена (scripts/b24worker.mjs): только с самого сервера и с подписью от SESSION_SECRET.
// grant — стадия Access granted в Bitrix24 открывает кабинет партнёра той же логикой, что кнопка в админке (§13 п.19).
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { grantAccess } from '@/lib/partnerAccess'

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
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
