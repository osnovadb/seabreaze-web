import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date, dateTime, tzOf } from '@/lib/i18n'
import { leaveWaitlist, deleteSearch } from '@/lib/waitActions'
import { Top, Pill } from '@/components/ui'

// Ожидание и поиски (М12): мои места в листах ожидания и сохранённые поиски
export default async function Waitlist() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  const waits = await q<{ id: string; unit_id: string; unit: string; project: string; client: string | null; created_at: string; pos: number; free: boolean }>(`
    select w.id, w.unit_id, portal.unit_no(b.external_id, u.number) unit, p.name project, cl.name client, w.created_at,
      (select count(*)::int from portal.waitlist w2 where w2.unit_id = w.unit_id and w2.active and w2.created_at <= w.created_at) pos,
      (u.status = 'available' and not exists (select 1 from portal.bookings bk where bk.unit_id = u.id and bk.status in ('hold','queued','requested','confirmed','release_pending'))) free
    from portal.waitlist w join units u on u.id = w.unit_id join buildings b on b.id = u.building_id join projects p on p.id = u.project_id left join portal.clients cl on cl.id = w.client_id
    where w.user_id = $1 and w.active order by w.created_at`, [c.user.id])
  const searches = await q<{ id: string; name: string; filters: { project: string; rooms: number | null; max: number | null; outdoor: string | null }; slug: string; n: number; checked_at: string | null }>(`
    select s.id, s.name, s.filters, p.slug, cardinality(s.seen_ids) n, s.checked_at from portal.saved_searches s join projects p on p.id = (s.filters->>'project')::uuid where s.user_id = $1 and s.active order by s.created_at desc`, [c.user.id])
  const link = (x: (typeof searches)[number]) => '/catalog?' + new URLSearchParams(Object.entries({ p: x.slug, r: x.filters.rooms || '', max: x.filters.max || '', o: x.filters.outdoor || '' }).filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)])).toString()
  return (
    <>
      <Top title={T('Ожидание и поиски')} sub={T('Уведомим, когда квартира освободится или появятся новые подходящие')} />
      <div className="page grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="h3">{T('Лист ожидания')}</div>
          {waits.length === 0 && <div className="small muted">{T('Пусто. Встать в очередь можно в карточке занятой квартиры или в подборке.')}</div>}
          {waits.map((w) => (
            <div key={w.id} className="kv"><span><Link href={`/units/${w.unit_id}`}><b>{w.unit}</b></Link> <span className="small muted">{w.project}</span>{w.client && <div className="tiny muted">{T('для клиента {c}', { c: w.client })}</div>}<div className="tiny muted">{T('с {d}', { d: date(L, w.created_at) })}</div></span>
              <span className="row" style={{ gap: 6 }}>{w.free ? <Pill kind="ok">{T('свободна')}</Pill> : <Pill kind="warn">{T('{n}-й в очереди', { n: w.pos })}</Pill>}<form action={leaveWaitlist}><input type="hidden" name="id" value={w.id} /><button className="btn btn--sm" title={T('Убрать')}>×</button></form></span></div>
          ))}
        </div>
        <div className="card">
          <div className="h3">{T('Сохранённые поиски')}</div>
          {searches.length === 0 && <div className="small muted">{T('Пусто. Сохранить поиск можно в каталоге с фильтрами.')}</div>}
          {searches.map((x) => (
            <div key={x.id} className="kv"><span><Link href={link(x)}><b>{x.name}</b></Link><div className="tiny muted">{x.checked_at ? T('сейчас подходит: {n} · проверено {d}', { n: x.n, d: dateTime(L, x.checked_at, TZ) }) : T('проверим в течение 15 минут')}</div></span>
              <form action={deleteSearch}><input type="hidden" name="id" value={x.id} /><button className="btn btn--sm" title={T('Удалить')}>×</button></form></div>
          ))}
        </div>
      </div>
    </>
  )
}
