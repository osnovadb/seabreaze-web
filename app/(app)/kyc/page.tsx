import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, tzOf } from '@/lib/i18n'
import { canReviewKyc } from '@/lib/kyc'
import { Top, Pill } from '@/components/ui'
import { Pager, pageOf } from '@/components/Pager'

// Очередь KYC для офиса в Баку: кто ждёт проверки и недавние решения
export default async function KycQueue(props: { searchParams: Promise<{ s?: string; page?: string }> }) {
  const sp = await props.searchParams, qs0 = (sp.s || '').trim()
  const c = await requireCtx()
  if (!canReviewKyc(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  const rows = await q<{ id: string; name: string; reg_no: string; market: string; owner: string; kyc_status: string; kyc_submitted_at: string | null; kyc_checked_at: string | null; kyc_citizenship: string | null; booking: boolean }>(`
    select cl.id, cl.name, cl.reg_no, cl.market, u.name owner, cl.kyc_status, cl.kyc_submitted_at, cl.kyc_checked_at, cl.kyc_citizenship,
      exists (select 1 from portal.bookings b where b.client_id = cl.id and b.status in ('requested','confirmed')) booking
    from portal.clients cl join portal.users u on u.id = cl.owner_id
    where (cl.kyc_status = 'pending' or cl.kyc_checked_at > now() - interval '30 days') and ($1 = '' or cl.name ilike '%' || $1 || '%' or cl.reg_no ilike '%' || $1 || '%')
    order by cl.kyc_status = 'pending' desc, cl.kyc_submitted_at, cl.kyc_checked_at desc`, [qs0])
  const pg = pageOf(sp.page, rows.length, 50) // О55 (обход 11.11): поиск и страницы
  const pending = rows.filter((r) => r.kyc_status === 'pending')
  return (
    <>
      <Top title="KYC" sub={T('{n} ждут проверки · решения за 30 дней', { n: pending.length })} />
      <div className="page">
        <form className="row" style={{ gap: 8, marginBottom: 12 }}><input className="in" name="s" defaultValue={qs0} placeholder={T('Клиент или номер')} style={{ maxWidth: 280 }} /><button className="btn btn--sm">{T('Найти')}</button></form>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{T('Клиент')}</th><th>{T('Рынок')}</th><th>{T('Ведёт')}</th><th>{T('Гражданство')}</th><th>{T('Статус')}</th><th>{T('Когда')}</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="muted">{T('Пока нет')}</td></tr>}
              {rows.slice(pg.from, pg.to).map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/clients/${r.id}`}><b>{r.name}</b></Link><div className="tiny muted">{r.reg_no}{r.booking ? ' · ' + T('есть активная бронь') : ''}</div></td>
                  <td>{r.market}</td><td className="small">{r.owner}</td><td className="small">{r.kyc_citizenship || '—'}</td>
                  <td><Pill kind={r.kyc_status === 'passed' ? 'ok' : r.kyc_status === 'rejected' ? 'bad' : r.kyc_status === 'pending' ? 'warn' : 'off'}>{T(r.kyc_status === 'passed' ? 'пройден' : r.kyc_status === 'pending' ? 'на проверке' : r.kyc_status === 'rejected' ? 'отказ' : 'не начат')}</Pill></td>
                  <td className="small">{dateTime(L, r.kyc_status === 'pending' ? r.kyc_submitted_at : r.kyc_checked_at, TZ)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pg.page} pages={pg.pages} total={rows.length} qs={qs0 ? 's=' + encodeURIComponent(qs0) : ''} label={T('Строк: {n}', { n: rows.length })} />
      </div>
    </>
  )
}
