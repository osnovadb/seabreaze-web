'use server'
// «Источники» (М11): подключение Profitbase, ручной прогон, сопоставление статусов, повтор очереди записи
import { revalidatePath } from 'next/cache'
import { q, one, tx, audit, notify } from './db'
import { requireCtx } from './auth'
import { t } from './i18n'
import { pbSync } from './pb.mjs'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function owner() {
  const c = await requireCtx()
  if (c.user.role !== 'owner' || c.impersonating) throw new Error('forbidden')
  return c
}
const json = (v: string) => { if (!v) return {}; const j = JSON.parse(v); if (typeof j !== 'object' || Array.isArray(j)) throw new Error('obj'); return j }

// Ключ API в базе не храним: только имя переменной окружения (key_env), сам ключ — в portal.env сервера
export async function savePbSource(_: unknown, f: FormData) {
  const c = await owner()
  const id = s(f, 'id'), name = s(f, 'name')
  if (!/^pb:[a-z0-9_-]{2,40}$/.test(id)) return { error: t(c.lang, 'Код источника — pb:имя латиницей, например pb:seabreeze') }
  if (!name) return { error: t(c.lang, 'Нужно название') }
  const acc = s(f, 'account'), base = s(f, 'base_url')
  if (!/^pb\d+$/.test(acc) && !/^https?:\/\/[\w.:-]+$/.test(base)) return { error: t(c.lang, 'Укажите аккаунт вида pb21387 или адрес API') }
  if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(s(f, 'key_env'))) return { error: t(c.lang, 'Имя переменной с ключом — латиница заглавными, например PB_KEY_SEABREEZE') }
  let projects, houses
  try { projects = json(s(f, 'projects')); houses = json(s(f, 'houses')) } catch { return { error: t(c.lang, 'Сопоставление проектов и домов — JSON-объект, например {"7001": "premium-residence"}') } }
  for (const slug of Object.values(projects)) if (!(await one('select 1 from projects where slug = $1', [slug]))) return { error: t(c.lang, 'Нет проекта {p}', { p: String(slug) }) }
  const config = { account: acc || undefined, base_url: base || undefined, key_env: s(f, 'key_env'), projects, houses, reserve_status: s(f, 'reserve_status') || 'BOOKED', sold_status: s(f, 'sold_status') || 'SOLD', currency: s(f, 'currency') || 'USD' }
  await q(`insert into sources (id, kind, name, config, active) values ($1, 'profitbase', $2, $3, $4) on conflict (id) do update set name = $2, config = $3, active = $4`, [id, name, config, s(f, 'active') !== '0'])
  await audit(c.real.id, 'source.save', 'source', id, { projects, houses })
  revalidatePath('/sources')
  return { ok: true }
}
export async function runPbSource(_: unknown, f: FormData) {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role) || c.impersonating) return { error: t(c.lang, 'Нет прав') }
  const src = await one<{ id: string; config: unknown }>(`select id, config from sources where id = $1 and kind = 'profitbase'`, [s(f, 'id')])
  if (!src) return { error: 'source' }
  // Один прогон за раз: если tick уже идёт (прогон «running» моложе 10 минут) — не запускаем второй
  if (await one(`select 1 from sync_runs where source_id = $1 and status = 'running' and started_at > now() - interval '10 minutes'`, [src.id])) return { error: t(c.lang, 'Прогон уже идёт — подождите') }
  const r = await pbSync(q, tx, src as never, { full: s(f, 'full') === '1', notify: (u: string, k: string, text: string, link: string, vars: Record<string, string>) => notify(u, k, text, link, vars) })
  await audit(c.real.id, 'source.run', 'source', src.id, { ok: r.ok, changed: r.changed })
  revalidatePath('/sources')
  return r.ok ? { ok: true, made: r.changed } : { error: r.error || 'error' }
}
export async function saveStatusMap(f: FormData) {
  const c = await owner()
  const src = s(f, 'source')
  for (const [k, v] of f.entries()) if (k.startsWith('st:') && ['available', 'reserved', 'sold', 'unavailable'].includes(String(v)))
    await q(`update status_map set status = $3 where source_id = $1 and external_status = $2`, [src, k.slice(3), String(v)])
  await audit(c.real.id, 'source.status_map', 'source', src)
  revalidatePath('/sources')
}
export async function retryPbOutbox(f: FormData) {
  await owner()
  await q(`update portal.pb_outbox set state = 'pending', attempts = 0 where id = $1 and state in ('error','skipped')`, [s(f, 'id')])
  revalidatePath('/sources')
}
