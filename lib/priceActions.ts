'use server'
// Прайс-листы (группа 4): владелец или офис в Баку собирает правило, видит «было → стало», публикует и при ошибке откатывает.
// Публикация и откат — одной транзакцией от имени пользователя: журнал квартиры пишет «прайс-лист <название>» и автора.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { t } from './i18n'
import { normRule, ruleError, computeItems } from './priceRule'
import { ruleUnits } from './priceData'
import { asActor } from './unitEvents'
import { autoPost } from './posts'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const all = (f: FormData, k: string) => f.getAll(k).map(String).map((x) => x.trim()).filter(Boolean)
async function editor() {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role) || (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1')) throw new Error('forbidden')
  return c
}
const done = (pid: string, id?: string) => { revalidatePath('/admin/prices'); if (id) revalidatePath(`/admin/prices/${id}`); revalidatePath(`/admin/objects/${pid}`); revalidatePath('/projects', 'layout'); revalidatePath('/catalog') }

// Сохранить черновик: правило из формы, пересчёт позиций по текущим ценам
export async function savePriceList(_: unknown, f: FormData) {
  const c = await editor()
  const id = s(f, 'id'), pid = s(f, 'project')
  if (!(await one('select 1 from projects where id = $1', [pid]))) return { error: 'project' }
  if (id && !(await one(`select 1 from portal.price_lists where id = $1 and project_id = $2 and status = 'draft'`, [id, pid]))) return { error: t(c.lang, 'Прайс-лист уже опубликован — создайте новый') }
  const rule = normRule({
    buildings: all(f, 'buildings'), types: all(f, 'types'), rooms: all(f, 'rooms'), layouts: all(f, 'layouts'), units: [],
    risers: s(f, 'risers').split(/[\s,;]+/).filter(Boolean), floor_from: s(f, 'floor_from'), floor_to: s(f, 'floor_to'), statuses: all(f, 'statuses'),
    op: s(f, 'op'), value: s(f, 'value').replace(',', '.'), base_floor: s(f, 'base_floor'), round: s(f, 'round'), currency: s(f, 'currency'),
  })
  const err = ruleError(rule)
  if (err) return { error: t(c.lang, err) }
  const items = computeItems(await ruleUnits(pid), rule)
  if (items.length > 3000) return { error: t(c.lang, 'Слишком много квартир за раз — сузьте отбор') }
  const title = s(f, 'title') || t(c.lang, 'Прайс-лист от {d}', { d: new Date().toISOString().slice(0, 10) })
  const listId = await asActor(c.user.id, 'portal', async (db) => {
    const lid = id || (await db.query<{ id: string }>(`insert into portal.price_lists (project_id, title, rule, note, created_by) values ($1,$2,$3,$4,$5) returning id`, [pid, title, rule, s(f, 'note') || null, c.user.id])).rows[0].id
    if (id) await db.query(`update portal.price_lists set title = $2, rule = $3, note = $4 where id = $1`, [id, title, rule, s(f, 'note') || null])
    await db.query('delete from portal.price_list_items where list_id = $1', [lid])
    for (let i = 0; i < items.length; i += 500) {
      const part = items.slice(i, i + 500)
      await db.query(`insert into portal.price_list_items (list_id, unit_id, old_price, new_price, currency) select $1, x.unit_id, x.old_price, x.new_price, x.currency
        from jsonb_to_recordset($2::jsonb) as x(unit_id uuid, old_price numeric, new_price numeric, currency text)`, [lid, JSON.stringify(part)])
    }
    return lid
  })
  await audit(c.real.id, id ? 'pricelist.update' : 'pricelist.create', 'project', pid, { list: listId, n: items.length }, c.impersonating ? c.user.id : null)
  done(pid, listId)
  if (!id) redirect(`/admin/prices/${listId}`)
  return { ok: true, made: items.length }
}

