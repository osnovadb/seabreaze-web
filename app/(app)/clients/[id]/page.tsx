import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, date, dateTime, usd, fmtVars } from '@/lib/i18n'
import { isExternal } from '@/lib/perm'
import { clientScope } from '@/lib/scope'
import { Top, Pill, PARTNER_STAGES, STAGES, stageName } from '@/components/ui'
import { partnerCol, REG_ST } from '@/lib/stages'
import { StageStepper } from '@/components/StageStepper'
import { ConsentBox } from '@/components/ConsentBox'
import { EditContacts } from './contacts'
import { TourForm, DocUpload } from './extra'
import { MakeDoc, DocStatus } from './docs'
import { split, type SplitCond } from '@/lib/money'
import { KYC_DOCS, KYC_DOC_NAMES, kycMissing, canReviewKyc, type Buyer } from '@/lib/kyc'
import { BuyersBox } from '@/components/BuyersBox'

const DOC_KINDS: Record<string, string> = { passport: 'паспорт', address: 'подтверждение адреса', funds: 'происхождение средств', kyc: 'KYC', booking: 'бронь', contract: 'договор', payment: 'платёж', other: 'другое' }
import { addActivity, saveQualification, addTask, toggleTask, saveKycData, submitKyc, reviewKyc, transferClient, startShow, deleteClientDoc } from '@/lib/actions'
import { needUuid } from '@/lib/ids'

const SRC_NAME: Record<string, string> = { agent: 'Агент', office: 'Офис / звонок', site: 'Сайт', website: 'Сайт', referral: 'Рекомендация', quiz: 'Квиз на сайте', landing: 'Посадочная страница', smart_catalog: 'Смарт-каталог', import: 'Импорт' }
const DEAL_ST: Record<string, string> = { contract: 'договор', fee_received: 'вознаграждение получено', paid_out: 'выплачено', cancelled: 'отменена' }

