// Применяет новые миграции из db/migrations к схеме portal.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const env = Object.fromEntries(fs.readFileSync(process.argv[2] || '.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const db = new pg.Client({ connectionString: env.DATABASE_URL })
await db.connect()
await db.query('create table if not exists portal.schema_migrations (name text primary key, applied_at timestamptz not null default now())')
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'db', 'migrations')
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const done = await db.query('select 1 from portal.schema_migrations where name = $1', [f])
  if (done.rowCount) continue
  await db.query('begin')
  await db.query(fs.readFileSync(path.join(dir, f), 'utf8'))
  await db.query('insert into portal.schema_migrations (name) values ($1)', [f])
  await db.query('commit')
  console.log('→', f)
}
await db.end()
