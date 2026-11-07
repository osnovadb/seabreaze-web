// 2.2 · Обработчик локального приложения Bitrix24: левое меню (DEFAULT) и встройки во вкладки карточек.
// Bitrix24 присылает POST с AUTH_ID; сотрудника проверяем через user.current и сопоставляем с пользователем портала (b24_user_id или e-mail).
import { NextResponse, type NextRequest } from 'next/server'
import { q, one, audit } from '@/lib/db'
import { signSession } from '@/lib/auth'
import { restApp, domainOk, ensurePlacements, MENU } from '@/lib/b24'

export const dynamic = 'force-dynamic'
const TEAM = ['owner', 'market_head', 'seller', 'office', 'finance', 'content']
const base = (req: NextRequest) => process.env.PUBLIC_URL || `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`
const page = (title: string, text: string) => new NextResponse(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:32px;color:#1f1c18;background:#f5f1e8"><h2 style="font-weight:500">${title}</h2><p>${text}</p></body>`, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const f = await req.formData()
  const domain = String(url.searchParams.get('DOMAIN') || f.get('DOMAIN') || '')
  const auth = String(f.get('AUTH_ID') || '')
  const placement = String(f.get('PLACEMENT') || 'DEFAULT')
  let opts: Record<string, string> = {}
  try { opts = JSON.parse(String(f.get('PLACEMENT_OPTIONS') || '{}')) } catch {}
  if (!domainOk(domain) || !auth) return page('GetsEstate', 'Приложение открыто не из нашего Bitrix24.')
  let me: { ID: string; EMAIL?: string; NAME?: string; LAST_NAME?: string }
  try { me = await restApp(domain, auth, 'user.current') } catch { return page('GetsEstate', 'Bitrix24 не подтвердил сотрудника — обновите страницу.') }
  const u = await one<{ id: string; role: string; active: boolean }>(`select id, role, active from portal.users where b24_user_id = $1 or (b24_user_id is null and lower(email) = lower($2)) order by (b24_user_id = $1) desc nulls last limit 1`, [Number(me.ID), me.EMAIL || ''])
  if (!u || !u.active || !TEAM.includes(u.role)) return page('Нет доступа к модулю GetsEstate', `Сотрудник Bitrix24 ${me.NAME || ''} ${me.LAST_NAME || ''} (${me.EMAIL || 'без e-mail'}) не сопоставлен с ролью портала. Админ: «Настройки → Пользователи и роли».`)
  await q('update portal.users set b24_user_id = $2, last_login_at = now() where id = $1 and (b24_user_id is distinct from $2)', [u.id, Number(me.ID)])
  await signSession(u.id)
  // Админ открыл приложение — проверить и при нужде зарегистрировать вкладки (Bitrix24 не всегда вызывает адрес установки)
  if (u.role === 'owner') {
    const done = await ensurePlacements(domain, auth, base(req) + '/b24').catch((e) => ['error: ' + String((e as Error).message).slice(0, 120)])
    if (done?.length) await audit(u.id, 'b24.placements', 'b24', undefined, { done })
  }
  const lang = String(url.searchParams.get('LANG') || '').slice(0, 2)
  const id = String(opts.ID || '')
  // пункт левого меню (?go=) — раздел по роли; нет права — сообщение, а не чужой экран
  const go = url.searchParams.get('go') || ''
  if (go && MENU[go] && !MENU[go][2].includes(u.role)) return page('Нет доступа', `Раздел «${MENU[go][0]}» не для вашей роли.`)
  const landing = u.role === 'office' ? '/registrations' : u.role === 'finance' ? '/finance' : u.role === 'content' ? '/news' : '/catalog'
  const target = placement === 'CRM_DEAL_DETAIL_TAB' ? `/b24/deal/${id}` : placement === 'CRM_CONTACT_DETAIL_TAB' ? `/b24/contact/${id}` : placement === 'CRM_LEAD_DETAIL_TAB' ? `/b24/lead/${id}`
    : go && MENU[go] ? MENU[go][1] : landing
  await audit(u.id, 'b24.open', 'b24', placement, { id })
  const res = NextResponse.redirect(new URL(target + (target.includes('?') ? '&' : '?') + 'embed=1', base(req)), 303)
  // Partitioned: признак «внутри Bitrix24» живёт только во фрейме и не прячет меню в обычной вкладке портала
  res.cookies.set({ name: 'ge_embed', value: '1', path: '/', maxAge: 43200, secure: true, sameSite: 'none', partitioned: true } as any)
  if (['ru', 'en', 'de', 'he'].includes(lang)) res.cookies.set('ge_lang', lang, { sameSite: 'none', secure: true, path: '/', maxAge: 30 * 86400 })
  return res
}
// Открытие ссылки приложения GET-запросом (не из Bitrix24) — на вход портала
export async function GET(req: NextRequest) { return NextResponse.redirect(new URL('/login', base(req)), 303) }
