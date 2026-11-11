import { NextResponse } from 'next/server'
import { isLang } from '@/lib/i18n'

export const dynamic = 'force-dynamic'

// Ревью 11.11: черновой язык (az) — без пункта в переключателе до вычитки носителем (Фуад).
// Включить: /dev/lang?l=az&to=/projects · выключить: /dev/lang?l=off. Только cookie ge_lang, профиль не меняется.
// Работает на QA-экземпляре и на тестовом стенде *.pdna.pro; в бою (portal.getsestate.com) — 404.
export async function GET(req: Request) {
  const stand = process.env.QA_MODE === '1' || /pdna\.pro/.test(process.env.PUBLIC_URL || '') || process.env.NODE_ENV !== 'production'
  if (!stand) return new Response('not found', { status: 404 })
  const sp = new URL(req.url).searchParams
  const l = sp.get('l') || ''
  const to = sp.get('to') || '/'
  const res = NextResponse.redirect(new URL(to.startsWith('/') ? to : '/', req.url))
  if (l === 'off') res.cookies.delete('ge_lang')
  else if (isLang(l)) res.cookies.set('ge_lang', l, { path: '/', maxAge: 30 * 86400, sameSite: 'lax' })
  return res
}
