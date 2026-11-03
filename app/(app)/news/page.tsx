import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, date, fmtVars } from '@/lib/i18n'
import { feed, canWritePosts } from '@/lib/posts'
import { savePost, readPosts } from '@/lib/postActions'
import { ActionForm } from '@/components/ActionForm'
import { Top, Pill } from '@/components/ui'
import { MarkRead } from './read'

// Лента новостей и баннеров (М9). Партнёр видит записи своего рынка на своём языке или английском; редакторы — всё действующее.
export default async function News({ searchParams }: { searchParams: { all?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const editor = canWritePosts(c.user.role)
  const posts = await feed(c.user, { all: editor && searchParams.all === '1' })
  const projects = editor ? await q<{ id: string; name: string }>('select id, name from projects order by sort, name') : []
  const unread = posts.filter((p) => !p.read).length
  return (
    <>
      <Top title={T('Новости')} sub={unread ? T('Непрочитанных: {n}', { n: unread }) : T('Всё прочитано')}
        right={editor ? <Link className="btn" href={searchParams.all === '1' ? '/news' : '/news?all=1'}>{searchParams.all === '1' ? T('Как видят партнёры') : T('Все рынки и языки')}</Link> : null} />
      <MarkRead action={readPosts} n={unread} />
      <div className={'page' + (editor ? ' split' : '')}>
        <div className="stack">
          {posts.length === 0 && <div className="card muted">{T('Пока новостей нет')}</div>}
          {posts.map((p) => (
            <div key={p.id} className={'card' + (p.kind === 'banner' ? ' card--sand' : '')}>
              <div className="between">
                <div className="row" style={{ gap: 6 }}>
                  {!p.read && <Pill kind="warn">{T('новое')}</Pill>}
                  {p.kind === 'banner' && <Pill kind="ink">{T('Важно')}</Pill>}
                  {p.kind === 'auto' && <Pill kind="off">{T('автоматически')}</Pill>}
                  {p.project && <span className="small muted">{p.project}</span>}
                </div>
                <span className="tiny muted">{date(L, p.starts_on)}{p.lang ? ' · ' + p.lang.toUpperCase() : ''}{p.markets.length ? ' · ' + p.markets.join(', ') : ''}</span>
              </div>
              <div className="h3 mt8">{p.kind === 'auto' ? T(p.title, fmtVars(L, p.vars)) : p.title}</div>
              {p.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.body}</div>}
              {p.link && <Link className="small bronze mt8" href={p.link}>{T('Подробнее')} →</Link>}
              {editor && p.kind !== 'auto' && (c.user.role !== 'market_head') && (
                <ActionForm action={savePost} lang={L} className="mt8"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="title" value={p.title} /><button className="btn btn--sm" name="delete" value="1">{T('Удалить')}</button></ActionForm>
              )}
            </div>
          ))}
        </div>
        {editor && (
          <ActionForm action={savePost} lang={L} reset className="card stack" style={{ gap: 8, alignSelf: 'start' }} okText={T('Опубликовано')}>
            <div className="h3" style={{ margin: 0 }}>{T('Новая запись')}</div>
            <div className="grid g2">
              <label className="field"><span>{T('Тип')}</span><select className="in" name="kind"><option value="news">{T('Новость')}</option><option value="banner">{T('Баннер (сверху ленты)')}</option></select></label>
              <label className="field"><span>{T('Язык')}</span><select className="in" name="lang" defaultValue={L}>{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
            </div>
            <label className="field"><span>{T('Заголовок')}</span><input className="in" name="title" required /></label>
            <label className="field"><span>{T('Текст')}</span><textarea className="in" name="body" rows={5} /></label>
            <label className="field"><span>{T('Проект')}</span><select className="in" name="project"><option value="">{T('Без проекта')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {c.user.role !== 'market_head'
              ? <div className="row" style={{ gap: 10 }}><span className="small muted">{T('Рынки')}:</span>{['DE', 'IL', 'GLOBAL'].map((m) => <label key={m} className="check small"><input type="checkbox" name={'m_' + m} /> <span>{m}</span></label>)}<span className="tiny muted">{T('ни одного — всем')}</span></div>
              : <div className="tiny muted">{T('Запись увидят партнёры рынка {m}', { m: c.user.market || '' })}</div>}
            <label className="field"><span>{T('Ссылка')}</span><input className="in" name="link" placeholder="/projects/… или https://…" /></label>
            <div className="grid g2">
              <label className="field"><span>{T('Показывать с')}</span><input className="in" type="date" name="starts_on" /></label>
              <label className="field"><span>{T('по')}</span><input className="in" type="date" name="ends_on" /></label>
            </div>
            <div><button className="btn btn--p">{T('Опубликовать')}</button></div>
          </ActionForm>
        )}
      </div>
    </>
  )
}
