// Лента для партнёров (М9): что видит пользователь и автоматические записи
import { q } from './db'
import type { User } from './auth'
import { visibleSql } from './catalog'
import { isExternal } from './perm'

export const canWritePosts = (role: string) => ['owner', 'content', 'market_head'].includes(role)
export type Post = { id: string; kind: string; title: string; body: string | null; vars: Record<string, string | number> | null; lang: string | null; markets: string[]; project_id: string | null; project: string | null; link: string | null; starts_on: string; ends_on: string | null; created_at: string; read: boolean; author: string | null }

// Видимость: период показа; рынок пользователя (или всем); партнёру — язык свой или английский (авто-записи — всем);
// партнёр — только по видимым ему проектам. Команда видит всё, что сейчас показывается.
export async function feed(u: User, opts: { limit?: number; all?: boolean } = {}) {
  const ext = isExternal(u.role)
  // $1..$3 — как ждёт visibleSql (пользователь, агентство, рынок); у команды агентства нет, поэтому параметры только используемые
  const params: unknown[] = ext ? [u.id, u.agency_id, u.market] : [u.id]
  const where = [`p.starts_on <= current_date`, `(p.ends_on is null or p.ends_on >= current_date)`]
  const add = (v: unknown) => '$' + params.push(v)
  if (ext || !opts.all) {
    where.push(`(cardinality(p.markets) = 0 or ${add(u.market)} = any(p.markets))`)
    // язык фильтруем только партнёрам: команда рынка видит записи на любом языке
    if (ext) where.push(`(p.lang is null or p.lang = ${add(u.locale || 'ru')} or p.lang = 'en')`)
  }
  if (ext) where.push(`(p.project_id is null or exists (select 1 from projects pr where pr.id = p.project_id and ${visibleSql('pr')}))`)
  return q<Post>(`select p.id, p.kind, p.title, p.body, p.vars, p.lang, p.markets, p.project_id, pr.name project, p.link, p.starts_on::text, p.ends_on::text, p.created_at,
      exists (select 1 from portal.post_reads r where r.post_id = p.id and r.user_id = $1) read, us.name author
    from portal.posts p left join projects pr on pr.id = p.project_id left join portal.users us on us.id = p.created_by
    where ${where.join(' and ')} order by p.kind = 'banner' desc, p.starts_on desc, p.created_at desc limit ${Number(opts.limit) || 50}`, params)
}
// Авто-запись: один раз на ключ (повторное событие не дублирует)
export async function autoPost(key: string, title: string, vars: Record<string, string | number>, projectId: string | null, link: string | null, markets: string[] = [], period?: { starts_on?: string | null; ends_on?: string | null }) {
  await q(`insert into portal.posts (kind, title, vars, project_id, link, markets, auto_key, starts_on, ends_on) values ('auto', $1, $2, $3, $4, $5, $6, coalesce($7::date, current_date), $8)
    on conflict (auto_key) do update set vars = excluded.vars, starts_on = excluded.starts_on, ends_on = excluded.ends_on`, [title, vars, projectId, link, markets, key, period?.starts_on || null, period?.ends_on || null])
}
export const dropAutoPost = (key: string) => q('delete from portal.posts where auto_key = $1', [key])
