import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, tzOf } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'

const RES: Record<string, [string, 'ok' | 'warn' | 'off' | 'bad' | 'ink']> = { new_client: ['новый клиент', 'ok'], existing: ['уже наш клиент', 'ink'], partner_client: ['клиент партнёра', 'warn'], spam: ['спам', 'off'], error: ['ошибка', 'bad'] }
// Входящие заявки (М5): что пришло с сайтов и смарт-каталога, чем стало и ушло ли в Bitrix24
export default async function Leads(props: { searchParams: Promise<{ f?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  if (!['owner', 'market_head', 'office', 'finance'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  const mk = c.user.role === 'market_head' ? c.user.market : null
  const rows = await q<{ id: string; source: string; site: string | null; name: string | null; phone: string | null; email: string | null; market: string; lang: string; result: string; client_id: string | null; utm: Record<string, string> | null; created_at: string; bx: string | null; bx_err: string | null }>(`
    select l.id, l.source, l.site, l.name, l.phone, l.email, l.market, l.lang, l.result, l.client_id, l.utm, l.created_at,
      (select o.status from portal.bitrix_outbox o where o.ref_kind = 'inbound_lead' and o.ref_id = l.id order by o.created_at desc limit 1) bx,
      (select o.last_error from portal.bitrix_outbox o where o.ref_kind = 'inbound_lead' and o.ref_id = l.id order by o.created_at desc limit 1) bx_err
    from portal.inbound_leads l where ($1::text is null or l.market = $1) and ($2::text = 'all' or l.result <> 'spam') order by l.created_at desc limit 300`, [mk, searchParams.f || ''])
  const pending = (await q<{ n: number }>(`select count(*)::int n from portal.bitrix_outbox where status <> 'sent'`))[0].n
  return (
    <>
      <Top title={T('Входящие заявки')} sub={T('С сайтов, квиза и смарт-каталога. Клиент закрепляется по правилу «кто раньше».')}
        right={<Link className="btn" href={searchParams.f === 'all' ? '/admin/leads' : '/admin/leads?f=all'}>{searchParams.f === 'all' ? T('Без спама') : T('Показать спам')}</Link>} />
      <div className="page">
        <div className="note small">{process.env.BITRIX_WEBHOOK ? T('Bitrix24 подключён: заявки уходят лидами в течение 15 минут.') : T('Bitrix24 ещё не подключён: в очереди {n} лидов, уйдут после подключения.', { n: pending })}</div>
        <div className="tbl-wrap mt16"><table className="tbl">
          <thead><tr>{['Когда', 'Источник', 'Кто', 'Рынок', 'Метки', 'Результат', 'Bitrix24'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{T('Заявок пока нет')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{dateTime(L, r.created_at, TZ)}</td><td className="small">{r.source}{r.site ? <div className="tiny muted">{r.site}</div> : null}</td>
                <td>{r.client_id ? <Link href={`/clients/${r.client_id}`}><b>{r.name || '—'}</b></Link> : <b>{r.name || '—'}</b>}<div className="tiny muted">{[r.phone, r.email].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{r.market} · {r.lang.toUpperCase()}</td>
                <td className="tiny muted">{r.utm ? Object.entries(r.utm).filter(([k]) => k !== 'page').map(([k, v]) => `${k.replace('utm_', '')}=${v}`).join(' ') : ''}</td>
                <td><Pill kind={(RES[r.result] || ['', 'off'])[1]}>{T((RES[r.result] || [r.result])[0])}</Pill></td>
                <td className="small">{r.bx === 'sent' ? <span className="okc">{T('отправлен')}</span> : r.bx === 'error' ? <span className="badc" title={r.bx_err || ''}>{T('ошибка')}</span> : r.bx ? <span className="muted">{T('в очереди')}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
