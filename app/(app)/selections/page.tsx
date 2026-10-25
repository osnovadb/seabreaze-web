import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { canSeeClients } from '@/lib/perm'
import { q } from '@/lib/db'
import { t, dateTime } from '@/lib/i18n'
import { clientScope } from '@/lib/scope'
import { Top } from '@/components/ui'

export default async function Selections() {
  const c = await requireCtx()
  if (!canSeeClients(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const cs = clientScope(c.user)
  const rows = await q<{ id: string; title: string; client: string; client_id: string; lang: string; opened: number; last_opened_at: string | null; created_at: string; n: number; who: string }>(
    `select s.id, s.title, cl.name client, cl.id client_id, s.lang, s.opened, s.last_opened_at, s.created_at, (select count(*)::int from portal.selection_items i where i.selection_id = s.id) n, u.name who
     from portal.selections s join portal.clients cl on cl.id = s.client_id join portal.users u on u.id = s.user_id where ${cs.sql} order by s.created_at desc`, cs.params)
  return (
    <>
      <Top title={T('Подборки')} sub={T('Квартиры для клиента — ссылкой на его языке, без контактов застройщика')} right={<Link className="btn" href="/catalog">{T('Добавить из каталога')}</Link>} />
      <div className="page">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{['Подборка', 'Клиент', 'Квартир', 'Язык', 'Открыта', 'Создал'].map((h) => <th key={h}>{T(h)}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">{T('Подборок пока нет — добавьте квартиру в подборку из карточки квартиры')}</td></tr>}
            {rows.map((r) => <tr key={r.id}><td><Link href={`/selections/${r.id}`}><b>{T(r.title || 'Подборка')}</b></Link></td><td><Link href={`/clients/${r.client_id}`}>{r.client}</Link></td><td>{r.n}</td><td>{r.lang.toUpperCase()}</td><td className={r.opened ? 'okc' : 'muted'}>{r.opened ? T('{n} раз · {d}', { n: r.opened, d: dateTime(L, r.last_opened_at) }) : T('не открыта')}</td><td className="small muted">{r.who}</td></tr>)}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
