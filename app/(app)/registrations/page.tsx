import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { sendRegistrations, decideRegistration, renewRegistration, massEnqueue } from '@/lib/regActions'

// 2.2 · Регистрации у застройщиков (§7, экран Бэк-офис 01): пакет на сегодня, ждём ответа, молчание, истекают, все
type R = { id: string; status: string; reject_reason: string | null; mass: boolean; priority: boolean; due_send: string | null; sent_at: string | null; answer_due: string | null
  valid_until: string | null; client: string; client_id: string; owner_type: string; owner: string; market: string | null; developer: string; developer_id: string; silence_rule: string }
const ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = {
  to_send: ['К отправке', 'ink'], sent: ['Отправлено', 'warn'], confirmed: ['Подтверждено', 'ok'], confirmed_silence: ['Подтверждено молчанием', 'ok'],
  rejected: ['Отказ', 'bad'], expired: ['Истекла', 'off'], withdrawn: ['Отозвана', 'off'],
}
const WHY: Record<string, string> = { developer_client: 'клиент застройщика', other_agency: 'за другим агентством', other: 'другое' }

export default async function Registrations({ searchParams }: { searchParams: { f?: string; d?: string } }) {
  const c = await requireCtx()
  if (!['owner', 'office', 'market_head'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const rows = await q<R>(`select r.id, r.status, r.reject_reason, r.mass, r.priority, r.due_send::text, r.sent_at, r.answer_due::text, r.valid_until::text,
      cl.name client, cl.id client_id, cl.owner_type, u.name owner, cl.market, d.name || ' · ' || p.name developer, d.id developer_id, coalesce(k.silence_rule, 'remind') silence_rule
    from portal.registrations r join portal.clients cl on cl.id = r.client_id join portal.users u on u.id = cl.owner_id join portal.developers d on d.id = r.developer_id
      join public.projects p on p.id = r.project_id cross join lateral (select * from portal.cur_conditions(r.project_id)) k
    where ($1 = '' or r.developer_id::text = $1) and ($2 <> 'market_head' or cl.market = $3)
    order by r.priority desc, r.due_send nulls last, r.created_at`, [searchParams.d || '', c.user.role, c.user.market || ''])
  const devs = await q<{ id: string; name: string }>('select id, name from portal.developers where active order by name')
  const today = new Date().toISOString().slice(0, 10)
  const soon = (d: string | null) => d !== null && d <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  const groups: [string, string, (r: R) => boolean][] = [
    ['today', 'К отправке', (r) => r.status === 'to_send'],
    ['wait', 'Ждём ответа', (r) => r.status === 'sent' && (r.answer_due ?? '9') >= today],
    ['silence', 'Молчание', (r) => r.status === 'sent' && (r.answer_due ?? '9') < today],
    ['expiring', 'Истекают', (r) => ['confirmed', 'confirmed_silence'].includes(r.status) && soon(r.valid_until)],
    ['all', 'Все', () => true],
  ]
  const f = searchParams.f || 'today'
  const g = groups.find((x) => x[0] === f) || groups[0]
  const shown = rows.filter(g[2])
  const edit = ['owner', 'office'].includes(c.user.role)
  return (
    <>
      <Top title={T('Регистрации у застройщиков')} sub={T('Пакет на сегодня собирается в 9:00 по Баку; SLA передачи — 1 рабочий день, для массовой регистрации — 10')} />
      <div className="page">
        <div className="chips">{groups.map(([k, l, fn]) => <Link key={k} href={`?f=${k}${searchParams.d ? '&d=' + searchParams.d : ''}`} className={'chip' + (f === k ? ' on' : '')}>{T(l)} · {rows.filter(fn).length}</Link>)}</div>
        <div className="chips mt8"><Link href={`?f=${f}`} className={'chip' + (!searchParams.d ? ' on' : '')}>{T('Все застройщики')}</Link>{devs.map((d) => <Link key={d.id} href={`?f=${f}&d=${d.id}`} className={'chip' + (searchParams.d === d.id ? ' on' : '')}>{d.name}</Link>)}</div>
        <form action={sendRegistrations} id="sendform" />
          <div className="tbl-wrap mt16">
            <table className="tbl">
              <thead><tr>{['', 'Клиент', 'Застройщик · проект', 'Источник', 'Статус', 'Срок', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={7} className="muted">{T('Пусто')}</td></tr>}
                {shown.map((r) => {
                  const [lab, kind] = ST[r.status]
                  const term = r.status === 'to_send' ? (r.due_send ? T('передать до {d}', { d: date(L, r.due_send) }) : '') : r.status === 'sent' ? T('ответ до {d}', { d: date(L, r.answer_due!) }) + (r.answer_due! < today ? ' · ' + T(r.silence_rule === 'confirm' ? 'молчание = да' : 'напомнить') : '') : r.valid_until ? T('до {d}', { d: date(L, r.valid_until) }) : ''
                  return (
                    <tr key={r.id}>
                      <td>{edit && ['to_send', 'expired'].includes(r.status) && <input type="checkbox" name="id" value={r.id} form="sendform" defaultChecked={f === 'today'} />}</td>
                      <td><Link href={`/clients/${r.client_id}`}>{r.client}</Link>{r.priority && <div className="tiny bronze">{T('вне очереди — выбрал квартиру')}</div>}{r.mass && <div className="tiny muted">{T('массовая регистрация')}</div>}</td>
                      <td>{r.developer}</td>
                      <td className="small muted">{r.owner_type === 'partner' ? r.owner : T('команда')}{r.market ? ' · ' + r.market : ''}</td>
                      <td><Pill kind={kind}>{T(lab)}</Pill>{r.reject_reason && <div className="tiny muted">{T(WHY[r.reject_reason])}</div>}</td>
                      <td className="small">{term}</td>
                      <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {edit && r.status === 'sent' && <>
                          <form action={decideRegistration}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="verdict" value="confirmed" /><button className="btn btn--sm btn--p">{T('Подтверждено')}</button></form>
                          <form action={decideRegistration} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="verdict" value="rejected" />
                            <select className="in in--sm" name="reason" defaultValue="developer_client">{Object.entries(WHY).map(([k, v]) => <option key={k} value={k}>{T(v)}</option>)}</select><button className="btn btn--sm">{T('Отказ')}</button></form>
                        </>}
                        {edit && ['confirmed', 'confirmed_silence', 'expired', 'rejected'].includes(r.status) && <form action={renewRegistration}><input type="hidden" name="id" value={r.id} /><button className="btn btn--sm">{T('Продлить')}</button></form>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {edit && f === 'today' && shown.length > 0 && <div className="row mt16"><button className="btn btn--p" form="sendform">{T('Отметить отправленными')}</button><span className="small muted">{T('Письмо застройщику — по его шаблону; для массовой регистрации — выгрузка файлом.')}</span></div>}
        {c.user.role === 'owner' && (
          <form action={massEnqueue} className="card mt24 row" style={{ gap: 12 }}>
            <div className="label">{T('Новый застройщик: вся база в регистрацию')}</div>
            <select className="in" name="developer" required defaultValue="">{[<option key="" value="" disabled>{T('Застройщик')}</option>, ...devs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)]}</select>
            <button className="btn">{T('Поставить в очередь (10 р. дней)')}</button>
          </form>
        )}
      </div>
    </>
  )
}
