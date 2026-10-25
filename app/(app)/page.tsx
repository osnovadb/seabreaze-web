import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, dateTime, date, fmtVars } from '@/lib/i18n'
import { isExternal, canConfirmBooking, canSeeFinance } from '@/lib/perm'
import { clientScope, bookingScope } from '@/lib/scope'
import { listProjects } from '@/lib/catalog'
import { split, type SplitCond } from '@/lib/money'
import { Top, AGENT_STAGES, STAGES } from '@/components/ui'
import { readAll, toggleTask, startShow } from '@/lib/actions'

export default async function Home() {
  const c = await requireCtx()
  const u = c.user, L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ext = isExternal(u.role)
  const cs = clientScope(u), bs = bookingScope(u)
  const clients = await q<{ id: string; name: string; stage: string; last_activity_at: string; protected_until: string; pause_until: string | null }>(
    `select id, name, stage, last_activity_at, protected_until, pause_until from portal.clients cl where ${cs.sql}`, cs.params)
  const bookings = await q<{ id: string; status: string; ends_at: string; unit: string; client: string; client_id: string; price_list: number; discount_pct: number; snapshot: SplitCond }>(
    `select b.id, b.status, b.ends_at, b.price_list::float, b.discount_pct::float, b.snapshot, coalesce(bl.external_id,'') || '-' || un.number as unit, cl.name as client, cl.id as client_id from portal.bookings b
     join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id
     where b.status in ('requested','confirmed') and ${bs.sql} order by b.ends_at`, bs.params)
  const deals = await q<{ id: string; stage: string; agent_amount: number; our_amount: number; final_price: number }>(
    `select d.id, d.stage, d.agent_amount::float, d.our_amount::float, d.final_price::float from portal.deals d join portal.bookings b on b.id = d.booking_id where d.stage <> 'cancelled' and ${bs.sql}`, bs.params)
  const notif = await q<{ id: string; text: string; vars: Record<string, string | number> | null; link: string | null; read: boolean; created_at: string }>('select id, text, vars, link, read, created_at from portal.notifications where user_id = $1 order by created_at desc limit 8', [u.id])
  const tasks = await q<{ id: string; title: string; vars: Record<string, string | number> | null; due: string | null; done: boolean; client_id: string | null; client: string | null }>(
    `select t.id, t.title, t.vars, t.due, t.done, t.client_id, cl.name as client from portal.tasks t left join portal.clients cl on cl.id = t.client_id where t.user_id = $1 and not t.done order by t.due nulls last limit 8`, [u.id])
  const sel = await one<{ n: number }>(`select count(*)::int n from portal.selections s join portal.clients cl on cl.id = s.client_id where ${cs.sql} and s.last_opened_at > now() - interval '7 days'`, cs.params)
  const projects = await listProjects(u)
  // Изменения в каталоге с прошлого входа (прототип 2): по видимым проектам; без прошлого входа — за неделю
  const since = (await one<{ t: string }>(`select coalesce(prev_login_at, now() - interval '7 days')::text t from portal.users where id = $1`, [c.real.id]))!.t
  const pids = projects.map((p) => p.id)
  const changes = pids.length ? await one<{ prices: number; in_sel: number; freed: number; opened: number }>(`select
      (select count(distinct ph.unit_id)::int from price_history ph join units u on u.id = ph.unit_id where u.project_id = any($1) and ph.changed_at > $2 and exists (select 1 from price_history p0 where p0.unit_id = ph.unit_id and p0.changed_at < ph.changed_at and p0.price is not null)) prices,
      (select count(distinct ph.unit_id)::int from price_history ph join portal.selection_items si on si.unit_id = ph.unit_id join portal.selections se on se.id = si.selection_id
         where se.user_id = $3 and ph.changed_at > $2 and ph.changed_at > si.created_at and exists (select 1 from price_history p0 where p0.unit_id = ph.unit_id and p0.changed_at < ph.changed_at)) in_sel,
      (select count(*)::int from units u where u.project_id = any($1) and u.updated_at > $2 and u.status = 'available' and u.price_list is not null
         and not exists (select 1 from portal.bookings b where b.unit_id = u.id and b.status in ('requested','confirmed'))) freed,
      (select count(*)::int from portal.project_settings ps where ps.project_id = any($1) and ps.updated_at > $2 and ps.sales_status = 'sales') opened`, [pids, since, u.id]) : null
  const apps = await one<{ n: number }>(`select count(*)::int n from portal.agent_applications where status in ('new','review') and ($1 = 'owner' or market = $2)`, [u.role, u.market])
  const disp = ['owner', 'market_head'].includes(u.role) ? await one<{ n: number }>(`select count(*)::int n from portal.disputes d join portal.clients cl on cl.id = d.client_id where d.status = 'open' ${u.role === 'market_head' ? 'and cl.market = $1' : ''}`, u.role === 'market_head' ? [u.market] : []) : null
  const appr = ['owner', 'market_head'].includes(u.role) ? await one<{ n: number }>(`select count(*)::int n from portal.bookings b join portal.clients cl on cl.id = b.client_id where b.approval = 'pending' and b.status = 'requested' ${u.role === 'market_head' ? 'and cl.market = $1' : ''}`, u.role === 'market_head' ? [u.market] : []) : null

  const active = clients.filter((x) => !x.pause_until && !['handed'].includes(x.stage))
  const now = Date.now()
  const attention: { kind: 'bad' | 'warn' | 'ok'; title: string; sub: string; href: string }[] = []
  for (const b of bookings) {
    const days = Math.ceil((new Date(b.ends_at).getTime() - now) / 86400000)
    if (days <= 3) attention.push({ kind: 'bad', title: T('Бронь {u} истекает через {d} дн.', { u: b.unit, d: days }), sub: b.client, href: '/bookings' })
    if (b.status === 'requested' && canConfirmBooking(u.role)) attention.push({ kind: 'warn', title: T('Бронь {u} ждёт подтверждения у застройщика', { u: b.unit }), sub: b.client, href: '/bookings' })
  }
  for (const cl of active) {
    const idle = Math.floor((now - new Date(cl.last_activity_at).getTime()) / 86400000)
    if (idle >= 30) attention.push({ kind: 'warn', title: T('Нет активности {d} дн.', { d: idle }), sub: cl.name, href: `/clients/${cl.id}` })
    const left = Math.ceil((new Date(cl.protected_until).getTime() - now) / 86400000)
    if (ext && left <= 14) attention.push({ kind: 'bad', title: T('Защита клиента заканчивается через {d} дн.', { d: left }), sub: cl.name, href: `/clients/${cl.id}` })
  }
  if (!ext && apps!.n && ['owner', 'market_head', 'seller'].includes(u.role)) attention.push({ kind: 'warn', title: T('Заявки агентов на проверке: {n}', { n: apps!.n }), sub: T('Проверить и ответить за 2 рабочих дня'), href: '/admin/agents' })
  if (disp?.n) attention.push({ kind: 'bad', title: T('Споры «чей клиент»: {n}', { n: disp.n }), sub: T('Решение по журналу'), href: '/admin/disputes' })
  if (appr?.n) attention.push({ kind: 'warn', title: T('Скидки на согласовании: {n}', { n: appr.n }), sub: T('Бронь ждёт вашего решения'), href: '/bookings' })

  const funnel = ext
    ? AGENT_STAGES.map(([k, l, sts]) => [l, active.filter((x) => sts.includes(x.stage)).length] as [string, number])
    : STAGES.map(([k, l]) => [l, active.filter((x) => x.stage === k).length] as [string, number]).filter(([, n], i) => n || i < 9)
  const maxF = Math.max(1, ...funnel.map(([, n]) => n))
  // Ожидаемая комиссия агента: сделки в работе + активные брони по снимку условий
  const agentSum = deals.reduce((a, d) => a + d.agent_amount, 0) + bookings.reduce((a, b) => a + split(b.snapshot, b.price_list, b.discount_pct).agent, 0), ourSum = deals.reduce((a, d) => a + d.our_amount, 0)

  const kpis: [string, string | number][] = ext
    ? [[T('Клиентов в работе'), active.length], [T('Активных броней'), bookings.length], [T('Подборок открыто за неделю'), sel!.n], [T('Ожидаемая комиссия'), usd(L, agentSum)]]
    : u.role === 'office'
      ? [[T('Ждут подтверждения'), bookings.filter((b) => b.status === 'requested').length], [T('Активных броней'), bookings.length], [T('Сделок в работе'), deals.length], [T('Клиентов'), clients.length]]
      : u.role === 'finance'
        ? [[T('Сделок в работе'), deals.length], [T('Оборот сделок'), usd(L, deals.reduce((a, d) => a + d.final_price, 0))], [T('Наш доход по сделкам'), usd(L, ourSum)], [T('К выплате агентам'), usd(L, agentSum)]]
        : u.role === 'content'
          ? [[T('Проектов'), projects.length], [T('Квартир в каталоге'), projects.reduce((a, p) => a + p.units, 0)], [T('Свободно'), projects.reduce((a, p) => a + p.free, 0)], [T('Языков'), 4]]
          : [[T('Клиентов в работе'), active.length], [T('Активных броней'), bookings.length], [T('Сделок в работе'), deals.length], [canSeeFinance(u.role) ? T('Наш доход по сделкам') : T('Заявок агентов'), canSeeFinance(u.role) ? usd(L, ourSum) : apps!.n]]

  const hour = new Date().getHours()
  const hello = hour < 12 ? T('Доброе утро') : hour < 18 ? T('Добрый день') : T('Добрый вечер')
  return (
    <>
      <Top title={`${hello}, ${u.name.split(' ')[0]}`} sub={new Intl.DateTimeFormat(L === 'ru' ? 'ru-RU' : L === 'de' ? 'de-DE' : L === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
        right={<>{(ext || ['seller', 'market_head', 'owner'].includes(u.role)) && <Link className="btn btn--p" href="/clients/new">+ {T('Клиент')}</Link>}<Link className="btn" href="/projects">{T('Шахматка')}</Link></>} />
      <div className="page">
        <div className="grid g4">{kpis.map(([a, b]) => <div key={a} className="card card--tight kpi"><div className="small muted">{a}</div><div className="v num">{b}</div></div>)}</div>
        <div className="grid g2 mt16">
          <div className="card">
            <div className="between"><div className="h3">{T('Требует внимания')}</div><span className="small muted">{attention.length}</span></div>
            <div className="mt8">
              {attention.length === 0 && <div className="muted small">{T('Сейчас ничего срочного')}</div>}
              {attention.slice(0, 7).map((a, i) => (
                <Link key={i} href={a.href} className="kv" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'inherit' }}><span className={a.kind === 'bad' ? 'badc' : a.kind === 'warn' ? 'warnc' : 'okc'}>● </span><b style={{ fontWeight: 600 }}>{a.title}</b><div className="small muted">{a.sub}</div></span>
                  <span className="small bronze">{T('Открыть →')}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="between"><div className="h3">{ext ? T('Моя воронка') : T('Воронка')}</div><Link className="small bronze" href="/clients">{T('Все клиенты →')}</Link></div>
            <div className="stack mt16" style={{ gap: 8 }}>
              {funnel.map(([l, n]) => (
                <div key={l} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 24px', gap: 10, alignItems: 'center' }}>
                  <span className="small">{T(l)}</span>
                  <span style={{ background: 'var(--sand)', borderRadius: 4, height: 20, display: 'block' }}><span style={{ display: 'block', height: 20, borderRadius: 4, background: '#A9C9BF', width: `${(n / maxF) * 100}%` }} /></span>
                  <span className="small num" style={{ fontWeight: 600 }}>{n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid g3 mt16">
          <div className="card">
            <div className="between"><div className="h3">{T('Уведомления')}</div><span className="row" style={{ gap: 10 }}><Link className="small bronze" href="/notifications">{T('Все')} →</Link><form action={readAll}><button className="small bronze">{T('Прочитать все')}</button></form></span></div>
            {notif.length === 0 && <div className="muted small mt8">{T('Пока пусто')}</div>}
            {notif.map((n) => <Link key={n.id} href={n.link || '/'} className="kv"><span style={{ color: n.read ? 'var(--muted)' : 'var(--ink)', fontWeight: n.read ? 400 : 600 }}>{T(n.text, fmtVars(L, n.vars))}</span><span className="tiny muted">{dateTime(L, n.created_at)}</span></Link>)}
          </div>
          <div className="card">
            <div className="h3">{T('Задачи')}</div>
            {tasks.length === 0 && <div className="muted small mt8">{T('Задач нет')}</div>}
            {tasks.map((x) => (
              <div key={x.id} className="kv">
                <form action={toggleTask.bind(null, x.id)} className="row" style={{ gap: 8 }}><button className="check" title="✓"><input type="checkbox" readOnly checked={x.done} /></button><span>{T(x.title, fmtVars(L, x.vars))}{x.client && <div className="small muted">{x.client}</div>}</span></form>
                <span className="small muted">{date(L, x.due)}</span>
              </div>
            ))}
          </div>
          {changes && (changes.prices + changes.freed + changes.opened > 0) && (
            <div className="card">
              <div className="h3">{T('Изменения в каталоге')}</div>
              <div className="tiny muted">{T('с прошлого входа')} · {dateTime(L, since)}</div>
              {changes.freed > 0 && <Link className="kv" href="/catalog"><span style={{ color: 'var(--ink)' }}>{T('Обновились и сейчас свободны: {n} квартир', { n: changes.freed })}</span><span className="small">→</span></Link>}
              {changes.prices > 0 && <div className="kv"><span style={{ color: 'var(--ink)' }}>{T('Изменились цены: {n} квартир', { n: changes.prices })}</span><span className={changes.in_sel ? 'small warnc' : 'small muted'}>{changes.in_sel ? T('{n} — в ваших подборках', { n: changes.in_sel }) : ''}</span></div>}
              {changes.opened > 0 && <Link className="kv" href="/projects"><span style={{ color: 'var(--ink)' }}>{T('Проекты в продаже обновлены: {n}', { n: changes.opened })}</span><span className="small">→</span></Link>}
            </div>
          )}
          <div className="card">
            <div className="h3">{T('Проекты')}</div>
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.slug}`} className="kv"><span style={{ color: 'var(--ink)' }}><b>{p.name}</b><div className="small muted">{T('{n} свободно', { n: p.free })} · {p.min_usd ? T('от {p}', { p: usd(L, p.min_usd) }) : ''}</div></span><span className="small bronze">→</span></Link>
            ))}
            {(ext || u.role === 'seller') && (
              <form action={startShow} className="stack mt16" style={{ gap: 8 }}>
                <div className="label">{T('Встреча с клиентом')}</div>
                <select className="in" name="client" defaultValue=""><option value="">{T('Без клиента')}</option>{clients.slice(0, 50).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <div className="row"><select className="in" name="lang" defaultValue={L} style={{ width: 90 }}>{['de', 'en', 'ru', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select><button className="btn btn--b" style={{ flex: 1 }}>{T('Режим показа клиенту')}</button></div>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
