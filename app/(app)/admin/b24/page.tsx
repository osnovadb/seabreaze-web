import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, tzOf } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { b24Retry, b24RetryDead, b24PullNow } from '@/lib/b24Actions'

// 2.2 · §13 Обмен с Bitrix24: исходящая очередь (повторы, «переотправить»), журнал входящих событий, сотрудники без пользователя портала
const ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { pending: ['в очереди', 'warn'], running: ['отправляется', 'ink'], sent: ['доставлено', 'ok'], error: ['повтор', 'warn'], dead: ['не доставлено', 'bad'] }
const EV: Record<number, string> = { 2: 'лид из Bitrix24', 3: 'контакт изменён', 4: 'кандидат партнёра', 5: 'квалификация', 6: 'сделка команды', 14: 'расторжение', 15: 'стадия сделки партнёра', 17: 'комментарий', 21: 'сотрудник', 22: 'ответственный' }

export default async function B24Exchange(props: { searchParams: Promise<{ s?: string; tab?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (c.user.role !== 'owner') redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  const tab = searchParams.tab === 'in' ? 'in' : 'out'
  const st = ST[searchParams.s || ''] ? searchParams.s! : ''
  const jobs = await q<{ id: number; kind: string; method: string | null; notes: string[]; status: string; attempts: number; last_error: string | null; created_at: string; updated_at: string; client: string | null; client_id: string | null; reg_no: string | null }>(
    `select j.id, j.kind, j.method, j.notes, j.status, j.attempts, j.last_error, j.created_at, j.updated_at, cl.name client, cl.id client_id, cl.reg_no
     from portal.b24_jobs j left join portal.clients cl on cl.id = j.ref_id where ($1 = '' or j.status = $1) order by j.updated_at desc limit 100`, [st])
  const cnt = await q<{ status: string; n: number }>('select status, count(*)::int n from portal.b24_jobs group by 1')
  const inbox = await q<{ id: number; entity: string; b24_id: string; event: number | null; result: string; created_at: string; client: string | null; client_id: string | null }>(
    `select i.id, i.entity, i.b24_id::text, i.event, i.result, i.created_at, cl.name client, cl.id client_id from portal.b24_inbox i left join portal.clients cl on cl.id = i.client_id
     where i.result not in ('без изменений', 'без изменений для портала') order by i.created_at desc limit 100`)
  const kv = Object.fromEntries((await q<{ key: string; value: string; updated_at: string }>(`select key, value, updated_at from portal.kv where key like 'b24:%'`)).map((r) => [r.key, r]))
  const lastRun = kv['b24:last_run'] ? JSON.parse(kv['b24:last_run'].value) : null
  const unmatched: { id: number; name: string; email: string }[] = kv['b24:unmatched'] ? JSON.parse(kv['b24:unmatched'].value) : []
  const stale = !lastRun || Date.now() - new Date(lastRun.at).getTime() > 3600000
  const errs = lastRun ? Object.entries(lastRun).filter(([k]) => k.endsWith('_error')) : []
  const domain = (process.env.B24_DOMAINS || '').split(',')[0]?.trim()
  return (
    <>
      <Top crumbs={[[T('Админка'), '/admin'], [T('Обмен с Bitrix24')]]} title={T('Обмен с Bitrix24')} sub={T('Портал пишет в Bitrix24 через очередь с повторами, изменения из Bitrix24 забирает раз в минуту; каждое событие обрабатывается один раз')} />
      <div className="page stack">
        <AdminTabs lang={L} on="b24" role={c.user.role} />
        <div className="grid g3">
          <div className="card card--tight"><b>{T('Подключение')}</b> · {process.env.B24_WEBHOOK ? <span className="okc">{domain || 'Bitrix24'}</span> : <span className="warnc">{T('не подключён — нужен B24_WEBHOOK в настройках сервера')}</span>}</div>
          <div className="card card--tight"><b>{T('Последний обмен')}</b> · {lastRun ? <span className={stale ? 'badc' : 'okc'}>{dateTime(L, lastRun.at, TZ)}</span> : <span className="warnc">{T('ещё не было')}</span>}
            {lastRun && <div className="tiny muted">{T('сделок')}: {String(lastRun.b24_deals ?? 0)} · {T('лидов')}: {String(lastRun.b24_leads ?? 0)} · {T('контактов')}: {String(lastRun.b24_contacts ?? 0)} · {T('в очереди')}: {String(lastRun.queue_left ?? 0)}</div>}
            {errs.map(([k, v]) => <div key={k} className="tiny badc">{k}: {String(v)}</div>)}</div>
          <div className="card card--tight row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <form action={b24PullNow}><button className="btn btn--sm">{T('Забрать изменения сейчас')}</button></form>
            <form action={b24RetryDead}><button className="btn btn--sm btn--ghost">{T('Переотправить недоставленные')}</button></form>
          </div>
        </div>
        <div className="tabs"><a href="?tab=out" className={tab === 'out' ? 'on' : ''}>{T('Портал → Bitrix24')}</a><a href="?tab=in" className={tab === 'in' ? 'on' : ''}>{T('Bitrix24 → портал')}</a></div>
        {tab === 'out' ? <>
          <div className="chips"><a className={'chip' + (!st ? ' on' : '')} href="?tab=out">{T('Все')}</a>{Object.entries(ST).map(([k, [l]]) => <a key={k} className={'chip' + (st === k ? ' on' : '')} href={`?tab=out&s=${k}`}>{T(l)} <span className="n">{cnt.find((x) => x.status === k)?.n || 0}</span></a>)}</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{['Обновлено', 'Клиент', 'Что', 'Записи в ленту', 'Статус', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>{jobs.length === 0 ? <tr><td colSpan={6} className="muted">{T('Пусто')}</td></tr> : jobs.map((j) => (
              <tr key={j.id}><td className="small">{dateTime(L, j.updated_at, TZ)}</td>
                <td className="small">{j.client_id ? <a href={`/clients/${j.client_id}`}>{j.client}</a> : '—'} <span className="tiny muted">{j.reg_no}</span></td>
                <td className="tiny">{j.kind === 'call' ? j.method : T('лид, контакт и сделка клиента')}</td>
                <td className="tiny">{(j.notes || []).join(' · ') || '—'}</td>
                <td><Pill kind={ST[j.status][1]}>{T(ST[j.status][0])}</Pill>{j.attempts > 1 && <span className="tiny muted"> ×{j.attempts}</span>}{j.last_error && <div className="tiny badc" style={{ maxWidth: 360 }}>{j.last_error}</div>}</td>
                <td>{j.status !== 'running' && j.status !== 'pending' && <form action={b24Retry}><input type="hidden" name="id" value={j.id} /><button className="btn btn--sm btn--ghost">{T('Переотправить')}</button></form>}</td></tr>))}</tbody>
          </table></div>
        </> : <>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{['Получено', 'Bitrix24', 'Событие', 'Клиент', 'Что сделано'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{inbox.length === 0 ? <tr><td colSpan={5} className="muted">{T('Пусто')}</td></tr> : inbox.map((i) => (
              <tr key={i.id}><td className="small">{dateTime(L, i.created_at, TZ)}</td>
                <td className="small">{domain && i.entity !== 'comment' ? <a href={`https://${domain}/crm/${i.entity}/details/${i.b24_id}/`} target="_blank" rel="noreferrer">{i.entity} {i.b24_id}</a> : `${i.entity} ${i.b24_id}`}</td>
                <td className="tiny">{i.event ? `${i.event} · ${T(EV[i.event] || '')}` : '—'}</td>
                <td className="small">{i.client_id ? <a href={`/clients/${i.client_id}`}>{i.client}</a> : '—'}</td>
                <td className="tiny">{i.result}</td></tr>))}</tbody>
          </table></div>
          {unmatched.length > 0 && <div className="card card--tight"><b>{T('Сотрудники Bitrix24 без пользователя портала')}</b> <span className="tiny muted">({T('связываются по e-mail; роль задаёт админ в «Пользователях»')})</span>
            <div className="tiny" style={{ marginTop: 6 }}>{unmatched.map((u) => `${u.name || '—'}${u.email ? ' · ' + u.email : ''}`).join(' · ')}</div></div>}
        </>}
      </div>
    </>
  )
}
