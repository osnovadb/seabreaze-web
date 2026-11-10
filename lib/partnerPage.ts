// 2.2 · Данные публичной страницы и фида личной ссылки партнёра: только видимые партнёру проекты в продаже, цена — «от» или без цены
import { deliveryRange } from './delivery'
import { q, one } from './db'
import { listProjects } from './catalog'
import type { User } from './auth'

export type LinkPage = { code: string; lang: string; price_mode: string; partner: string; agency: string | null; email: string; projects: { id: string; slug: string; name: string; city: string | null; delivery: string | null; delivery_label: string; developer: string; free: number; from_usd: number | null }[] }

export async function linkPage(code: string): Promise<LinkPage | null> {
  const l = await one<{ code: string; lang: string; price_mode: string; project_ids: string[]; active: boolean; user_id: string }>('select code, lang, price_mode, project_ids, active, user_id from portal.partner_links where code = $1', [code])
  if (!l || !l.active) return null
  const u = await one<User & { agency: string | null }>(`select u.id, u.email, u.name, u.role, u.market, u.agency_id, u.curator_id, u.locale, u.active, a.name agency from portal.users u left join portal.agencies a on a.id = u.agency_id where u.id = $1 and u.active`, [l.user_id])
  if (!u) return null
  const ps = (await listProjects(u)).filter((p) => p.sales_status === 'sales' && l.project_ids.includes(p.id))
  const devs = await q<{ id: string; name: string }>('select p.id, d.name from public.projects p join public.developers d on d.id = p.developer_id where p.id = any($1)', [ps.map((p) => p.id)])
  return {
    code: l.code, lang: l.lang, price_mode: l.price_mode, partner: u.name, agency: u.agency, email: u.email,
    projects: ps.map((p) => ({ id: p.id, slug: p.slug, name: p.name, city: p.city, delivery: p.delivery, delivery_label: deliveryRange(l.lang, p.delivery, p.block_deliveries), developer: devs.find((d) => d.id === p.id)?.name || '', free: p.free,
      // «цена от» округляем вниз до тысячи — как на сайтах, не точная цена квартиры
      from_usd: l.price_mode === 'from' && p.min_usd ? Math.floor(p.min_usd / 1000) * 1000 : null })),
  }
}
