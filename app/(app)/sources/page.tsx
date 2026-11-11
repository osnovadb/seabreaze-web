import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { canSeeSources } from '@/lib/perm'
import { Top, Pill } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { savePbSource, runPbSource, saveStatusMap, retryPbOutbox, unlockUnits } from '@/lib/sourceActions'

export default async function Sources() {
  const c = await requireCtx()
  if (!canSeeSources(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const src = await q<{ id: string; kind: string; name: string; last_sync_at: string | null; last_sync_status: string | null; units: number; synced: string | null }>(
    `select s.id, s.kind, s.name, s.last_sync_at, s.last_sync_status, (select count(*)::int from units u where u.source_id = s.id) units,
       (select max(u.synced_at) from units u where u.source_id = s.id) synced from sources s order by s.id`)
  const lka = await q<{ n: number; at: string }>(`select count(*)::int n, max(raw->'lka'->>'snapshot') at from units where raw ? 'lka'`)
  const runs = await q<{ source_id: string; started_at: string; finished_at: string | null; status: string; stats: { checked?: number; changed?: number; created?: number; gone?: number; floors?: number; errors?: string[] } | null; error: string | null }>('select source_id, started_at, finished_at, status, stats, error from sync_runs order by started_at desc limit 20')
  // Profitbase (М1, М11): подключения, очередь записи броней и продаж, сопоставление статусов
  const locks = new Map((await q<{ source_id: string; status: number; price: number }>(`select source_id, count(*) filter (where locked_fields ? 'status')::int status, count(*) filter (where locked_fields ? 'price_list')::int price from units where jsonb_array_length(locked_fields) > 0 group by source_id`)).map((r) => [r.source_id, r]))
  const pbs = await q<{ id: string; name: string; active: boolean; config: { account?: string; base_url?: string; key_env?: string; projects?: Record<string, string>; houses?: Record<string, string>; reserve_status?: string; sold_status?: string; currency?: string }; last_sync_at: string | null; last_sync_status: string | null }>(`select id, name, active, config, last_sync_at, last_sync_status from sources where kind = 'profitbase' order by id`)
  const outbox = await q<{ id: string; source_id: string; op: string; status_alias: string; state: string; attempts: number; last_error: string | null; created_at: string; no: string }>(`select o.id, o.source_id, o.op, o.status_alias, o.state, o.attempts, o.last_error, o.created_at, portal.unit_no(b.external_id, u.number) no
    from portal.pb_outbox o join units u on u.id = o.unit_id join buildings b on b.id = u.building_id order by o.created_at desc limit 30`)
  const smap = await q<{ source_id: string; external_status: string; status: string }>(`select m.source_id, m.external_status, m.status from status_map m join sources s on s.id = m.source_id where s.kind = 'profitbase' order by m.source_id, m.external_status`)
  const owner = c.user.role === 'owner'
  const keyOk = (k?: string) => !!(k && process.env[k])
  const conflicts = await q<{ unit: string; status: string; client: string }>(`select portal.unit_no(bl.external_id, un.number) unit, un.status, cl.name client from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id join portal.clients cl on cl.id = b.client_id where b.status in ('requested','confirmed') and un.status <> 'available'`)
  return (
    <>
      <Top title={T('Источники данных')} sub={T('Откуда берутся квартиры, цены и статусы и когда они последний раз подтверждены')} />
      <div className="page">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Источник', 'Тип', 'Квартир', 'Подтверждено', 'Статус'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {src.map((s) => <tr key={s.id}><td><b>{s.name}</b><div className="tiny muted">{s.id}</div></td><td>{s.kind}</td><td>{s.units}</td><td className="small">{dateTime(L, s.synced || s.last_sync_at)}</td><td>{s.last_sync_status === 'ok' ? <Pill kind="ok">ok</Pill> : <Pill kind="off">{s.last_sync_status || '—'}</Pill>}</td></tr>)}
            <tr><td><b>{T('Кабинет агента Profitbase · Premium')}</b><div className="tiny muted">pr:lka-manual-231026</div></td><td>{T('ручной снимок')}</td><td>{lka[0].n}</td><td className="small">{lka[0].at}</td><td><Pill kind="warn">{T('устаревает — нужен API-ключ')}</Pill></td></tr>
          </tbody>
        </table></div>
        <div className="h3 mt24">Profitbase API v4</div>
        {pbs.length === 0 && <div className="card small muted">{T('Подключений Profitbase пока нет. Когда застройщик выдаст ключ API: ключ — в настройки сервера (переменная окружения), здесь — аккаунт и сопоставление проектов.')}</div>}
        <div className="grid g2" style={{ alignItems: 'start' }}>
          {pbs.map((p) => (
            <div key={p.id} className="card stack" style={{ gap: 8 }}>
              <div className="between"><b>{p.name}</b><span className="row" style={{ gap: 6 }}>{!p.active && <Pill kind="off">{T('выключен')}</Pill>}<Pill kind={p.last_sync_status === 'ok' ? 'ok' : p.last_sync_status === 'partial' ? 'warn' : p.last_sync_status === 'failed' ? 'bad' : 'off'}>{p.last_sync_status || T('не запускался')}</Pill></span></div>
              <div className="tiny muted">{p.id} · {p.config.account || p.config.base_url} · {T('ключ')} {p.config.key_env}: {keyOk(p.config.key_env) ? <span className="okc">{T('задан')}</span> : <span className="badc">{T('не задан на сервере')}</span>} · {T('последний прогон')} {dateTime(L, p.last_sync_at)}</div>
              <div className="small">{T('Проекты')}: {Object.entries(p.config.projects || {}).map(([k, v]) => `${k} → ${v}`).join(', ') || '—'}</div>
              <ActionForm action={runPbSource} lang={L} okText={T('Прогон завершён, изменено квартир')} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={p.id} />
                <button className="btn btn--sm btn--p">{T('Запустить сейчас')}</button>
                <label className="check"><input type="checkbox" name="full" value="1" /> <span className="small">{T('со статусами и планами этажей')}</span></label>
              </ActionForm>
              {locks.get(p.id) && !c.impersonating && <form action={unlockUnits} className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input type="hidden" name="source" value={p.id} />
                <span title={T('Ручная правка в портале фиксирует поле: синхронизация его не меняет. «Продано» у застройщика снимает замок статуса само.')}>🔒 {T('Ручные правки: статус — {s}, цена — {p}', { s: locks.get(p.id)!.status, p: locks.get(p.id)!.price })}</span>
                <select className="in" name="field" style={{ width: 'auto' }} defaultValue=""><option value="">{T('все поля')}</option><option value="status">{T('статус')}</option><option value="price_list">{T('цена')}</option></select>
                <button className="btn btn--sm">{T('Вернуть синхронизацию')}</button>
              </form>}
              {owner && <details><summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Настройки')}</summary><PbForm v={p} /></details>}
            </div>
          ))}
          {owner && <details className="card"><summary className="h3" style={{ cursor: 'pointer', margin: 0 }}>+ {T('Подключить Profitbase')}</summary><PbForm /></details>}
        </div>
        {smap.length > 0 && <form action={saveStatusMap} className="card mt16 stack" style={{ gap: 6 }}>
          <div className="h3" style={{ margin: 0 }}>{T('Статусы застройщика → наши')}</div>
          <div className="tiny muted">{T('Новый статус застройщика без сопоставления считается «не в продаже». Базовые статусы Profitbase сопоставлены сразу.')}</div>
          <input type="hidden" name="source" value={smap[0].source_id} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{smap.map((m) => <label key={m.source_id + m.external_status} className="field"><span>{m.source_id} · {m.external_status}</span>
            <select key={`st:${m.external_status}:${String(m.status)}`} className="in" name={'st:' + m.external_status} defaultValue={m.status} disabled={!owner}>{[['available', 'свободна'], ['reserved', 'бронь застройщика'], ['sold', 'продана'], ['unavailable', 'не в продаже']].map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select></label>)}</div>
          {owner && <div><button className="btn btn--sm">{T('Сохранить')}</button></div>}
        </form>}
        {outbox.length > 0 && <div className="card mt16">
          <div className="h3">{T('Запись в Profitbase: брони и продажи')}</div>
          {outbox.map((o) => <div key={o.id} className="kv"><span style={{ color: 'var(--ink)' }}>{o.no} · {T(o.op === 'reserve' ? 'поставить бронь' : o.op === 'release' ? 'снять бронь' : 'продано')} → {o.status_alias}<div className="tiny muted">{dateTime(L, o.created_at)} · {o.source_id}{o.last_error ? ' · ' + o.last_error : ''}</div></span>
            <span className="row" style={{ gap: 6 }}><Pill kind={o.state === 'sent' ? 'ok' : o.state === 'error' ? 'bad' : o.state === 'skipped' ? 'off' : 'warn'}>{o.state}{o.attempts ? ' · ' + o.attempts : ''}</Pill>{owner && ['error', 'skipped'].includes(o.state) && <form action={retryPbOutbox}><input type="hidden" name="id" value={o.id} /><button className="btn btn--sm">{T('Повторить')}</button></form>}</span></div>)}
        </div>}
        <div className="grid g2 mt16">
          <div className="card"><div className="h3">{T('Журнал синхронизаций')}</div>{runs.map((r, i) => <div key={i} className="kv"><span style={{ color: 'var(--ink)' }}>{dateTime(L, r.started_at)}<div className="tiny muted">{r.source_id}</div></span><span className={'small ' + (r.status === 'ok' ? 'okc' : r.status === 'failed' ? 'badc' : 'warnc')}>{r.status}{r.stats?.checked != null ? ` · ${T('проверено')} ${r.stats.checked}, ${T('изменено')} ${r.stats.changed || 0}${r.stats.created ? ', ' + T('новых') + ' ' + r.stats.created : ''}${r.stats.gone ? ', ' + T('исчезло') + ' ' + r.stats.gone : ''}${r.stats.floors ? ', ' + T('планов этажей') + ' ' + r.stats.floors : ''}` : ''}{r.error ? <div className="tiny badc">{r.error}</div> : null}{r.stats?.errors?.length ? <div className="tiny warnc">{r.stats.errors.slice(0, 3).join('; ')}</div> : null}</span></div>)}</div>
          <div className="card"><div className="h3">{T('Конфликты: наша бронь, а у застройщика не свободно')}</div>{conflicts.length === 0 ? <div className="small muted">{T('Конфликтов нет')}</div> : conflicts.map((x, i) => <div key={i} className="kv"><span>{x.unit} · {x.client}</span><span className="badc small">{x.status}</span></div>)}
            <div className="tiny muted mt16">{T('Новый снимок или xlsx сначала показывается как предпросмотр изменений и применяется после подтверждения; ручные правки команды не перетираются. Загрузка xlsx — следующий шаг.')}</div></div>
        </div>
      </div>
    </>
  )
}

// Форма подключения Profitbase: аккаунт (или адрес API — для заглушки), имя переменной с ключом, сопоставление проектов и домов
function PbForm({ v }: { v?: { id: string; name: string; active: boolean; config: { account?: string; base_url?: string; key_env?: string; projects?: Record<string, string>; houses?: Record<string, string>; reserve_status?: string; sold_status?: string; currency?: string } } }) {
  return (
    <ActionForm action={savePbSource} lang={'ru'} className="stack mt8" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="in" name="id" defaultValue={v?.id || 'pb:'} readOnly={!!v} placeholder="pb:seabreeze" style={{ flex: 1 }} />
        <input className="in" name="name" defaultValue={v?.name} placeholder="Sea Breeze · Profitbase" style={{ flex: 2 }} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="in" name="account" defaultValue={v?.config.account} placeholder="pb21387" style={{ flex: 1 }} />
        <input className="in" name="base_url" defaultValue={v?.config.base_url} placeholder="https://… (заглушка)" style={{ flex: 2 }} />
        <input className="in" name="key_env" defaultValue={v?.config.key_env} placeholder="PB_KEY_SEABREEZE" style={{ flex: 2 }} />
      </div>
      <input className="in" name="projects" defaultValue={JSON.stringify(v?.config.projects || {})} placeholder='{"7001": "premium-residence"}' />
      <input className="in" name="houses" defaultValue={JSON.stringify(v?.config.houses || {})} placeholder='{"8001": "A"}' />
      <div className="row" style={{ gap: 6 }}>
        <input className="in" name="reserve_status" defaultValue={v?.config.reserve_status || 'BOOKED'} placeholder="BOOKED" style={{ flex: 1 }} />
        <input className="in" name="sold_status" defaultValue={v?.config.sold_status || 'SOLD'} placeholder="SOLD" style={{ flex: 1 }} />
        <select key={`currency:${String(v?.config.currency || 'USD')}`} className="in" name="currency" defaultValue={v?.config.currency || 'USD'} style={{ flex: 1 }}>{['USD', 'AZN', 'EUR'].map((x) => <option key={x}>{x}</option>)}</select>
        <select key={`active:${String(v && !v.active ? '0' : '1')}`} className="in" name="active" defaultValue={v && !v.active ? '0' : '1'} style={{ flex: 1 }}><option value="1">on</option><option value="0">off</option></select>
      </div>
      <div><button className="btn btn--sm btn--p">Сохранить</button></div>
      <div className="tiny muted">Ключ API — только в настройках сервера (portal.env), здесь — имя переменной. Дома сопоставляются по external_id корпуса или по названию; квартиры — по id Profitbase, в первый раз по номеру.</div>
    </ActionForm>
  )
}
