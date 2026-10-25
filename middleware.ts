import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC = ['/dev/', '/login', '/apply', '/s/', '/legal', '/plan/', '/img/', '/brand/', '/_next', '/favicon']
// За nginx/Cloudflare req.url указывает на 127.0.0.1:3040 — адрес для редиректа берём из заголовков прокси
const to = (req: NextRequest, path: string) => {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  return host ? new URL(path, `${proto}://${host}`) : new URL(path, req.url)
}
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname
  if (PUBLIC.some((x) => p.startsWith(x))) return NextResponse.next()
  if (!req.cookies.get('ge_s')) return NextResponse.redirect(to(req, '/login'))
  // В режиме показа клиенту рабочие разделы недоступны
  if (req.cookies.get('ge_show') && !p.startsWith('/show')) return NextResponse.redirect(to(req, '/show'))
  return NextResponse.next()
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] }
