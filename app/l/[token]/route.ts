// 2.2 · Вход рекомендателя по одноразовой ссылке из письма, без пароля (решение 249)
import { NextResponse } from 'next/server'
import { tokenUser } from '@/lib/access'
import { signSession } from '@/lib/auth'
import { q, audit } from '@/lib/db'

export const dynamic = 'force-dynamic'
const base = (req: Request) => {
  const h = req.headers
  const host = h.get('x-forwarded-host') || h.get('host')
  return (process.env.PUBLIC_URL || (host ? `${h.get('x-forwarded-proto') || 'https'}://${host}` : '')).replace(/\/$/, '');
}

export async function GET(req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const t = await tokenUser(params.token)
  if (!t || t.kind !== 'login') return NextResponse.redirect(`${base(req)}/login/link?expired=1`, 303)
  await q('update portal.auth_tokens set used_at = now() where id = $1 and used_at is null', [t.id])
  await signSession(t.user_id)
  await q('update portal.users set prev_login_at = last_login_at, last_login_at = now() where id = $1', [t.user_id])
  await audit(t.user_id, 'login.link')
  return NextResponse.redirect(`${base(req)}/refer`, 303)
}