export default async function ClientCard(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  needUuid(params.id)
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ext = isExternal(c.user.role)
  const cs = clientScope(c.user)
  const cl = await one<any>(`select cl.*, us.name as owner_name, us.role as owner_role from portal.clients cl join portal.users us on us.id = cl.owner_id where cl.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, params.id])
  if (!cl) notFound()
  const acts = await q<{ id: string; kind: string; text: string; vars: Record<string, string | number> | null; internal: boolean; created_at: string; who: string | null }>(`select a.id, a.kind, a.text, a.vars, a.internal, a.created_at, u.name as who from portal.activities a left join portal.users u on u.id = a.user_id where a.client_id = $1 ${ext ? 'and not a.internal' : ''} order by a.created_at desc`, [cl.id])
  const tasks = await q<{ id: string; title: string; vars: Record<string, string | number> | null; due: string | null; done: boolean }>('select id, title, vars, due, done from portal.tasks where client_id = $1 order by done, due nulls last', [cl.id])
  const fixes = await q<{ project_id: string; name: string; status: string; protected_until: string | null }>(`select f.project_id, p.name, f.status, f.protected_until from portal.fixations f join projects p on p.id = f.project_id where f.client_id = $1`, [cl.id])
  const sels = await q<{ id: string; title: string; opened: number; last_opened_at: string | null; n: number; lang: string }>(`select s.id, s.title, s.opened, s.last_opened_at, s.lang, (select count(*)::int from portal.selection_items i where i.selection_id = s.id) n from portal.selections s where s.client_id = $1 order by s.created_at desc`, [cl.id])
  const books = await q<{ id: string; unit: string; status: string; ends_at: string; final_price: number; group_id: string | null; options_usd: number }>(`select b.id, portal.unit_no(bl.external_id, un.number) unit, b.status, b.ends_at, b.final_price::float, b.group_id, b.options_usd::float from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id where b.client_id = $1 order by b.created_at desc`, [cl.id])
  // Сделки клиента: у клиента может быть несколько квартир — по сделке на каждую, пакеты связаны group_id
  const deals = await q<{ id: string; unit: string; unit_id: string; stage: string; final_price: number; paid_pct: number; group_id: string | null; created_at: string; amount: number }>(`select d.id, portal.unit_no(bl.external_id, un.number) unit, un.id unit_id, d.stage, d.final_price::float, d.paid_pct::float, d.group_id, d.created_at,
      (case when $2 then d.agent_amount else d.our_amount end)::float amount from portal.deals d join units un on un.id = d.unit_id join buildings bl on bl.id = un.building_id where d.client_id = $1 order by d.created_at`, [cl.id, ext])
  const pkgNo = (g: string | null, list: { group_id: string | null }[]) => { if (!g) return 0; const gs = Array.from(new Set(list.map((x) => x.group_id).filter(Boolean))); return gs.indexOf(g) + 1 }
  const owners = c.user.role === 'owner' || c.user.role === 'market_head' ? await q<{ id: string; name: string }>(`select id, name from portal.users where active and role in ('seller','agent','agency_head','market_head') order by name`) : []
  // 2.2: у партнёра стадии — как в Bitrix24 (сделка есть — её стадия; иначе по фактам портала)
  const bst = books.find((b) => b.status === 'converted') || books.find((b) => ['confirmed', 'release_pending'].includes(b.status)) || books.find((b) => ['requested', 'queued'].includes(b.status))
  const regs = await q<{ dev: string; project: string; status: string }>(`select d.name dev, p.name project, r.status from portal.registrations r join portal.developers d on d.id = r.developer_id
    join public.projects p on p.id = r.project_id where r.client_id = $1 order by d.name, p.name`, [cl.id])
  const pcol = partnerCol({ b24_stage: cl.b24_stage, attach_status: cl.attach_status, booking: bst?.status, paid: deals.some((d) => d.paid_pct > 0 && d.stage !== 'cancelled'), regs_sent: regs.some((r) => r.status !== 'to_send') })
  const agentIdx = PARTNER_STAGES.findIndex(([k]) => k === pcol)
  const teamIdx = STAGES.findIndex(([k]) => k === cl.stage)
  const docs = await q<{ id: string; file_id: string; kind: string; note: string | null; internal: boolean; created_by: string; created_at: string; filename: string }>(`select d.id, d.file_id, d.kind, d.note, d.internal, d.created_by, d.created_at, f.filename from portal.client_documents d join portal.files f on f.id = d.file_id where d.client_id = $1 ${ext ? 'and not d.internal' : ''} order by d.created_at desc`, [cl.id])
  const tours = acts.filter((a) => a.text.startsWith('Заявка на тур')).slice(0, 5)
  const docKinds = Array.from(new Set(docs.map((d) => d.kind)))
  const made = await q<{ id: string; kind: string; number: string; lang: string; status: string; pdf_file_id: string | null; docx_file_id: string | null; signed_file_id: string | null; created_at: string }>(
    `select d.id, d.kind, d.number, d.lang, d.status, d.pdf_file_id, d.docx_file_id, d.signed_file_id, d.created_at from portal.documents d where d.client_id = $1
      and (d.kind <> 'commission_act' or $2 or exists (select 1 from portal.commission_acts ca where ca.document_id = d.id and ca.agent_id = $3)) order by d.created_at desc`, [cl.id, ['owner', 'finance'].includes(c.user.role), c.user.id])
  const buyers = await q<Buyer>('select id, kind, name, citizenship, tax_residence, pep, reg_no, ubo from portal.buyers where client_id = $1 order by created_at', [cl.id])
  const docRows = await q<{ kind: string; buyer_id: string | null }>('select distinct kind, buyer_id from portal.client_documents where client_id = $1', [cl.id])
  const kycMiss = kycMissing(docRows, cl, buyers)
  const kycLocked = cl.kyc_status === 'pending' || (cl.kyc_status === 'passed' && !canReviewKyc(c.user.role))
  // Ожидаемая комиссия: партнёру — его доля, команде — наш доход; по активным броням (снимок условий) и сделкам в работе
  const activeB = await q<{ snapshot: SplitCond; price_list: number; discount_pct: number; agent_role: string }>(`select b.snapshot, b.price_list::float, b.discount_pct::float, u.role agent_role from portal.bookings b join portal.users u on u.id = b.agent_id where b.client_id = $1 and b.status in ('requested','confirmed')`, [cl.id])
  const dealSum = await one<{ d: number }>(`select coalesce(sum(case when $2 then agent_amount else our_amount end), 0)::float d from portal.deals where client_id = $1 and stage not in ('cancelled','paid_out')`, [cl.id, ext])
  const expected = activeB.reduce((a, b) => { const sp = split(b.snapshot, b.price_list, b.discount_pct, ['agent', 'agency_head'].includes(b.agent_role)); return a + (ext ? sp.agent : sp.ours) }, 0) + (dealSum?.d || 0)
  const hasDeal = await one(`select 1 from portal.deals where client_id = $1 and stage <> 'cancelled' limit 1`, [cl.id])
  return (
    <>
      <Top crumbs={[[ext ? T('Клиенты') : T('CRM · клиенты'), '/clients'], [cl.name]]} title={cl.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}>
          <Pill kind="ink">{cl.pause_until ? T('Пауза до {d}', { d: date(L, cl.pause_until) }) : cl.stage === 'lost' ? T('Отказ') : ext ? T((PARTNER_STAGES[agentIdx] || ['', cl.stage])[1]) : stageName(L, cl.stage)}</Pill>
          {!ext && cl.b24_stage && <Pill kind="ink">Bitrix24: {cl.b24_stage}</Pill>}
          {cl.attach_status === 'candidate' && <Pill kind="warn">{T('Кандидат: квалифицируйте до {d}', { d: date(L, cl.candidate_until) })}</Pill>}
          {cl.attach_status !== 'candidate' && cl.protected_until && <Pill kind="ok">{T('Закреплён до {d}', { d: date(L, cl.protected_until) })}</Pill>}
          <Pill kind={cl.kyc_status === 'passed' ? 'ok' : ['rejected', 'compliance'].includes(cl.kyc_status) ? 'bad' : cl.kyc_status === 'pending' ? 'warn' : 'off'}>KYC: {T(cl.kyc_status === 'passed' ? 'пройден' : cl.kyc_status === 'pending' ? 'на проверке' : ['rejected', 'compliance'].includes(cl.kyc_status) ? 'отказ' : 'не начат')}</Pill>
          <span className="small muted">{cl.reg_no}{!ext ? ` · ${T('владелец')}: ${cl.owner_name}` : ''}</span>
        </span>}
        right={<>
          {cl.phone && <a className="btn" href={`https://wa.me/${cl.phone_norm}`} target="_blank">WhatsApp</a>}
          <Link className="btn" href="/projects">{T('Подобрать квартиру')}</Link>
          <form action={startShow}><input type="hidden" name="client" value={cl.id} /><input type="hidden" name="lang" value={['de', 'en', 'ru', 'he'].includes(cl.language) ? cl.language : L} /><button className="btn btn--b">{T('Показ клиенту')}</button></form>
        </>} />
      <div className="page">
        <StageStepper clientId={cl.id} name={cl.name} role={c.user.role} lang={L}
          steps={ext ? PARTNER_STAGES.map(([k, l, target]) => ({ key: k, label: T(l), target })) : STAGES.map(([k, l]) => ({ key: k, label: T(l), target: k }))}
          current={ext ? agentIdx : teamIdx}
          ctx={{ stage: cl.stage, paused: !!cl.pause_until, hasBooking: books.some((b) => ['requested', 'confirmed'].includes(b.status)), hasDeal: !!hasDeal, qualified: !!(cl.goal && cl.budget && cl.timeline && cl.country && cl.language) }} />
        <div className="cgrid mt16">
          <div className="stack">
            <div className="card">
              <div className="h3">{T('Клиент')}</div>
              <div className="kv"><span>{T('Телефон')}</span><span>{cl.phone || '—'}</span></div>
              <div className="kv"><span>E-mail</span><span className="small">{cl.email || '—'}</span></div>
              <div className="kv"><span>{T('Страна, язык')}</span><span>{[cl.country, (cl.language || '').toUpperCase()].filter(Boolean).join(' · ')}</span></div>
              <div className="kv"><span>{T('Источник')}</span><span>{cl.source ? T(SRC_NAME[cl.source] || (cl.source.startsWith('site') ? 'Сайт' : cl.source)) : '—'}</span></div>
              <div className="kv" style={{ alignItems: 'flex-start' }}><span>{T('Согласие')}</span><ConsentBox lang={L} cl={cl} /></div>
              <EditContacts lang={L} cl={{ id: cl.id, name: cl.name, phone: cl.phone, email: cl.email, country: cl.country, language: cl.language }} />
            </div>
            <form action={saveQualification} className="card stack" style={{ gap: 10 }}>
              <div className="h3" style={{ margin: 0 }}>{T('Квалификация')}</div>
              <input type="hidden" name="client" value={cl.id} />
              {cl.attach_status === 'candidate' && <div className="tiny muted">{T('Обязательно для закрепления: цель, бюджет, срок, страна проживания, язык')}</div>}
              {[['goal', 'Цель'], ['budget', 'Бюджет'], ['timeline', 'Срок покупки'], ['country', 'Страна проживания'], ['language', 'Язык'], ['payment', 'Оплата'], ['interest', 'Интерес']].map(([k, l]) => <label key={k} className="field"><span>{T(l)}</span>{k === 'language'
                ? <select className="in" name="language" defaultValue={cl.language || ''}><option value="">—</option>{[['de', 'Deutsch'], ['en', 'English'], ['ru', 'Русский'], ['he', 'עברית']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                : <input className="in" name={k} defaultValue={cl[k] || ''} />}</label>)}
              <button className="btn btn--p">{T(cl.attach_status === 'candidate' ? 'Сохранить и закрепить клиента' : 'Сохранить квалификацию')}</button>
            </form>
          </div>
          <div className="stack">
            {regs.length > 0 && <div className="card">
              <div className="h3">{T('Регистрации у застройщиков')}</div>
              {/* 244: партнёру — «готово / в работе» по каждому застройщику, без дат и ответов */}
              {ext ? Array.from(new Set(regs.map((r) => r.dev))).map((dv) => { const rs = regs.filter((r) => r.dev === dv); const ok = rs.every((r) => ['confirmed', 'confirmed_silence'].includes(r.status)); return <div key={dv} className="kv"><span>{dv}</span><Pill kind={ok ? 'ok' : 'warn'}>{T(ok ? 'готово' : 'в работе')}</Pill></div> })
                : regs.map((r) => <div key={r.dev + r.project} className="kv"><span>{r.dev} · {r.project}</span><span className="small">{T(REG_ST[r.status]?.[0] || r.status)}</span></div>)}
            </div>}
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
              {sels.map((s) => <Link key={s.id} href={`/selections/${s.id}`} className="kv"><span style={{ color: 'var(--ink)' }}>{T(s.title || 'Подборка')} · {s.n} · {s.lang.toUpperCase()}</span><span className={s.opened ? 'small okc' : 'small muted'}>{s.opened ? T('открыта: {n}', { n: s.opened }) : T('не открыта')}</span></Link>)}
            </div>
            <div className="card">
              <div className="h3">{T('Брони')}</div>
              {books.length === 0 && <div className="small muted">{T('Пока нет')}</div>}
              {books.map((b) => <Link key={b.id} href="/bookings" className="kv"><span style={{ color: 'var(--ink)' }}>{b.unit} · {usd(L, b.final_price)}{b.options_usd > 0 ? ' + ' + usd(L, b.options_usd) : ''}{b.group_id ? <span className="tiny bronze"> · {T('пакет {n}', { n: pkgNo(b.group_id, books) })}</span> : null}</span><span className="small">{T(b.status === 'confirmed' ? 'подтверждена' : b.status === 'requested' ? 'ждёт подтверждения' : b.status === 'converted' ? 'договор' : b.status === 'cancelled' ? 'снята' : 'истекла')}{['requested', 'confirmed'].includes(b.status) ? ' · ' + T('до {d}', { d: date(L, b.ends_at) }) : ''}</span></Link>)}
            </div>
            {deals.length > 0 && <div className="card">
              <div className="h3">{T('Сделки')} · {deals.filter((d) => d.stage !== 'cancelled').length}</div>
              {deals.map((d) => <Link key={d.id} href={`/units/${d.unit_id}`} className="kv"><span style={{ color: 'var(--ink)' }}>{d.unit} · {usd(L, d.final_price)}{d.group_id ? <span className="tiny bronze"> · {T('пакет {n}', { n: pkgNo(d.group_id, deals) })}</span> : null}<div className="tiny muted">{date(L, d.created_at)}{d.amount ? ' · ' + (ext ? T('ваш доход') : T('наш доход')) + ' ' + usd(L, d.amount) : ''}</div></span>
                <span className={'small' + (d.stage === 'cancelled' ? ' muted' : '')}>{T(DEAL_ST[d.stage] || d.stage)}{d.paid_pct && d.stage === 'contract' ? ' · ' + T('оплачено {p}%', { p: Math.round(d.paid_pct) }) : ''}</span></Link>)}
            </div>}
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
              <div className="h3">{T('Документы из шаблонов')}</div>
              {made.length === 0 && <div className="small muted">{T('Пока нет')}</div>}
              {made.map((d) => (
                <div key={d.id} className="kv"><span><b className="small">{d.number}</b> <span className="tiny muted">{T(({ booking_offer: 'Оферта брони', fixation_act: 'Акт фиксации клиента', commission_act: 'Акт вознаграждения' } as Record<string, string>)[d.kind] || d.kind)} · {d.lang.toUpperCase()}</span>
                  <div className="tiny">{d.pdf_file_id && <a href={`/files/${d.pdf_file_id}`} target="_blank">PDF</a>}{d.docx_file_id && <> · <a href={`/files/${d.docx_file_id}`}>docx</a></>}{d.signed_file_id && <> · <a href={`/files/${d.signed_file_id}`} target="_blank">{T('подписанный')}</a></>}</div></span>
                  <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}><Pill kind={d.status === 'signed' ? 'ok' : d.status === 'void' ? 'off' : d.status === 'sent' ? 'warn' : 'ink'}>{T(({ draft: 'черновик', sent: 'отправлен', signed: 'подписан', void: 'аннулирован' } as Record<string, string>)[d.status])}</Pill><DocStatus lang={L} id={d.id} status={d.status} /></span></div>
              ))}
              <MakeDoc lang={L} clientId={cl.id} clientLang={cl.language || ''} bookings={books.filter((b) => b.status !== 'cancelled').map((b) => ({ id: b.id, unit: b.unit }))} fixations={fixes.map((f) => ({ project_id: f.project_id, name: f.name }))} commission={['owner', 'finance', 'office'].includes(c.user.role)} />
            </div>
            {/* 2.2: регистрации у застройщиков ведёт бэк-офис через очередь (/registrations) — блок «Регистрации у застройщиков» выше */}
            <div className="card stack" style={{ gap: 8 }}>
              <div className="between"><div className="h3" style={{ margin: 0 }}>KYC</div><Pill kind={cl.kyc_status === 'passed' ? 'ok' : ['rejected', 'compliance'].includes(cl.kyc_status) ? 'bad' : cl.kyc_status === 'pending' ? 'warn' : 'off'}>{T(cl.kyc_status === 'passed' ? 'пройден' : cl.kyc_status === 'pending' ? 'на проверке' : ['rejected', 'compliance'].includes(cl.kyc_status) ? 'отказ' : 'не начат')}</Pill></div>
              <BuyersBox lang={L} clientId={cl.id} buyers={buyers} docs={docRows} locked={kycLocked} kycToken={cl.kyc_token} />
              <form action={saveKycData} className="stack" style={{ gap: 6 }}>
                <input type="hidden" name="client" value={cl.id} />
                <div className="row" style={{ gap: 6 }}>
                  <label className="field" style={{ flex: 1 }}><span>{T('Гражданство')}</span><input className="in" name="citizenship" defaultValue={cl.kyc_citizenship || ''} disabled={kycLocked} /></label>
                  <label className="field" style={{ flex: 1 }}><span>{T('Налоговое резидентство')}</span><input className="in" name="tax_residence" defaultValue={cl.kyc_tax_residence || ''} disabled={kycLocked} /></label>
                </div>
                <label className="field"><span>{T('Публичное должностное лицо (PEP)')}</span>
                  <select className="in" name="pep" defaultValue={cl.kyc_pep == null ? '' : cl.kyc_pep ? 'yes' : 'no'} disabled={kycLocked}><option value="">—</option><option value="no">{T('нет')}</option><option value="yes">{T('да')}</option></select></label>
                {!kycLocked && <div><button className="btn btn--sm">{T('Сохранить анкету')}</button></div>}
              </form>
              {cl.kyc_status === 'rejected' && cl.kyc_note && <div className="err small">{T('Причина отказа')}: {cl.kyc_note}</div>}
              {cl.kyc_status === 'compliance' && <div className="err small">{ext ? T('Отказ по проверке') : `${T('Отказ по проверке (Compliance)')}: ${cl.kyc_note || ''}`}</div>}
              {['none', 'rejected'].includes(cl.kyc_status) && (kycMiss.length
                ? <div className="tiny muted">{T('Для отправки на проверку не хватает')}: {kycMiss.map((m) => T(m)).join(', ')}</div>
                : <form action={submitKyc}><input type="hidden" name="client" value={cl.id} /><button className="btn btn--p btn--block">{T('Отправить на проверку KYC')}</button></form>)}
              {cl.kyc_status === 'pending' && !canReviewKyc(c.user.role) && <div className="tiny muted">{T('Офис в Баку проверит документы и примет решение.')}</div>}
              {canReviewKyc(c.user.role) && cl.kyc_status === 'pending' && (
                <form action={reviewKyc} className="stack" style={{ gap: 6 }}>
                  <input type="hidden" name="client" value={cl.id} />
                  <input className="in" name="note" placeholder={T('Комментарий (для отказа — обязателен)')} />
                  <div className="row" style={{ gap: 6 }}><button className="btn btn--p" name="decision" value="passed">{T('KYC пройден')}</button><button className="btn" name="decision" value="rejected">{T('Отклонить')}</button><button className="btn btn--ghost" name="decision" value="compliance" title={T('Окончательный отказ: Lost «Compliance», брони снимаются, клиент исключается из маркетинга')}>{T('Отказ (Compliance)')}</button></div>
                </form>
              )}
              {canReviewKyc(c.user.role) && cl.kyc_status === 'passed' && <form action={reviewKyc}><input type="hidden" name="client" value={cl.id} /><button className="btn btn--sm" name="decision" value="none">{T('Сбросить KYC')}</button></form>}
              {cl.kyc_checked_at && <div className="tiny muted">{T('Проверено {d}', { d: dateTime(L, cl.kyc_checked_at) })}</div>}
              <div className="tiny muted">{T('Без пройденного KYC сделку нельзя перевести в «Договор подписан».')}</div>
            </div>
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
