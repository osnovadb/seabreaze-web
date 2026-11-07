// 2.2 · Установка локального приложения: вкладки Units в сделке и контакте, Selection в лиде (§12). Левое меню — сам Bitrix24 по настройке приложения.
import { NextResponse, type NextRequest } from 'next/server'
import { restApp, domainOk } from '@/lib/b24'
import { audit } from '@/lib/db'

export const dynamic = 'force-dynamic'
const TABS: [string, string][] = [['CRM_DEAL_DETAIL_TAB', 'Units'], ['CRM_CONTACT_DETAIL_TAB', 'Units'], ['CRM_LEAD_DETAIL_TAB', 'Selection']]

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const f = await req.formData()
  const domain = String(url.searchParams.get('DOMAIN') || f.get('DOMAIN') || '')
  const auth = String(f.get('AUTH_ID') || '')
  if (!domainOk(domain) || !auth) return new NextResponse('forbidden', { status: 403 })
  const handler = (process.env.PUBLIC_URL || `https://${req.headers.get('host')}`) + '/b24'
  const done: string[] = []
  for (const [p, title] of TABS) {
    try { await restApp(domain, auth, 'placement.unbind', { PLACEMENT: p, HANDLER: handler }) } catch {}
    try { await restApp(domain, auth, 'placement.bind', { PLACEMENT: p, HANDLER: handler, TITLE: title, LANG_ALL: { en: { TITLE: title }, ru: { TITLE: title }, de: { TITLE: title } } }); done.push(p) } catch (e) { done.push(p + ': ' + String((e as Error).message).slice(0, 80)) }
  }
  await audit(null, 'b24.install', 'b24', domain, { done })
  return new NextResponse(`<!doctype html><meta charset="utf-8"><script src="//api.bitrix24.com/api/v1/"></script><body style="font-family:system-ui;padding:24px">GetsEstate: ${done.map((x) => x.replace(/</g, '')).join('<br>')}<script>BX24.init(function(){BX24.installFinish();});</script></body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
