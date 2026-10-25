import { NextResponse } from 'next/server'
import { one } from '@/lib/db'
import { signSession } from '@/lib/auth'

// Только для локальной разработки: войти тестовым пользователем без пароля. В production отключено.
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response('not found', { status: 404 })
  const as = new URL(req.url).searchParams.get('as') || ''
  const u = await one<{ id: string }>('select id from portal.users where email = $1', [as])
  if (!u) return new Response('no user', { status: 404 })
  await signSession(u.id)
  return NextResponse.redirect(new URL('/', req.url))
}
