import { redirect } from 'next/navigation'
import { SOURCE_LABEL } from '@/lib/stages'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date, dateTime } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { executePrivacyRequest, rejectPrivacyRequest } from '@/lib/privacy'
import { PrivacyForm } from './form'

// 2.2 · §15 Согласия и данные: журнал согласий, клиенты без согласия, запросы на удаление (исполнение за 30 дней, в портале и Bitrix24)
export default async function Privacy() {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const reqs = await q<{ id: string; client_label: string; channel: string | null; requested_at: string; due_at: string; status: string; result: Record<string, unknown> | null; note: string | null }>(
    'select id, client_label, channel, requested_at, due_at::text, status, result, note from portal.privacy_requests order by status = \'open\' desc, requested_at desc limit 100')
  const cnt = (await q<{ st: string; n: number }>(`select consent_status st, count(*)::int n from portal.clients where anonymized_at is null group by 1`))
  const pending = await q<{ id: string; reg_no: string; name: string; consent_requested_at: string | null; consent_reminders: number; owner: string }>(
    `select c.id, c.reg_no, c.name, c.consent_requested_at, c.consent_reminders, u.name owner from portal.clients c join portal.users u on u.id = c.owner_id
     where c.consent_status in ('pending','none') and c.anonymized_at is null and not c.do_not_contact order by c.consent_requested_at nulls first limit 50`)
  const log = await q<{ at: string; client: string | null; kind: string; granted: boolean; source: string; who: string | null }>(
    `select x.at, cl.reg_no client, x.kind, x.granted, x.source, u.name who from portal.consents x left join portal.clients cl on cl.id = x.client_id left join portal.users u on u.id = x.by_user order by x.at desc limit 100`)
  const KIND: Record<string, string> = { data: 'данные и застройщики', marketing: 'реклама', partner_confirm: 'подтверждение партнёра или сейлза' }
  return (
    <>
      <Top crumbs={[[T('Админка'), '/admin'], [T('Согласия и данные')]]} title={T('Согласия и данные')} sub={T('Согласие ставит сам клиент по ссылке; без него клиент не попадает в рекламу. Удаление по запросу — за 30 дней, в портале и Bitrix24; договоры и KYC хранятся по закону.')} />
      <div className="page stack">
        <AdminTabs lang={L} on="privacy" role={c.user.role} />
        <div className="grid g4">{[['given', 'согласие получено'], ['pending', 'ждём согласие клиента'], ['declined', 'отказ от согласия'], ['none', 'согласия нет']].map(([k, l]) => <div key={k} className="card card--tight kpi"><div className="small muted">{T(l)}</div><div className="v">{cnt.find((x) => x.st === k)?.n || 0}</div></div>)}</div>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="h3" style={{ margin: 0 }}>{T('Запросы на удаление данных')}</div>
          <PrivacyForm lang={L} />
          <div className="tbl-wrap"><table className="tbl"><thead><tr>{['Клиент', 'Получен', 'Срок', 'Статус', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
            <tbody>{reqs.length === 0 ? <tr><td colSpan={5} className="muted">{T('Запросов нет')}</td></tr> : reqs.map((r) => (
              <tr key={r.id}><td>{r.client_label}<div className="tiny muted">{r.channel}{r.note ? ' · ' + r.note : ''}</div></td><td className="small">{date(L, r.requested_at)}</td>
                <td className="small">{r.status === 'open' && r.due_at < new Date().toISOString().slice(0, 10) ? <span className="badc">{date(L, r.due_at)}</span> : date(L, r.due_at)}</td>
                <td><Pill kind={r.status === 'done' ? 'ok' : r.status === 'rejected' ? 'off' : 'warn'}>{T(r.status === 'done' ? 'выполнен' : r.status === 'rejected' ? 'отклонён' : 'в работе')}</Pill>
                  {r.result && <div className="tiny muted">{r.result.hasDeal ? T('есть сделка: договор и KYC сохранены, остальное обезличено') : T('сделки нет: данные удалены')}</div>}</td>
                <td>{r.status === 'open' && <span className="row" style={{ gap: 6 }}>
                  <form action={executePrivacyRequest}><input type="hidden" name="id" value={r.id} /><button className="btn btn--sm btn--p">{T('Выполнить удаление')}</button></form>
                  <form action={rejectPrivacyRequest}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="reason" value="не подтверждена личность" /><button className="btn btn--sm btn--ghost">{T('Отклонить')}</button></form></span>}</td></tr>))}</tbody></table></div>
        </div>
        <div className="grid g2">
          <div className="card"><div className="h3">{T('Ждём согласие')}</div>
            {pending.length === 0 ? <div className="muted small">{T('Пусто')}</div> : pending.map((p) => <div key={p.id} className="kv"><span><a href={`/clients/${p.id}`}>{p.reg_no}</a> · {p.name} <span className="tiny muted">· {p.owner}</span></span><span className="tiny muted">{p.consent_requested_at ? T('ссылка {d}, напоминаний {n}', { d: date(L, p.consent_requested_at), n: p.consent_reminders }) : T('ссылка не отправлена')}</span></div>)}</div>
          <div className="card"><div className="h3">{T('Журнал согласий')}</div>
            {log.length === 0 ? <div className="muted small">{T('Пусто')}</div> : log.map((x, i) => <div key={i} className="kv"><span className="small">{x.client || '—'} · {T(KIND[x.kind] || x.kind)}: <b className={x.granted ? 'okc' : 'badc'}>{T(x.granted ? 'да' : 'нет')}</b> <span className="tiny muted">· {T(SOURCE_LABEL[x.source] || x.source)}{x.who ? ' · ' + x.who : ''}</span></span><span className="tiny muted">{dateTime(L, x.at)}</span></div>)}</div>
        </div>
      </div>
    </>
  )
}
