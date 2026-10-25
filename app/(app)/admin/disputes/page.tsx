import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, date } from '@/lib/i18n'
import { Top, Pill } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { resolveDispute } from '@/lib/actions'

type D = { id: string; status: string; name: string; phone: string | null; email: string | null; comment: string | null; created_at: string; decided_at: string | null; decision: string | null
  client_id: string; client: string; reg_no: string; registered: string; owner: string; owner_agency: string | null; requester: string; requester_agency: string | null; market: string | null; decider: string | null }

// Споры «чей клиент»: решение по журналу — кто зарегистрировал раньше и что было до запроса
export default async function Disputes({ searchParams }: { searchParams: { f?: string } }) {
  const c = await requireCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const f = searchParams.f === 'closed' ? 'closed' : 'open'
  const rows = await q<D>(`select d.id, d.status, d.name, d.phone, d.email, d.comment, d.created_at, d.decided_at, d.decision, cl.id client_id, cl.name client, cl.reg_no, cl.created_at registered, cl.market,
      ow.name owner, oa.name owner_agency, rq.name requester, ra.name requester_agency, dc.name decider
    from portal.disputes d join portal.clients cl on cl.id = d.client_id join portal.users ow on ow.id = cl.owner_id left join portal.agencies oa on oa.id = ow.agency_id
    join portal.users rq on rq.id = d.requester_id left join portal.agencies ra on ra.id = rq.agency_id left join portal.users dc on dc.id = d.decided_by
    where d.status ${f === 'open' ? "= 'open'" : "<> 'open'"} ${c.user.role === 'market_head' ? 'and cl.market = $1' : ''} order by d.created_at desc`, c.user.role === 'market_head' ? [c.user.market] : [])
  const ids = rows.map((r) => r.client_id)
  const log = ids.length ? await q<{ entity_id: string; action: string; created_at: string; who: string | null }>(`select a.entity_id, a.action, a.created_at, u.name who from portal.audit a left join portal.users u on u.id = a.user_id
    where a.entity = 'client' and a.entity_id = any($1) order by a.id`, [ids]) : []
  return (
    <>
      <Top title={T('Админка')} sub={T('Споры «чей клиент»: клиент закреплён за тем, кто зарегистрировал его раньше. Решение — по журналу.')} />
      <div className="page">
        <AdminTabs lang={L} on="disputes" role={c.user.role} />
        <div className="chips">{[['open', 'Открытые'], ['closed', 'Решённые']].map(([k, l]) => <Link key={k} href={`?f=${k}`} className={'chip' + (f === k ? ' on' : '')}>{T(l)}</Link>)}</div>
        {rows.length === 0 && <div className="card muted mt16">{T('Споров нет')}</div>}
        <div className="stack mt16">
          {rows.map((r) => (
            <div key={r.id} className="card">
              <div className="between">
                <div className="h3" style={{ margin: 0 }}><Link href={`/clients/${r.client_id}`}>{r.client}</Link> <span className="small muted">· {r.reg_no}{r.market ? ' · ' + r.market : ''}</span></div>
                {r.status === 'open' ? <Pill kind="warn">{T('ждёт решения')}</Pill> : <Pill kind={r.status === 'transferred' ? 'ours' : 'ok'}>{T(r.status === 'transferred' ? 'передан заявителю' : 'оставлен за первым')}</Pill>}
              </div>
              <div className="grid g2 mt16">
                <div>
                  <div className="label">{T('Закреплён за')}</div>
                  <div><b>{r.owner}</b>{r.owner_agency ? ' · ' + r.owner_agency : ''}</div>
                  <div className="small muted">{T('Регистрация {d}', { d: dateTime(L, r.registered) })}</div>
                </div>
                <div>
                  <div className="label">{T('Запрос проверки')}</div>
                  <div><b>{r.requester}</b>{r.requester_agency ? ' · ' + r.requester_agency : ''}</div>
                  <div className="small muted">{dateTime(L, r.created_at)} · {[r.name, r.phone, r.email].filter(Boolean).join(' · ')}</div>
                  {r.comment && <div className="small mt8">«{r.comment}»</div>}
                </div>
              </div>
              <div className="label mt16">{T('Журнал по клиенту')}</div>
              {log.filter((x) => x.entity_id === r.client_id).map((x, i) => <div key={i} className="kv"><span className="small"><code>{x.action}</code> · {x.who}</span><span className="tiny muted">{dateTime(L, x.created_at)}</span></div>)}
              {r.status === 'open' ? (
                <form action={resolveDispute} className="row mt16">
                  <input type="hidden" name="id" value={r.id} />
                  <input className="in" name="decision" placeholder={T('Основание решения')} style={{ flex: 1 }} />
                  <button className="btn" name="act" value="keep">{T('Оставить за первым')}</button>
                  <button className="btn btn--p" name="act" value="transfer">{T('Передать заявителю')}</button>
                </form>
              ) : <div className="small muted mt16">{T('Решение')}: {r.decider} · {date(L, r.decided_at)}{r.decision ? ' · ' + r.decision : ''}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
