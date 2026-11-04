// systemd OnFailure для tick: служба упала целиком — уведомление владельцу (не чаще раза в час)
import fs from 'node:fs'
import pg from 'pg'
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect()
const key = 'tick-down:' + new Date().toISOString().slice(0, 13)
for (const o of (await db.query(`select id from portal.users where active and role = 'owner'`)).rows)
  await db.query(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1,'access','Фоновая обработка портала упала — проверьте журнал службы tick', '/admin/journal', '{}', $2) on conflict (dedup) where dedup is not null do nothing`, [o.id, key + ':' + o.id])
await db.end()
