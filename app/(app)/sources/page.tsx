import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { canSeeSources } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'

export default async function Sources() {
  const c = await requireCtx()
  if (!canSeeSources(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const src = await q<{ id: string; kind: string; name: string; last_sync_at: string | null; last_sync_status: string | null; units: number; synced: string | null }>(
    `select s.id, s.kind, s.name, s.last_sync_at, s.last_sync_status, (select count(*)::int from units u where u.source_id = s.id) units,
       (select max(u.synced_at) from units u where u.source_id = s.id) synced from sources s order by s.id`)
  const lka = await q<{ n: number; at: string }>(`select count(*)::int n, max(raw->'lka'->>'snapshot') at from units where raw ? 'lka'`)
  const runs = await q<{ source_id: string; started_at: string; status: string; stats: unknown }>('select source_id, started_at, status, stats from sync_runs order by started_at desc limit 20')
  const conflicts = await q<{ unit: string; status: string; client: string }>(`select coalesce(bl.external_id,'') || '-' || un.number unit, un.status, cl.name client from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id where b.status in ('requested','confirmed') and un.status <> 'available'`)
  return (
    <>
      <Top title={T('Источники данных')} sub={T('Откуда берутся квартиры, цены и статусы и когда они последний раз подтверждены')} />
      <div className="page">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Источник', 'Тип', 'Квартир', 'Подтверждено', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {src.map((s) => <tr key={s.id}><td><b>{s.name}</b><div className="tiny muted">{s.id}</div></td><td>{s.kind}</td><td>{s.units}</td><td className="small">{dateTime(L, s.synced || s.last_sync_at)}</td><td>{s.last_sync_status === 'ok' ? <Pill kind="ok">ok</Pill> : <Pill kind="off">{s.last_sync_status || '—'}</Pill>}</td></tr>)}
            <tr><td><b>{T('Кабинет агента Profitbase · Premium')}</b><div className="tiny muted">pr:lka-manual-231026</div></td><td>{T('ручной снимок')}</td><td>{lka[0].n}</td><td className="small">{lka[0].at}</td><td><Pill kind="warn">{T('устаревает — нужен API-ключ')}</Pill></td></tr>
            <tr><td><b>Profitbase API v4 · Premium</b></td><td>API</td><td>—</td><td>—</td><td><Pill kind="off">{T('ждём ключ от застройщика')}</Pill></td></tr>
          </tbody>
        </table></div>
        <div className="grid g2 mt16">
          <div className="card"><div className="h3">{T('Журнал синхронизаций')}</div>{runs.map((r, i) => <div key={i} className="kv"><span style={{ color: 'var(--ink)' }}>{dateTime(L, r.started_at)}<div className="tiny muted">{r.source_id}</div></span><span className="small okc">{r.status} · {JSON.stringify(r.stats).slice(0, 60)}</span></div>)}</div>
          <div className="card"><div className="h3">{T('Конфликты: наша бронь, а у застройщика не свободно')}</div>{conflicts.length === 0 ? <div className="small muted">{T('Конфликтов нет')}</div> : conflicts.map((x, i) => <div key={i} className="kv"><span>{x.unit} · {x.client}</span><span className="badc small">{x.status}</span></div>)}
            <div className="tiny muted mt16">{T('Новый снимок или xlsx сначала показывается как предпросмотр изменений и применяется после подтверждения; ручные правки команды не перетираются. Загрузка xlsx — следующий шаг.')}</div></div>
        </div>
      </div>
    </>
  )
}
