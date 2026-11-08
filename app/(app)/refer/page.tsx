import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date, usd } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { ReferForm } from './form'
import { PayoutProfile } from '@/components/PayoutProfile'

// 2.2 · §6 П9 Кабинет рекомендателя: передать контакт, статус своих рекомендаций и вознаграждения (2% после получения нашей комиссии)
type R = { id: string; name: string; created_at: string; stage: string; attach_status: string; b24_semantic: string | null; deal: number | null; fee: boolean; paid_out: boolean }
export default async function Refer() {
  const c = await requireCtx()
  if (c.user.role !== 'referrer') redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const rows = await q<R>(`select cl.id, cl.name, cl.created_at, cl.stage, cl.attach_status, cl.b24_semantic,
      (select sum(d.final_price)::float from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled') deal,
      exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage in ('fee_received','paid_out')) fee,
      exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage = 'paid_out') paid_out
    from portal.clients cl where cl.referrer_id = $1 order by cl.created_at desc`, [c.user.id])
  // статус простыми словами: сделка → вознаграждение; отказ — без подробностей
  const st = (r: R): [string, 'ok' | 'warn' | 'off' | 'ink'] => r.paid_out ? ['вознаграждение выплачено', 'ok'] : r.fee ? ['комиссия получена — готовим выплату', 'ok'] : r.deal ? ['сделка — ждём оплату застройщика', 'ink']
    : r.stage === 'lost' || r.b24_semantic === 'F' ? ['не купил', 'off'] : ['в работе у менеджера', 'warn']
  const total = rows.reduce((a, r) => a + (r.deal ? r.deal * 0.02 : 0), 0)
  return (
    <>
      <Top title={T('Рекомендации')} sub={T('Вознаграждение — 2% от итоговой цены договора, после того как застройщик заплатит нам комиссию. Удостоверение и налоговый номер попросим только перед первой выплатой.')} />
      <div className="page stack">
        <ReferForm lang={L} />
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><div className="h3" style={{ margin: 0 }}>{T('Мои рекомендации')}</div>{total > 0 && <span className="small">{T('Ожидаемое вознаграждение')}: <b>{usd(L, total)}</b></span>}</div>
          <div className="tbl-wrap mt8"><table className="tbl">
            <thead><tr>{['Человек', 'Передан', 'Статус', 'Вознаграждение'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={4} className="muted">{T('Пока нет рекомендаций')}</td></tr> : rows.map((r) => { const [l, k] = st(r); return (
              <tr key={r.id}><td>{r.name}</td><td className="small">{date(L, r.created_at)}</td><td><Pill kind={k}>{T(l)}</Pill></td><td className="num">{r.deal ? usd(L, r.deal * 0.02) : '—'}</td></tr>) })}</tbody>
          </table></div>
        </div>
        {/* QA 09.11: данные для выплаты — как только по рекомендации есть сделка (раньше рекомендателю негде было их указать) */}
        {rows.some((r) => r.deal) && <PayoutProfile userId={c.user.id} lang={L} />}
      </div>
    </>
  )
}
