import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, m2, dateTime } from '@/lib/i18n'
import { unitsByIds, planUrl, unitNo, codeFor } from '@/lib/catalog'
import { clientScope } from '@/lib/scope'
import { Top, Pill } from '@/components/ui'
import { selectionUpdate } from '@/lib/actions'

export default async function SelectionEdit({ params }: { params: { id: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const cs = clientScope(c.user)
  const s = await one<{ id: string; token: string; title: string; lang: string; opened: number; last_opened_at: string | null; client: string; client_id: string; user_id: string }>(
    `select s.*, cl.name client from portal.selections s join portal.clients cl on cl.id = s.client_id where s.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, params.id])
  if (!s) notFound()
  const items = await q<{ unit_id: string; note: string | null; liked: boolean }>('select unit_id, note, liked from portal.selection_items where selection_id = $1 order by sort', [s.id])
  const units = new Map((await unitsByIds(items.map((i) => i.unit_id))).map((u) => [u.id, u]))
  const host = headers().get('x-forwarded-host') || headers().get('host')
  const proto = headers().get('x-forwarded-proto') || 'http'
  const link = `${proto}://${host}/s/${s.token}`
  return (
    <>
      <Top crumbs={[[T('Подборки'), '/selections'], [s.client, `/clients/${s.client_id}`], [T(s.title || 'Подборка')]]} title={T('Подборка для {c}', { c: s.client })}
        sub={T('{n} квартир · клиент открывал {o} раз{l}', { n: items.length, o: s.opened, l: s.last_opened_at ? ', ' + T('последний — {d}', { d: dateTime(L, s.last_opened_at) }) : '' })}
        right={<><a className="btn" href={`/s/${s.token}?preview=1`} target="_blank">{T('Как видит клиент ↗')}</a><Link className="btn btn--p" href="/catalog">{T('Добавить квартиры')}</Link></>} />
      <div className="page split">
        <form action={selectionUpdate} className="card stack">
          <input type="hidden" name="id" value={s.id} />
          {items.length === 0 && <div className="muted">{T('Пусто — добавьте квартиры из каталога или шахматки')}</div>}
          {items.map((i) => {
            const u = units.get(i.unit_id)
            if (!u) return null
            const free = codeFor(u, null, 'show') === 'F' || u.booking_agent === c.user.id
            return (
              <div key={i.unit_id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 16, borderBottom: '1px solid var(--line-2)', paddingBottom: 12 }}>
                <div className="planbox" style={{ padding: 4, height: 110 }}>{planUrl(u.plan_file) && <img src={planUrl(u.plan_file)!} alt="" style={{ maxHeight: 100 }} />}</div>
                <div>
                  <div className="row"><b>{unitNo(u)}</b>{!free && <Pill kind="bad">{T('уже занята')}</Pill>}{i.liked && <Pill kind="warn">♥ {T('понравилась на встрече')}</Pill>}</div>
                  <div className="small muted">{T('{r} комн.', { r: u.rooms ?? '' })} · {m2(L, u.area)} · {T('{f} этаж', { f: u.floor })} · {u.building}</div>
                  <div className="mt8"><b>{u.usd ? usd(L, u.usd) : ''}</b></div>
                  <input className="in mt8" name={`note:${u.id}`} defaultValue={i.note || ''} placeholder={T('Заметка для клиента…')} />
                </div>
                <button className="btn btn--sm" name="remove" value={u.id}>✕</button>
              </div>
            )
          })}
          <button className="btn">{T('Сохранить заметки')}</button>
        </form>
        <div className="stack">
          <form action={selectionUpdate} className="card stack" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={s.id} />
            <div className="h3" style={{ margin: 0 }}>{T('Язык для клиента')}</div>
            <div className="row">{['de', 'en', 'ru', 'he'].map((l) => <button key={l} name="lang" value={l} className={'chip' + (s.lang === l ? ' on' : '')}>{l.toUpperCase()}</button>)}</div>
          </form>
          <div className="card">
            <div className="h3">{T('Ссылка для клиента')}</div>
            <input className="in" readOnly value={link} />
            <div className="tiny muted mt8">{T('Отправьте в WhatsApp или e-mail. Мы увидим, когда клиент откроет, и пришлём вам уведомление. Контактов застройщика в подборке нет — только ваши.')}</div>
            <a className="btn btn--p btn--block mt16" href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank">{T('Отправить в WhatsApp')}</a>
          </div>
        </div>
      </div>
    </>
  )
}
