// 2.2 · §13 Обмен с Bitrix24 — фоновый обработчик (systemd-таймер раз в минуту): досылает очередь portal.b24_jobs (≤ 2 запроса в секунду)
// и забирает изменения из Bitrix24 (сделки, лиды, контакты; комментарии — раз в 5 минут; сотрудники и сверка — раз в час).
// Второй экземпляр не стартует: advisory lock в базе. Без B24_WEBHOOK — выходит сразу.
import fs from 'node:fs'
import pg from 'pg'
import { b24on, setGap, runQueue, pull } from '../lib/b24x.mjs'

if (!b24on()) { console.log(new Date().toISOString(), 'B24_WEBHOOK не задан'); process.exit(0) }
const url = process.env.DATABASE_URL || Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])).DATABASE_URL
const db = new pg.Client({ connectionString: url, options: '-c timezone=Asia/Baku' })
await db.connect()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const out = {}
if (!(await q('select pg_try_advisory_lock(242413) ok'))[0].ok) { console.log(new Date().toISOString(), 'уже работает'); await db.end(); process.exit(0) }
try {
  setGap(520)
  const t0 = Date.now()
  out.queue = await runQueue(q, t0 + 25000)
  await pull(q, out)
  out.queue_left = (await q(`select count(*)::int n from portal.b24_jobs where status in ('pending','error')`))[0].n
  out.ms = Date.now() - t0
  // Синхронизация молчит больше часа или задачи умерли — админу (раз в час)
  const dead = (await q(`select count(*)::int n from portal.b24_jobs where status = 'dead' and updated_at > now() - interval '1 hour'`))[0].n
  const errs = Object.keys(out).filter((k) => k.endsWith('_error'))
  if (dead || errs.length) for (const o of await q(`select id from portal.users where active and role = 'owner'`))
    await q(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1, 'access', 'Обмен с Bitrix24: ошибки — {e}', '/admin/b24', $2, $3) on conflict (dedup) where dedup is not null do nothing`,
      [o.id, JSON.stringify({ e: [dead ? `не доставлено ${dead}` : '', ...errs.map((k) => `${k}: ${out[k]}`)].filter(Boolean).join('; ').slice(0, 300) }), 'b24-err:' + new Date().toISOString().slice(0, 13) + ':' + o.id])
  await q(`insert into portal.kv (key, value) values ('b24:last_run', $1) on conflict (key) do update set value = $1, updated_at = now()`, [JSON.stringify({ at: new Date().toISOString(), ...out })])
} finally {
  await db.end()
}
console.log(new Date().toISOString(), JSON.stringify(out))
