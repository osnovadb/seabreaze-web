import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
// О27 (обход 11.11): «Подобрать квартиру» из карточки клиента — клиент запоминается на сутки (cookie ge_pick)
// и стоит первым в выборе клиента на странице квартиры и в форме брони; дальше — каталог
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const res = NextResponse.redirect(new URL('/catalog', host ? `${proto}://${host}` : req.url))
  if (/^[0-9a-f-]{36}$/.test(id)) res.cookies.set('ge_pick', id, { path: '/', maxAge: 86400, sameSite: 'lax' })
  return res
}
