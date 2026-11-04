import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'

const ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off']> = { queued: ['в очереди', 'warn'], sent: ['отправлено', 'ok'], error: ['ошибка', 'bad'], skipped: ['пропущено', 'off'] }

// Почта и Telegram (запуск): подключены ли каналы и что в очереди. Пока почты нет — письмо можно открыть и переслать вручную.
export default async function Outbox({ searchParams }: { searchParams: { s?: string } }) {
  const c = await requireCtx()
  if (c.user.role !== 'owner') redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const st = ST[searchParams.s || ''] ? searchParams.s! : ''
  const rows = await q<{ id: string; channel: string; to_addr: string; subject: string | null; body: string; kind: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null }>(
    `select id, channel, to_addr, subject, body, kind, status, attempts, last_error, created_at, sent_at from portal.outbox_messages where ($1 = '' or status = $1) order by created_at desc limit 100`, [st])
  const cnt = await q<{ status: string; n: number }>('select status, count(*)::int n from portal.outbox_messages group by 1')
  const mail = !!process.env.SMTP_URL, tg = !!process.env.TG_BOT_TOKEN
  return (
    <>
      <Top crumbs={[[T('Админка'), '/admin'], [T('Почта и Telegram')]]} title={T('Почта и Telegram')} sub={T('Письма со ссылками-приглашениями, сбросы пароля и уведомления вне портала')} />
      <div className="page stack">
        <AdminTabs lang={L} on="outbox" role={c.user.role} />
        <div className="grid g2">
          <div className="card card--tight"><b>E-mail</b> · {mail ? <span className="okc">{process.env.SMTP_URL === 'log' ? T('режим проверки: письма не уходят, их текст — в списке ниже') : T('подключён')}</span> : <span className="warnc">{T('не подключён — нужен SMTP_URL (и SMTP_FROM) в настройках портала')}</span>}</div>
          <div className="card card--tight"><b>Telegram</b> · {tg ? <span className="okc">{T('бот подключён')}{process.env.TG_BOT_NAME ? ' @' + process.env.TG_BOT_NAME : ''}</span> : <span className="warnc">{T('не подключён — нужны TG_BOT_TOKEN и TG_BOT_NAME')}</span>}</div>
        </div>
        <div className="chips"><a className={'chip' + (!st ? ' on' : '')} href="?">{T('Все')}</a>{Object.entries(ST).map(([k, [l]]) => <a key={k} className={'chip' + (st === k ? ' on' : '')} href={`?s=${k}`}>{T(l)} <span className="n">{cnt.find((x) => x.status === k)?.n || 0}</span></a>)}</div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Создано', 'Канал', 'Кому', 'Тема', 'Вид', 'Статус', ''].map((h, i) => <th key={i}>{h ? T(h) : ''}</th>)}</tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="muted">{T('Пусто')}</td></tr> : rows.map((r) => (
            <tr key={r.id}><td className="small">{dateTime(L, r.created_at)}</td><td className="small">{r.channel}</td><td className="small">{r.to_addr}</td><td className="small">{r.subject || '—'}</td><td className="tiny">{r.kind}</td>
              <td><Pill kind={ST[r.status][1]}>{T(ST[r.status][0])}</Pill>{r.last_error && <div className="tiny badc">{r.last_error}</div>}</td>
              <td><details><summary className="tiny bronze" style={{ cursor: 'pointer' }}>{T('Текст')}</summary><pre className="tiny" style={{ whiteSpace: 'pre-wrap', maxWidth: 420 }}>{r.body}</pre></details></td></tr>))}</tbody>
        </table></div>
      </div>
    </>
  )
}
