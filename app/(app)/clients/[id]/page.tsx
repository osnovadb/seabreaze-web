import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, date, dateTime, usd, fmtVars } from '@/lib/i18n'
import { isExternal } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { Top, Pill, AGENT_STAGES, STAGES, stageName } from '@/components/ui'
import { StageStepper } from '@/components/StageStepper'
import { EditContacts } from './contacts'
import { TourForm, DocUpload } from './extra'
import { split, type SplitCond } from '@/lib/money'

const DOC_KINDS: Record<string, string> = { passport: 'паспорт', kyc: 'KYC', booking: 'бронь', contract: 'договор', payment: 'платёж', other: 'другое' }
import { addActivity, saveQualification, addTask, toggleTask, setKyc, fixation, transferClient, startShow, deleteClientDoc } from '@/lib/actions'

export default async function ClientCard({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ext = isExternal(c.user.role)
  const cs = clientScope(c.user)
  const cl = await one<any>(`select cl.*, us.name as owner_name, us.role as owner_role from portal.clients cl join portal.users us on us.id = cl.owner_id where cl.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, params.id])
  if (!cl) notFound()
  const acts = await q<{ id: string; kind: string; text: string; vars: Record<string, string | number> | null; internal: boolean; created_at: string; who: string | null }>(`select a.id, a.kind, a.text, a.vars, a.internal, a.created_at, u.name as who from portal.activities a left join portal.users u on u.id = a.user_id where a.client_id = $1 ${ext ? 'and not a.internal' : ''} order by a.created_at desc`, [cl.id])
  const tasks = await q<{ id: string; title: string; vars: Record<string, string | number> | null; due: string | null; done: boolean }>('select id, title, vars, due, done from portal.tasks where client_id = $1 order by done, due nulls last', [cl.id])
  const fixes = await q<{ project_id: string; name: string; status: string; protected_until: string | null }>(`select f.project_id, p.name, f.status, f.protected_until from portal.fixations f join projects p on p.id = f.project_id where f.client_id = $1`, [cl.id])
  const projects = await q<{ id: string; name: string }>('select id, name from projects order by sort, name')
  const sels = await q<{ id: string; title: string; opened: number; last_opened_at: string | null; n: number; lang: string }>(`select s.id, s.title, s.opened, s.last_opened_at, s.lang, (select count(*)::int from portal.selection_items i where i.selection_id = s.id) n from portal.selections s where s.client_id = $1 order by s.created_at desc`, [cl.id])
  const books = await q<{ id: string; unit: string; status: string; ends_at: string; final_price: number }>(`select b.id, coalesce(bl.external_id,'') || '-' || un.number unit, b.status, b.ends_at, b.final_price::float from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id where b.client_id = $1 order by b.created_at desc`, [cl.id])
  const owners = c.user.role === 'owner' || c.user.role === 'market_head' ? await q<{ id: string; name: string }>(`select id, name from portal.users where active and role in ('seller','agent','agency_head','market_head') order by name`) : []
  const agentIdx = AGENT_STAGES.findIndex(([, , s]) => s.includes(cl.stage))
  const teamIdx = STAGES.findIndex(([k]) => k === cl.stage)
  const fixMain = fixes[0]
  const docs = await q<{ id: string; file_id: string; kind: string; note: string | null; internal: boolean; created_by: string; created_at: string; filename: string }>(`select d.id, d.file_id, d.kind, d.note, d.internal, d.created_by, d.created_at, f.filename from portal.client_documents d join portal.files f on f.id = d.file_id where d.client_id = $1 ${ext ? 'and not d.internal' : ''} order by d.created_at desc`, [cl.id])
  const tours = acts.filter((a) => a.text.startsWith('Заявка на тур')).slice(0, 5)
  // Ожидаемая комиссия: партнёру — его доля, команде — наш доход; по активным броням (снимок условий) и сделкам в работе
  const activeB = await q<{ snapshot: SplitCond; price_list: number; discount_pct: number; agent_role: string }>(`select b.snapshot, b.price_list::float, b.discount_pct::float, u.role agent_role from portal.bookings b join portal.users u on u.id = b.agent_id where b.client_id = $1 and b.status in ('requested','confirmed')`, [cl.id])
  const dealSum = await one<{ d: number }>(`select coalesce(sum(case when $2 then agent_amount else our_amount end), 0)::float d from portal.deals where client_id = $1 and stage not in ('cancelled','paid_out')`, [cl.id, ext])
  const expected = activeB.reduce((a, b) => { const sp = split(b.snapshot, b.price_list, b.discount_pct, ['agent', 'agency_head'].includes(b.agent_role)); return a + (ext ? sp.agent : sp.ours) }, 0) + (dealSum?.d || 0)
  const hasDeal = await one(`select 1 from portal.deals where client_id = $1 and stage <> 'cancelled' limit 1`, [cl.id])
  return (
    <>
      <Top crumbs={[[ext ? T('Клиенты') : T('CRM · клиенты'), '/clients'], [cl.name]]} title={cl.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}>
          <Pill kind="ink">{cl.pause_until ? T('Пауза до {d}', { d: date(L, cl.pause_until) }) : cl.stage === 'lost' ? T('Отказ') : ext ? T((AGENT_STAGES[agentIdx] || ['', cl.stage])[1]) : stageName(L, cl.stage)}</Pill>
          <Pill kind="ok">{T('Закреплён до {d}', { d: date(L, cl.protected_until) })}</Pill>
          {fixMain && <Pill kind={fixMain.status === 'approved' ? 'ok' : fixMain.status === 'rejected' ? 'bad' : 'warn'}>{T('Фиксация у застройщика')}: {T(fixMain.status === 'approved' ? 'одобрена' : fixMain.status === 'rejected' ? 'отклонена' : 'ждём ответ')}</Pill>}
          {!ext && <Pill kind={cl.kyc_status === 'passed' ? 'ok' : 'off'}>KYC: {T(cl.kyc_status === 'passed' ? 'пройден' : cl.kyc_status === 'pending' ? 'на проверке' : cl.kyc_status === 'rejected' ? 'отказ' : 'не начат')}</Pill>}
          <span className="small muted">{cl.reg_no}{!ext ? ` · ${T('владелец')}: ${cl.owner_name}` : ''}</span>
        </span>}
        right={<>
          {cl.phone && <a className="btn" href={`https://wa.me/${cl.phone_norm}`} target="_blank">WhatsApp</a>}
          <Link className="btn" href="/projects">{T('Подобрать квартиру')}</Link>
          <form action={startShow}><input type="hidden" name="client" value={cl.id} /><input type="hidden" name="lang" value={['de', 'en', 'ru', 'he'].includes(cl.language) ? cl.language : L} /><button className="btn btn--b">{T('Показ клиенту')}</button></form>
        </>} />
      <div className="page">
        <StageStepper clientId={cl.id} name={cl.name} role={c.user.role} lang={L}
          steps={ext ? AGENT_STAGES.map(([k, l, sts]) => ({ key: k, label: T(l), target: sts[0] })) : STAGES.map(([k, l]) => ({ key: k, label: T(l), target: k }))}
          current={ext ? agentIdx : teamIdx}
          ctx={{ stage: cl.stage, paused: !!cl.pause_until, hasBooking: books.some((b) => ['requested', 'confirmed'].includes(b.status)), hasDeal: !!hasDeal, qualified: !!(cl.goal && cl.budget && cl.timeline) }} />
        <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }} className="mt16">
          <div className="stack">
            <div className="card">
              <div className="h3">{T('Клиент')}</div>
              <div className="kv"><span>{T('Телефон')}</span><span>{cl.phone || '—'}</span></div>
              <div className="kv"><span>E-mail</span><span className="small">{cl.email || '—'}</span></div>
              <div className="kv"><span>{T('Страна, язык')}</span><span>{[cl.country, (cl.language || '').toUpperCase()].filter(Boolean).join(' · ')}</span></div>
              <div className="kv"><span>{T('Источник')}</span><span>{cl.source || '—'}</span></div>
              <div className="kv"><span>{T('Согласие')}</span><span>{date(L, cl.consent_at)}</span></div>
              <EditContacts lang={L} cl={{ id: cl.id, name: cl.name, phone: cl.phone, email: cl.email, country: cl.country, language: cl.language }} />
            </div>
            <form action={saveQualification} className="card stack" style={{ gap: 10 }}>
              <div className="h3" style={{ margin: 0 }}>{T('Квалификация')}</div>
              <input type="hidden" name="client" value={cl.id} />
              {[['goal', 'Цель'], ['budget', 'Бюджет'], ['timeline', 'Срок покупки'], ['payment', 'Оплата'], ['interest', 'Интерес']].map(([k, l]) => <label key={k} className="field"><span>{T(l)}</span><input className="in" name={k} defaultValue={cl[k] || ''} /></label>)}
              <button className="btn">{T('Сохранить')}</button>
            </form>
          </div>
          <div className="stack">
            <div className="card">
              <div className="h3">{T('Задачи')}</div>
              {tasks.map((x) => <form key={x.id} action={toggleTask.bind(null, x.id)} className="kv"><button className="check" style={{ textAlign: 'start' }}><input type="checkbox" readOnly checked={x.done} /> <span style={{ textDecoration: x.done ? 'line-through' : 'none' }}>{T(x.title, fmtVars(L, x.vars))}</span></button><span className="small muted">{date(L, x.due)}</span></form>)}
              <form action={addTask} className="row mt8"><input type="hidden" name="client" value={cl.id} /><input className="in" name="title" placeholder={T('Новая задача')} style={{ flex: 1 }} /><input className="in" type="date" name="due" style={{ width: 150 }} /><button className="btn">+</button></form>
            </div>
            <div className="card">
              <div className="h3">{T('История')}</div>
              <form action={addActivity} className="stack" style={{ gap: 8 }}>
                <input type="hidden" name="client" value={cl.id} />
                <textarea className="in" name="text" placeholder={T('Звонок, сообщение или заметка…')} />
                <div className="row">
                  <select className="in" name="kind" style={{ width: 160 }}>{[['note', 'Заметка'], ['call', 'Звонок'], ['message', 'Сообщение'], ['meeting', 'Встреча'], ['email', 'Письмо']].map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select>
                  {!ext && <label className="check small"><input type="checkbox" name="internal" /> {T('Внутренний (агенту не видно)')}</label>}
                  <button className="btn btn--p" style={{ marginInlineStart: 'auto' }}>{T('Добавить')}</button>
                </div>
              </form>
              <div className="mt16">
                {acts.map((a) => (
                  <div key={a.id} className="kv" style={{ alignItems: 'flex-start', background: a.internal ? 'var(--warn-bg)' : undefined, padding: a.internal ? '9px 8px' : undefined, borderRadius: 6 }}>
                    <span style={{ color: 'var(--ink)' }}><span className="tiny muted">{T({ note: 'Заметка', call: 'Звонок', message: 'Сообщение', meeting: 'Встреча', email: 'Письмо', system: 'Система' }[a.kind] || a.kind)}{a.internal ? ' · ' + T('внутренний') : ''}{a.who ? ' · ' + a.who : ''}</span><div>{T(a.text, a.vars ? { ...fmtVars(L, a.vars), ...(a.vars.stage ? { stage: stageName(L, String(a.vars.stage)) } : {}) } : undefined)}</div></span>
                    <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(L, a.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="h3">{T('Подборки')}</div>
              {sels.length === 0 && <div className="small muted">{T('Добавьте квартиры из шахматки или каталога')}</div>}
              {sels.map((s) => <Link key={s.id} href={`/selections/${s.id}`} className="kv"><span style={{ color: 'var(--ink)' }}>{T(s.title || 'Подборка')} · {s.n} · {s.lang.toUpperCase()}</span><span className={s.opened ? 'small okc' : 'small muted'}>{s.opened ? T('открыта {n} раз', { n: s.opened }) : T('не открыта')}</span></Link>)}
            </div>
            <div className="card">
              <div className="h3">{T('Брони')}</div>
              {books.length === 0 && <div className="small muted">{T('Пока нет')}</div>}
              {books.map((b) => <Link key={b.id} href="/bookings" className="kv"><span style={{ color: 'var(--ink)' }}>{b.unit} · {usd(L, b.final_price)}</span><span className="small">{T(b.status === 'confirmed' ? 'подтверждена' : b.status === 'requested' ? 'ждёт подтверждения' : b.status === 'converted' ? 'договор' : b.status === 'cancelled' ? 'снята' : 'истекла')}{['requested', 'confirmed'].includes(b.status) ? ' · ' + T('до {d}', { d: date(L, b.ends_at) }) : ''}</span></Link>)}
            </div>
            <div className="card">
              <div className="h3">{T('Ожидаемая комиссия')}</div>
              <div className="big num">{usd(L, expected)}</div>
              <div className="tiny muted">{ext ? T('по активным броням и сделкам; выплата — после оплаты застройщиком') : T('наш доход по активным броням и сделкам')}</div>
            </div>
            <div className="card">
              <div className="h3">{T('Показы')}</div>
              {tours.length === 0 && <div className="small muted">{T('Не назначен')}</div>}
              {tours.map((x) => <div key={x.id} className="kv"><span className="small" style={{ color: 'var(--ink)' }}>{T(x.text, fmtVars(L, x.vars))}</span><span className="tiny muted">{date(L, x.created_at)}</span></div>)}
              <div className="mt8"><TourForm lang={L} clientId={cl.id} clientLang={['de', 'en', 'ru', 'he'].includes(cl.language) ? cl.language : 'de'} /></div>
            </div>
            <div className="card">
              <div className="h3">{T('Документы')}</div>
              {docs.length === 0 && <div className="small muted">{T('Пока нет')}</div>}
              {docs.map((d) => <div key={d.id} className="kv"><span><a href={`/files/${d.file_id}`} target="_blank">{T(DOC_KINDS[d.kind] || d.kind)}</a>{d.internal && <span className="tiny warnc"> · {T('только команда')}</span>}<div className="tiny muted">{d.filename}{d.note ? ' · ' + d.note : ''}</div></span>
                <span className="row" style={{ gap: 4 }}><span className="tiny muted">{date(L, d.created_at)}</span>{(!ext || d.created_by === c.user.id) && <form action={deleteClientDoc}><input type="hidden" name="id" value={d.id} /><button className="btn btn--sm" title={T('Удалить')}>×</button></form>}</span></div>)}
              <DocUpload lang={L} clientId={cl.id} team={!ext} />
              <div className="tiny muted mt8">{T('Паспорт для KYC, договор, платёжки. Хранятся в ЕС, видны только тем, кому виден клиент.')}</div>
            </div>
            <div className="card">
              <div className="h3">{T('Фиксация у застройщиков')}</div>
              {projects.map((p) => {
                const f = fixes.find((x) => x.project_id === p.id)
                return (
                  <div key={p.id} className="kv">
                    <span style={{ color: 'var(--ink)' }}>{p.name}<div className="tiny muted">{f ? T(f.status === 'approved' ? 'одобрена · до {d}' : f.status === 'rejected' ? 'отклонена' : 'отправлена, ждём ответ', { d: date(L, f.protected_until) }) : T('не отправлена')}</div></span>
                    <span className="row" style={{ gap: 4 }}>
                      {!f && <form action={fixation}><input type="hidden" name="client" value={cl.id} /><input type="hidden" name="project" value={p.id} /><input type="hidden" name="act" value="send" /><button className="btn btn--sm">{T('Отправить')}</button></form>}
                      {f && f.status === 'sent' && !ext && <>
                        <form action={fixation}><input type="hidden" name="client" value={cl.id} /><input type="hidden" name="project" value={p.id} /><input type="hidden" name="act" value="approved" /><button className="btn btn--sm">✓</button></form>
                        <form action={fixation}><input type="hidden" name="client" value={cl.id} /><input type="hidden" name="project" value={p.id} /><input type="hidden" name="act" value="rejected" /><button className="btn btn--sm">✕</button></form>
                      </>}
                    </span>
                  </div>
                )
              })}
            </div>
            {!ext && (
              <form action={setKyc} className="card stack" style={{ gap: 8 }}>
                <div className="h3" style={{ margin: 0 }}>KYC</div>
                <input type="hidden" name="client" value={cl.id} />
                <div className="small muted">{T('В MVP — вручную: документы проверяет команда, отметка в карточке.')}</div>
                <div className="row"><select className="in" name="kyc" defaultValue={cl.kyc_status} style={{ flex: 1 }}>{[['none', 'не начат'], ['pending', 'на проверке'], ['passed', 'пройден'], ['rejected', 'отказ']].map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select><button className="btn">{T('Сохранить')}</button></div>
              </form>
            )}
            {owners.length > 0 && (
              <form action={transferClient} className="card stack" style={{ gap: 8 }}>
                <div className="h3" style={{ margin: 0 }}>{T('Передать клиента')}</div>
                <input type="hidden" name="client" value={cl.id} />
                <div className="row"><select className="in" name="owner" defaultValue={cl.owner_id} style={{ flex: 1 }}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select><button className="btn">{T('Передать')}</button></div>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
