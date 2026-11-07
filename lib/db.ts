import { Pool, PoolClient } from 'pg'

// Один пул на процесс (в dev переживает горячую перезагрузку)
const g = globalThis as unknown as { __pool?: Pool }
export const pool = g.__pool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: '-c timezone=Asia/Baku' }) // «сегодня» в SQL — по Баку
if (process.env.NODE_ENV !== 'production') g.__pool = pool

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params)
  return r.rows as T[]
}
export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0]
}
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

export async function audit(userId: string | null, action: string, entity?: string, entityId?: string, data?: unknown, asUserId?: string | null) {
  await pool.query('insert into portal.audit (user_id, as_user_id, action, entity, entity_id, data) values ($1,$2,$3,$4,$5,$6)', [userId, asUserId ?? null, action, entity ?? null, entityId ?? null, data ? JSON.stringify(data) : null])
}

export async function notify(userId: string, kind: string, text: string, link?: string, vars?: Record<string, string | number>) {
  await pool.query('insert into portal.notifications (user_id, kind, text, link, vars) values ($1,$2,$3,$4,$5)', [userId, kind, text, link ?? null, vars ? JSON.stringify(vars) : null])
}

// Блокировка по ключам (телефон, e-mail) на время проверки «чей клиент» и создания: два одновременных запроса с одним человеком
// выполняются по очереди (QA 09.11 — гонка давала двух закреплённых клиентов). Ключи — те же, что у заявок сайтов (lib/leads.ts).
export async function withKeyLock<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const ks = Array.from(new Set(keys.filter(Boolean))).sort()
  if (!ks.length) return fn()
  const c = await pool.connect()
  try {
    for (const k of ks) await c.query('select pg_advisory_lock(hashtext($1))', ['lead:' + k])
    return await fn()
  } finally {
    for (const k of ks.reverse()) await c.query('select pg_advisory_unlock(hashtext($1))', ['lead:' + k]).catch(() => null)
    c.release()
  }
}
export const personKeys = (phoneNorm: string, emailNorm: string) => [phoneNorm.length >= 9 ? 'p:' + phoneNorm.slice(-9) : '', emailNorm ? 'e:' + emailNorm : '']
