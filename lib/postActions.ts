'use server'
import { tabooHits } from './dict'
// Действия ленты (М9): запись пишут контент, владелец и руководитель рынка (только на свой рынок)
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { t, LANGS, bakuToday } from './i18n'
import { canWritePosts, feed } from './posts'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
export async function savePost(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (!canWritePosts(c.user.role) || (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1')) return { error: 'Нет прав' }
  const id = s(f, 'id')
  if (id) {
    const p = await one<{ created_by: string | null; kind: string }>('select created_by, kind from portal.posts where id = $1', [id])
    if (!p || (c.user.role === 'market_head' && p.created_by !== c.user.id)) return { error: 'Нет прав' }
    if (s(f, 'delete')) { await q('delete from portal.posts where id = $1', [id]); await audit(c.real.id, 'post.delete', 'post', id); revalidatePath('/news'); return { ok: true } }
  }
  if (!s(f, 'title')) return { error: t(c.lang, 'Нужен заголовок') }
  const lang = LANGS.includes(s(f, 'lang') as any) ? s(f, 'lang') : c.lang
  let markets = ['DE', 'IL', 'GLOBAL'].filter((m) => f.get('m_' + m))
  if (c.user.role === 'market_head') markets = [c.user.market || 'DE']
  // внутренняя ссылка — «/путь» (не «//хост»), внешняя — только http(s)
  const link = /^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/.test(s(f, 'link')) ? s(f, 'link') : null
  if (s(f, 'starts_on') && s(f, 'ends_on') && s(f, 'ends_on') < s(f, 'starts_on')) return { error: t(c.lang, 'Дата окончания раньше начала') }
  const vals = [s(f, 'kind') === 'banner' ? 'banner' : 'news', s(f, 'title').slice(0, 160), s(f, 'body').slice(0, 4000) || null, lang, markets, s(f, 'project') || null, link, s(f, 'starts_on') || bakuToday(), s(f, 'ends_on') || null]
  if (id) await q(`update portal.posts set kind = $2, title = $3, body = $4, lang = $5, markets = $6, project_id = $7, link = $8, starts_on = $9, ends_on = $10 where id = $1 and kind <> 'auto'`, [id, ...vals])
  else await q(`insert into portal.posts (kind, title, body, lang, markets, project_id, link, starts_on, ends_on, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...vals, c.user.id])
  await audit(c.real.id, id ? 'post.update' : 'post.create', 'post', id || '', { title: s(f, 'title') })
  revalidatePath('/news'); revalidatePath('/')
  // 271: слова-табу рынка — предупреждение после сохранения, не запрет
  const hits = await tabooHits(`${s(f, 'title')} ${s(f, 'body')}`, markets)
  return hits.length ? { ok: true, warning: t(c.lang, 'Сохранено, но есть слова из списка табу: {w} — проверьте текст', { w: hits.join(', ') }) } : { ok: true }
}
// Открыл ленту — всё показанное прочитано
export async function readPosts() {
  const c = await requireCtx()
  if (c.impersonating) return
  const ids = (await feed(c.user, { limit: 200 })).filter((p) => !p.read).map((p) => p.id)
  if (ids.length) await q(`insert into portal.post_reads (post_id, user_id) select unnest($1::uuid[]), $2 on conflict do nothing`, [ids, c.user.id])
  revalidatePath('/', 'layout')
}
