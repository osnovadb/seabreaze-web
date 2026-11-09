import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t } from '@/lib/i18n'
import { Top } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { sendSelectionToDeals } from '@/lib/b24ListActions'

// 2.2 · §12 Встройка в список сделок (CRM_DEAL_LIST_MENU): выбранные сделки → подборка каждому клиенту
export default async function DealList(props: { searchParams: Promise<{ ids?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const ids = (searchParams.ids || '').split(',').map(Number).filter((x) => x > 0).slice(0, 100)
  const rows = ids.length ? await q<{ id: string; name: string; deal: string }>(`select id, name, b24_deal_id::text deal from portal.clients where b24_deal_id = any($1) and anonymized_at is null and not do_not_contact`, [ids]) : []
  return (
    <>
      <Top title={T('Подборка выбранным сделкам')} sub={T('Выбрано сделок: {n}; клиентов портала: {m}', { n: ids.length, m: rows.length })} />
      <div className="page stack">
        {rows.length === 0 ? <div className="muted">{T('Среди выбранных сделок нет клиентов портала — откройте вкладку Units в сделке, чтобы связать клиента.')}</div> : (
          <ActionForm action={sendSelectionToDeals} lang={L} className="card stack" okText={T('Подборки отправлены в ленты сделок')}>
            <div className="stack" style={{ gap: 4 }}>{rows.map((r) => <label key={r.id} className="check"><input type="checkbox" name="client" value={r.id} defaultChecked /> {r.name} <span className="tiny muted">· {T('сделка')} {r.deal} · <Link href={`/b24/units/${r.id}`}>Units</Link></span></label>)}</div>
            <label className="field"><span>{T('Квартиры через запятую (A-705, B-908)')}</span><input className="in" name="units" required /></label>
            <div><button className="btn btn--p">{T('Отправить подборку')}</button></div>
          </ActionForm>)}
      </div>
    </>
  )
}
