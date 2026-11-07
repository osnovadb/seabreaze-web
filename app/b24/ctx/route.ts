// 2.2 · «Текущий клиент» внутри Bitrix24: запоминаем клиента вкладки (partitioned cookie — только во фрейме) и ведём в Units
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const u = new URL(req.url)
  const id = u.searchParams.get('client') || ''
  const base = process.env.PUBLIC_URL || `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.redirect(new URL('/catalog', base), 303)
  const res = NextResponse.redirect(new URL(`/b24/units/${id}?embed=1`, base), 303)
  res.cookies.set({ name: 'ge_client', value: id, path: '/', maxAge: 12 * 3600, secure: true, sameSite: 'none', partitioned: true } as any)
  return res
}
