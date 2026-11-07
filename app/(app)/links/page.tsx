import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date } from '@/lib/i18n'
import { isExternal } from '@/lib/perm'
import { listProjects } from '@/lib/catalog'
import { Top, Pill } from '@/components/ui'
import { saveLink, toggleLink } from '@/lib/linkActions'

// 2.2 · §6 П8 Личные ссылки и белый фид партнёра: проекты для продажи → страница с формой (кандидаты партнёра) и фид для сайта агентства
type Lk = { id: string; code: string; title: string | null; project_ids: string[]; lang: string; price_mode: string; active: boolean; leads: number; created_at: string }
export default async function Links() {
  const c = await requireCtx()
  if (!isExternal(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const projects = (await listProjects(c.user)).filter((p) => p.sales_status === 'sales')
  const links = await q<Lk>('select id, code, title, project_ids, lang, price_mode, active, leads, created_at from portal.partner_links where user_id = $1 order by created_at desc', [c.user.id])
  const Form = ({ l }: { l?: Lk }) => (
    <form action={saveLink} className="stack" style={{ gap: 10 }}>
      {l && <input type="hidden" name="id" value={l.id} />}
      <div className="grid g3">
        <label className="field"><span>{T('Название (для вас)')}</span><input className="in" name="title" defaultValue={l?.title || ''} placeholder={T('Например: Instagram, весна')} /></label>
        <label className="field"><span>{T('Язык страницы')}</span><select className="in" name="lang" defaultValue={l?.lang || (c.user.market === 'IL' ? 'he' : 'de')}>{['de', 'en', 'ru', 'he'].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></label>
        <label className="field"><span>{T('Цены')}</span><select className="in" name="price_mode" defaultValue={l?.price_mode || 'from'}><option value="from">{T('«цена от»')}</option><option value="none">{T('без цен')}</option></select></label>
      </div>
      <div className="chips">{projects.map((p) => <label key={p.id} className="chip"><input type="checkbox" name="project" value={p.id} defaultChecked={l ? l.project_ids.includes(p.id) : true} /> {p.name}</label>)}</div>
      <div><button className="btn btn--p btn--sm">{l ? T('Сохранить') : T('Создать ссылку')}</button></div>
    </form>
  )
  return (
    <>
      <Top title={T('Мои ссылки')} sub={T('Страница под вашим брендом с выбранными проектами и формой заявки. Заявки становятся вашими кандидатами — квалифицируйте их за 14 дней. Фид — список проектов для вашего сайта, без точных цен.')} />
      <div className="page stack">
        <div className="card"><div className="h3">{T('Новая ссылка')}</div><Form /></div>
        {links.map((l) => <div key={l.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><b>{l.title || l.code}</b> <Pill kind={l.active ? 'ok' : 'off'}>{T(l.active ? 'работает' : 'выключена')}</Pill> <span className="small muted">· {T('заявок')}: {l.leads} · {date(L, l.created_at)}</span></span>
            <form action={toggleLink}><input type="hidden" name="id" value={l.id} /><button className="btn btn--sm btn--ghost">{T(l.active ? 'Выключить' : 'Включить')}</button></form>
          </div>
          <div className="kv"><span>{T('Страница')}</span><a className="small" href={`${base}/r/${l.code}`} target="_blank" rel="noreferrer">{base}/r/{l.code}</a></div>
          <div className="kv"><span>{T('Фид для сайта (JSON)')}</span><a className="small" href={`${base}/api/feed/${l.code}`} target="_blank" rel="noreferrer">{base}/api/feed/{l.code}</a></div>
          <details><summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Изменить')}</summary><div className="mt8"><Form l={l} /></div></details>
        </div>)}
      </div>
    </>
  )
}
