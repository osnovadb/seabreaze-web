import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { ROLE_NAMES, isExternal, canReviewAgents, canSeeFinance, canSeeSources, canManageUsers, canSeeJournal } from '@/lib/perm'
import { Nav } from '@/components/Nav'
import { feed } from '@/lib/posts'
import { LangSwitch } from '@/components/LangSwitch'
import { impersonate, logout } from '@/lib/actions'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx()
  const u = c.user, T = (s: string) => t(c.lang, s)
  // 2.2 · рекомендателю — только его кабинет (§6 П9): рекомендации, уведомления, профиль
  if (u.role === 'referrer' && !['/refer', '/notifications', '/profile'].some((x) => (headers().get('x-path') || '').startsWith(x))) redirect('/refer')
  const cnt = await one<{ notif: number; req: number; apps: number; kyc: number; regs: number }>(`select
    (select count(*)::int from portal.notifications where user_id = $1 and not read) notif,
    (select count(*)::int from portal.bookings where status = 'requested') req,
    (select count(*)::int from portal.agent_applications where status in ('new','review') and ($2 = 'owner' or market = $3)) apps, /* как «Заявки агентов на проверке» на главной */
    (select count(*)::int from portal.clients where kyc_status = 'pending') kyc,
    (select count(*)::int from portal.registrations where status = 'to_send') regs`, [u.id, u.role, u.market])
  const ext = isExternal(u.role)
  const newsUnread = (await feed(u, { limit: 100 })).filter((p) => !p.read).length
  const items: { href: string; label: string; cnt?: number }[] = [{ href: '/', label: T('Главная'), cnt: cnt!.notif }]
  items.push({ href: '/news', label: T('Новости'), cnt: newsUnread })
  items.push({ href: '/projects', label: T('Проекты') }, { href: '/catalog', label: T('Каталог') })
  if (u.role !== 'finance' && u.role !== 'content') items.push({ href: '/clients', label: ext ? T('Клиенты') : T('CRM · клиенты') })
  if (u.role !== 'finance' && u.role !== 'content') items.push({ href: '/bookings', label: T('Брони'), cnt: u.role === 'office' || u.role === 'owner' ? cnt!.req : 0 })
  if (u.role !== 'finance' && u.role !== 'content' && u.role !== 'office') items.push({ href: '/selections', label: T('Подборки') })
  if (['office', 'owner', 'market_head'].includes(u.role)) items.push({ href: '/registrations', label: T('Регистрации'), cnt: u.role === 'market_head' ? 0 : cnt!.regs })
  if (u.role === 'office' || u.role === 'owner') items.push({ href: '/kyc', label: 'KYC', cnt: cnt!.kyc })
  if (u.role !== 'finance' && u.role !== 'content' && u.role !== 'office') items.push({ href: '/waitlist', label: T('Ожидание и поиски') })
  if (ext) items.push({ href: '/commission', label: T('Комиссия') })
  if (ext) items.push({ href: '/links', label: T('Мои ссылки') })
  if (u.role === 'agency_head') items.push({ href: '/team', label: T('Сотрудники') })
  if (['owner', 'market_head', 'seller'].includes(u.role)) items.push({ href: '/reports', label: T('Отчёты') })
  if (u.role === 'finance') items.push({ href: '/reports/plan', label: T('План и факт') })
  if (canSeeFinance(u.role)) items.push({ href: '/finance', label: T('Финансы') })
  if (canReviewAgents(u.role)) items.push({ href: '/admin/agents', label: T('Агенты'), cnt: cnt!.apps })
  if (u.role === 'owner' || u.role === 'office') items.push({ href: '/admin/objects', label: T('Объекты') })
  if (['owner', 'market_head', 'office'].includes(u.role)) items.push({ href: '/admin/leads', label: T('Заявки с сайтов') })
  if (canSeeSources(u.role)) items.push({ href: '/sources', label: T('Источники') })
  items.push({ href: '/materials', label: T('Материалы') })
  if (u.role === 'owner' || u.role === 'content') items.push({ href: '/admin/templates', label: T('Шаблоны') })
  if (canManageUsers(u.role) || u.role === 'market_head' || u.role === 'finance') items.push({ href: '/admin', label: T('Админка') })
  else if (canSeeJournal(u.role)) items.push({ href: '/admin/journal', label: T('Журнал') })
  if (u.role === 'referrer') items.splice(0, items.length, { href: '/refer', label: T('Рекомендации') }, { href: '/notifications', label: T('Уведомления'), cnt: cnt!.notif })
  const users = c.real.role === 'owner' ? await q<{ id: string; name: string; role: string }>('select id, name, role from portal.users where active order by role, name') : []
  const initials = u.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()
  // 2.2: внутри Bitrix24 (фрейм приложения) — без нашего левого меню: навигация — меню GetsEstate в Bitrix24
  if (cookies().get('ge_embed')?.value === '1') {
    // «Текущий клиент» вкладки Bitrix24: полоса сверху на всех экранах — подбор, шахматка, бронь идут для него
    const cid = cookies().get('ge_client')?.value
    const cur = cid && /^[0-9a-f-]{36}$/.test(cid) ? await one<{ id: string; name: string }>('select id, name from portal.clients where id = $1', [cid]) : null
    // меню раздела внутри фрейма — по роли (пункты левого меню Bitrix24 ведут в те же разделы)
    const R = u.role
    const em: [string, string, boolean][] = [['/catalog', 'Каталог', true], ['/registrations', 'Регистрации', ['owner', 'office', 'market_head'].includes(R)], ['/bookings', 'Брони', R !== 'finance' && R !== 'content'],
      ['/kyc', 'KYC', ['owner', 'office'].includes(R)], ['/admin/privacy', 'Согласия и данные', ['owner', 'office'].includes(R)], ['/admin/agents', 'Партнёры', ['owner', 'market_head'].includes(R)],
      ['/finance', 'Финансы', ['owner', 'finance', 'market_head'].includes(R)], ['/reports', 'Отчёты', ['owner', 'market_head'].includes(R)], ['/news', 'Новости', true], ['/admin', 'Админка', ['owner', 'market_head', 'finance'].includes(R)]]
    return <div className="app app--embed" style={{ display: "block" }}><div className="main" style={{ marginLeft: 0, width: "100%" }}>
      <nav className="row small" style={{ gap: 14, padding: '6px 24px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>{em.filter((x) => x[2]).map(([h, l]) => <Link key={h} href={h} style={{ color: 'var(--ink-2)' }}>{T(l)}</Link>)}</nav>
      {cur && <div className="banner" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 24px', background: 'var(--deep-3)', color: '#fff' }}>
        <span className="small">{T('Клиент')}: <b>{cur.name}</b></span>
        <Link href={`/b24/units/${cur.id}`} className="small" style={{ color: '#fff', textDecoration: 'underline' }}>{T('← Units')}</Link>
        <Link href={`/b24/units/${cur.id}?tab=pick`} className="small" style={{ color: '#fff' }}>{T('Подбор')}</Link>
        <Link href={`/b24/units/${cur.id}?tab=units`} className="small" style={{ color: '#fff' }}>{T('Квартиры клиента')}</Link>
      </div>}
      {children}</div></div>
  }
  return (
    <div className="app">
      <aside className="side">
        <div className="side__logo"><img src="/brand/wordmark-white.svg" alt="GetsEstate" /></div>
        <div className="side__role">{T('Портал')} · {T(ROLE_NAMES[u.role])}{u.market && u.market !== 'GLOBAL' ? ' · ' + u.market : ''}</div>
        <Nav items={items} />
        <div className="side__foot">
          <LangSwitch lang={c.lang} order={ext && u.market === 'IL' ? ['he', 'en', 'ru', 'de'] : ext ? ['de', 'en', 'ru', 'he'] : ['ru', 'en', 'de', 'he']} />
          {c.real.role === 'owner' && (
            <form action={impersonate} className="stack" style={{ gap: 6 }}>
              <span className="tiny" style={{ color: 'var(--mist-2)' }}>{T('Войти как (тест ролей)')}</span>
              <select name="user" className="in" defaultValue={u.id} style={{ height: 32, background: 'var(--deep-2)', color: '#fff', borderColor: '#1F5D5B', fontSize: 12.5 }}>
                {users.map((x) => <option key={x.id} value={x.id}>{x.name} · {T(ROLE_NAMES[x.role as keyof typeof ROLE_NAMES])}</option>)}
              </select>
              <button className="btn btn--sm">{T('Переключить')}</button>
            </form>
          )}
          <Link href="/profile" className="me" title={T('Профиль')}><span className="ava">{initials}</span><span style={{ flex: 1 }}>{u.name}</span><span className="tiny" style={{ color: 'var(--mist-2)' }}>{T('Профиль')}</span></Link>
          <form action={logout}><button className="tiny" style={{ color: 'var(--mist-2)' }}>{T('Выйти')}</button></form>
        </div>
      </aside>
      <div className="main">
        {c.impersonating && (
          <div className="banner banner--imp">
            {T('Вы смотрите портал глазами')} <b>{u.name}</b> ({T(ROLE_NAMES[u.role])}). {process.env.ALLOW_IMPERSONATE_WRITE === '1' ? T('Тестовый стенд: действия разрешены и пишутся в журнал от вашего имени.') : T('Только просмотр: действовать от имени пользователя нельзя.')}
            <form action={impersonate}><input type="hidden" name="user" value={c.real.id} /><button className="btn btn--sm">{T('Вернуться к себе')}</button></form>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