// Публикация: цена меняется, только если с момента расчёта её никто не трогал; остальные позиции помечаются «пропущено»
export async function publishPriceList(_: unknown, f: FormData) {
  const c = await editor()
  const l = await one<{ id: string; project_id: string; title: string; status: string }>('select id, project_id, title, status from portal.price_lists where id = $1', [s(f, 'id')])
  if (!l) return { error: 'list' }
  if (l.status !== 'draft') return { error: t(c.lang, 'Прайс-лист уже опубликован') }
  const r = await asActor(c.user.id, 'pricelist:' + l.id, async (db) => {
    // Блокировка строки прайс-листа: две вкладки не опубликуют его дважды
    const st = (await db.query<{ status: string }>('select status from portal.price_lists where id = $1 for update', [l.id])).rows[0]
    if (st?.status !== 'draft') return null
    const ok = (await db.query<{ unit_id: string }>(`update units u set price_list = i.new_price from portal.price_list_items i
      where i.list_id = $1 and u.id = i.unit_id and coalesce(u.price_list, 0) = i.old_price and u.price_currency = i.currency returning u.id unit_id`, [l.id])).rows.map((x) => x.unit_id)
    await db.query(`update portal.price_list_items set applied = (unit_id = any($2::uuid[])) where list_id = $1`, [l.id, ok])
    await db.query(`update portal.price_lists set status = 'published', published_by = $2, published_at = now() where id = $1`, [l.id, c.user.id])
    const skipped = (await db.query<{ n: number }>('select count(*)::int n from portal.price_list_items where list_id = $1 and not applied', [l.id])).rows[0].n
    return { applied: ok.length, skipped }
  })
  if (!r) return { error: t(c.lang, 'Прайс-лист уже опубликован') }
  // Лента партнёров (М9): новые цены по проекту — одной записью на прайс-лист
  const p = await one<{ name: string; slug: string }>('select name, slug from projects where id = $1', [l.project_id])
  if (r.applied) await autoPost(`prices:${l.id}`, 'Новые цены: {p} — {n} кв.', { p: p?.name || '', n: r.applied }, l.project_id, `/catalog?p=${p?.slug}`)
  await audit(c.real.id, 'pricelist.publish', 'project', l.project_id, { list: l.id, ...r }, c.impersonating ? c.user.id : null)
  done(l.project_id, l.id)
  return { ok: true, made: r.applied }
}

// Откат: возвращаем старую цену тем квартирам, где стоит цена этого прайс-листа (более поздние правки не трогаем)
export async function revertPriceList(_: unknown, f: FormData) {
  const c = await editor()
  const l = await one<{ id: string; project_id: string; status: string }>('select id, project_id, status from portal.price_lists where id = $1', [s(f, 'id')])
  if (!l || l.status !== 'published') return { error: t(c.lang, 'Откатить можно только опубликованный прайс-лист') }
  const n = await asActor(c.user.id, 'pricelist:' + l.id, async (db) => {
    const st = (await db.query<{ status: string }>('select status from portal.price_lists where id = $1 for update', [l.id])).rows[0]
    if (st?.status !== 'published') return -1
    const back = (await db.query(`update units u set price_list = i.old_price from portal.price_list_items i
      where i.list_id = $1 and i.applied and u.id = i.unit_id and u.price_list = i.new_price and u.price_currency = i.currency returning u.id`, [l.id])).rowCount || 0
    await db.query(`update portal.price_lists set status = 'reverted', reverted_by = $2, reverted_at = now() where id = $1`, [l.id, c.user.id])
    return back
  })
  if (n < 0) return { error: t(c.lang, 'Откатить можно только опубликованный прайс-лист') }
  await q('delete from portal.posts where auto_key = $1', ['prices:' + l.id])
  await audit(c.real.id, 'pricelist.revert', 'project', l.project_id, { list: l.id, n }, c.impersonating ? c.user.id : null)
  done(l.project_id, l.id)
  return { ok: true, made: n }
}

export async function deletePriceList(f: FormData) {
  const c = await editor()
  const l = await one<{ project_id: string }>(`delete from portal.price_lists where id = $1 and status = 'draft' returning project_id`, [s(f, 'id')])
  if (l) { await audit(c.real.id, 'pricelist.delete', 'project', l.project_id, { list: s(f, 'id') }); done(l.project_id) }
  redirect('/admin/prices' + (l ? '?p=' + l.project_id : ''))
}
