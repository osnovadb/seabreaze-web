// QA-прогон (только на QA-экземпляре: QA_MODE=1, запрос с 127.0.0.1, подпись от SESSION_SECRET).
// Вызывает те же серверные действия, что и кнопки интерфейса, от имени выбранного пользователя (actingAs) — тесты проверяют настоящую бизнес-логику.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { isRedirectError } from 'next/dist/client/components/redirect'
import { actingAs } from '@/lib/auth'
import * as A1 from '@/lib/actions'
import * as A2 from '@/lib/regActions'
import * as A3 from '@/lib/moneyActions'
import * as A4 from '@/lib/consentActions'
import * as A5 from '@/lib/privacy'
import * as A6 from '@/lib/kycActions'
import * as A7 from '@/lib/linkActions'
import * as A8 from '@/lib/refActions'
import * as A9 from '@/lib/marketActions'
import * as A10 from '@/lib/postActions'
import * as A11 from '@/lib/devActions'
import * as A12 from '@/lib/b24Actions'
import * as A13 from '@/lib/b24ListActions'

export const dynamic = 'force-dynamic'
const ALL: Record<string, unknown> = { ...A1, ...A2, ...A3, ...A4, ...A5, ...A6, ...A7, ...A8, ...A9, ...A10, ...A11, ...A12, ...A13 }

export async function POST(req: Request) {
  if (process.env.QA_MODE !== '1') return NextResponse.json({ error: 'not found' }, { status: 404 })
  const xff = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim())
  if (req.headers.get('cf-connecting-ip') || xff.length !== 1 || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(xff[0])) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const want = crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update('qa:' + body.action).digest('hex')
  const got = req.headers.get('x-qa') || ''
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const fn = ALL[String(body.action)]
  if (typeof fn !== 'function') return NextResponse.json({ error: 'unknown action ' + body.action }, { status: 400 })
  const fd = new FormData()
  for (const [k, v] of Object.entries(body.fields || {})) for (const x of Array.isArray(v) ? v : [v]) if (x !== null && x !== undefined) fd.append(k, String(x))
  for (const f of body.files || []) fd.append(f.field, new File([Buffer.from(f.content, 'base64')], f.name, { type: f.type || 'application/octet-stream' }))
  const args = Array.isArray(body.args) ? body.args : (fn as (...a: unknown[]) => unknown).length >= 2 ? [null, fd] : [fd]
  const run = () => (fn as (...a: unknown[]) => Promise<unknown>)(...args)
  try {
    const result = body.as ? await actingAs.run(String(body.as), run) : await run()
    return NextResponse.json({ ok: true, result: result ?? null })
  } catch (e) {
    if (isRedirectError(e)) return NextResponse.json({ ok: true, redirect: String((e as { digest?: string }).digest || '').split(';')[2] || true })
    return NextResponse.json({ ok: false, thrown: String((e as Error).message || e).slice(0, 300) })
  }
}
