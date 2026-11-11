import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC = ['/c/', '/k/', '/api/b24/robot', '/api/leads/', '/api/internal/', '/api/feed/', '/l/', '/r/', '/dev/', '/login', '/forgot', '/set-password/', '/apply', '/s/', '/legal', '/plan/', '/img/', '/brand/', '/_next', '/favicon']
// За nginx/Cloudflare req.url указывает на 127.0.0.1:3040 — адрес для редиректа берём из заголовков прокси
const to = (req: NextRequest, path: string) => {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  return host ? new URL(path, `${proto}://${host}`) : new URL(path, req.url)
}
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname
  if (PUBLIC.some((x) => p.startsWith(x))) {
    // QA 10.11 (WCAG, р. 273): у страницы подборки <html lang> — язык подборки; макету нужен путь
    // О4 (обход 11.11): язык и направление публичных страниц (/c/, /r/, /legal, /apply) — по самой странице, не по cookie
    if (!['/s/', '/c/', '/r/', '/legal', '/apply'].some((x) => p.startsWith(x))) return NextResponse.next()
    const h = new Headers(req.headers); h.set('x-path', p); h.set('x-lang', req.nextUrl.searchParams.get('lang') || '')
    return NextResponse.next({ request: { headers: h } })
  }
  // Bitrix24: обработчик приложения и установки принимают POST без нашей cookie — сотрудника проверяем через user.current
  if (p === '/b24' || p === '/b24/install') return NextResponse.next()
  if (!req.cookies.get('ge_s')) return NextResponse.redirect(to(req, '/login'))
  // В режиме показа клиенту рабочие разделы недоступны
  if (req.cookies.get('ge_show')?.value && !p.startsWith('/show')) return NextResponse.redirect(to(req, '/show'))
  // путь — в заголовке запроса: макет закрывает рекомендателю всё, кроме его кабинета
  const h = new Headers(req.headers)
  h.set('x-path', p)
  // Б9: клиент вкладки Bitrix24 — из адреса: ?cl= или карточка клиента /b24/units/<id>
  const cl = req.nextUrl.searchParams.get('cl') || (p.match(/^\/b24\/units\/([0-9a-f-]{36})/) || [])[1] || ''
  if (/^[0-9a-f-]{36}$/.test(cl)) h.set('x-cl', cl); else h.delete('x-cl')
  return NextResponse.next({ request: { headers: h } })
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] }
