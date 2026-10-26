import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, date, dateTime } from '@/lib/i18n'
import { canReviewAgents } from '@/lib/perm'
import { fmtSize } from '@/lib/files'
import { Top, Pill } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { reviewApplication, addApplicationFile } from '@/lib/actions'
import { CreateAccess } from '../../access'

const ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { new: ['новая', 'warn'], review: ['на проверке', 'warn'], contract: ['договор', 'ink'], approved: ['одобрена', 'ok'], rejected: ['отказ', 'bad'] }

// Карточка заявки на партнёрство: данные, документы (разрешение маклера, выписка), решение и создание доступа
export default async function Application({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  if (!canReviewAgents(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const a = await one<any>(`select a.*, r.name reviewer, u.name user_name from portal.agent_applications a left join portal.users r on r.id = a.reviewed_by left join portal.users u on u.id = a.user_id where a.id = $1`, [params.id])
  if (!a || (c.user.role !== 'owner' && a.market !== c.user.market)) notFound()
  const files = await q<{ file_id: string; filename: string; mime: string; size: number; created_at: string }>(`select af.file_id, f.filename, f.mime, f.size::int, af.created_at from portal.application_files af join portal.files f on f.id = af.file_id where af.application_id = $1 order by af.created_at`, [a.id])
  const curators = await q<{ id: string; name: string }>(`select id, name from portal.users where active and role in ('seller','market_head','owner') ${c.user.role === 'owner' ? '' : 'and market = $1'} order by name`, c.user.role === 'owner' ? [] : [c.user.market])
  const log = await q<{ action: string; created_at: string; who: string | null }>(`select x.action, x.created_at, w.name who from portal.audit x left join portal.users w on w.id = x.user_id where x.entity = 'application' and x.entity_id = $1 order by x.id desc limit 10`, [a.id])
  const canAccess = ['owner', 'market_head'].includes(c.user.role)
  const row = (l: string, v: string | null) => v ? <div className="kv"><span>{T(l)}</span><span style={{ textAlign: 'end' }}>{v}</span></div> : null
  return (
    <>
      <Top crumbs={[[T('Партнёры и заявки'), '/admin/agents'], [a.name]]} title={a.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}><Pill kind={ST[a.status][1]}>{T(ST[a.status][0])}</Pill><span className="small muted">{T(a.kind === 'agency' ? 'Агентство' : 'Частный агент')} · {a.market} · {T('заявка от {d}', { d: date(L, a.created_at) })}</span></span>} />
      <div className="page split">
        <div className="stack">
          <div className="card">
            <div className="h3">{T('Заявитель')}</div>
            {row('Компания', a.company)}{row('E-mail', a.email)}{row('Телефон', a.phone)}{row('Страна и город', a.city)}{row('Языки', a.languages)}
            {row('Разрешение на маклерскую деятельность', a.license)}{row('Клиентов в год (оценка)', a.volume)}{row('Как будете продавать', a.channels)}
          </div>
          <div className="card">
            <div className="h3">{T('Документы')}</div>
            {files.length === 0 && <div className="small muted">{T('Документы не приложены. Попросите прислать разрешение и выписку — и добавьте сюда.')}</div>}
            {files.map((f) => <a key={f.file_id} className="kv" href={`/files/${f.file_id}`} target="_blank" rel="noopener"><span style={{ color: 'var(--ink)' }}>{f.filename}</span><span className="small muted">{(f.mime.split('/').pop() || '').toUpperCase()} · {fmtSize(f.size)} · {date(L, f.created_at)}</span></a>)}
            <ActionForm action={addApplicationFile} lang={L} className="row mt8" style={{ gap: 6 }} reset>
              <input type="hidden" name="id" value={a.id} />
              <input className="in" type="file" name="file" required style={{ flex: 1, paddingTop: 6 }} />
              <button className="btn btn--sm">{T('Добавить документ')}</button>
            </ActionForm>
          </div>
        </div>
        <div className="stack">
          <form action={reviewApplication} className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Решение')}</div>
            <input type="hidden" name="id" value={a.id} />
            <select className="in" name="status" defaultValue={a.status}>{Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{T(l)}</option>)}</select>
            <textarea className="in" name="note" rows={3} defaultValue={a.note || ''} placeholder={T('Итог созвона, проверка лицензии, причина отказа…')} />
            <button className="btn btn--p">{T('Сохранить')}</button>
            {a.reviewer && <div className="tiny muted">{T('Проверял')}: {a.reviewer}</div>}
          </form>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Доступ')}</div>
            {a.user_id ? <div className="small">{T('Доступ создан')}: <Link className="bronze" href={`/admin/users/${a.user_id}`}>{a.user_name} →</Link></div>
              : canAccess && ['contract', 'approved'].includes(a.status) ? <CreateAccess lang={L} id={a.id} curators={curators} />
                : <div className="small muted">{T('Доступ создаётся после проверки: статус «договор» или «одобрена».')}</div>}
          </div>
          <div className="card">
            <div className="h3">{T('Журнал')}</div>
            {log.length === 0 && <div className="small muted">—</div>}
            {log.map((x, i) => <div key={i} className="kv"><span className="small"><code>{x.action}</code> · {x.who}</span><span className="tiny muted">{dateTime(L, x.created_at)}</span></div>)}
          </div>
        </div>
      </div>
    </>
  )
}
