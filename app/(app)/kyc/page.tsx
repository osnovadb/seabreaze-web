import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { canReviewKyc } from '@/lib/kyc'
import { Top, Pill } from '@/components/ui'

// Очередь KYC для офиса в Баку: кто ждёт проверки и недавние решения
export default async function KycQueue() {
  const c = await requireCtx()
  if (!canReviewKyc(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const rows = await q<{ id: string; name: string; reg_no: string; market: string; owner: string; kyc_status: string; kyc_submitted_at: string | null; kyc_checked_at: string | null; kyc_citizenship: string | null; booking: boolean }>(`
    select cl.id, cl.name, cl.reg_no, cl.market, u.name owner, cl.kyc_status, cl.kyc_submitted_at, cl.kyc_checked_at, cl.kyc_citizenship,
      exists (select 1 from portal.bookings b where b.client_id = cl.id and b.status in ('requested','confirmed')) booking
    from portal.clients cl join portal.users u on u.id = cl.owner_id
    where cl.kyc_status = 'pending' or cl.kyc_checked_at > now() - interval '30 days'
    order by cl.kyc_status = 'pending' desc, cl.kyc_submitted_at, cl.kyc_checked_at desc`)
  const pending = rows.filter((r) => r.kyc_status === 'pending')
  return (
    <>
      <Top title="KYC" sub={T('{n} ждут проверки · решения за 30 дней', { n: pending.length })} />
      <div className="page">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{T('Клиент')}</th><th>{T('Рынок')}</th><th>{T('Ведёт')}</th><th>{T('Гражданство')}</th><th>{T('Статус')}</th><th>{T('Когда')}</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="muted">{T('Пока нет')}</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/clients/${r.id}`}><b>{r.name}</b></Link><div className="tiny muted">{r.reg_no}{r.booking ? ' · ' + T('есть активная бронь') : ''}</div></td>
                  <td>{r.market}</td><td className="small">{r.owner}</td><td className="small">{r.kyc_citizenship || '—'}</td>
                  <td><Pill kind={r.kyc_status === 'passed' ? 'ok' : r.kyc_status === 'rejected' ? 'bad' : r.kyc_status === 'pending' ? 'warn' : 'off'}>{T(r.kyc_status === 'passed' ? 'пройден' : r.kyc_status === 'pending' ? 'на проверке' : r.kyc_status === 'rejected' ? 'отказ' : 'не начат')}</Pill></td>
                  <td className="small">{dateTime(L, r.kyc_status === 'pending' ? r.kyc_submitted_at : r.kyc_checked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
