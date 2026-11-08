import { NextResponse } from 'next/server'
import { one } from '@/lib/db'
import { signSession } from '@/lib/auth'

// Только для локальной разработки и QA-экземпляра (QA_MODE=1, открывается через SSH-туннель как localhost): войти тестовым пользователем без пароля.
// На стенде и в бою отключено.
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.QA_MODE !== '1') return new Response('not found', { status: 404 })
  const as = new URL(req.url).searchParams.get('as') || ''
  const u = await one<{ id: string }>('select id from portal.users where email = $1', [as])
  if (!u) return new Response('no user', { status: 404 })
  await signSession(u.id)
  const to = new URL(req.url).searchParams.get('to') || '/'
  return NextResponse.redirect(new URL(to.startsWith('/') ? to : '/', req.url))
}
