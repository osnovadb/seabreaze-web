// 2.2 · «Текущий клиент» внутри Bitrix24: запоминаем клиента вкладки (partitioned cookie — только во фрейме) и ведём в Units
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const u = new URL(req.url)
  const id = u.searchParams.get('client') || ''
  const base = process.env.PUBLIC_URL || `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`
  // QA 09.11: «выйти из клиента» — сбросить текущего клиента фрейма и вернуться (только на свои пути)
  if (u.searchParams.get('clear') === '1') {
    const to = u.searchParams.get('to') || '/catalog'
    const res = NextResponse.redirect(new URL(to.startsWith('/') && !to.startsWith('//') ? to : '/catalog', base), 303)
    res.cookies.set({ name: 'ge_client', value: '', path: '/', maxAge: 0, secure: true, sameSite: 'none', partitioned: true } as any)
    return res
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.redirect(new URL('/catalog', base), 303)
  const res = NextResponse.redirect(new URL(`/b24/units/${id}?embed=1`, base), 303)
  res.cookies.set({ name: 'ge_client', value: id, path: '/', maxAge: 12 * 3600, secure: true, sameSite: 'none', partitioned: true } as any)
  return res
}
