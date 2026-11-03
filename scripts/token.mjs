// Dev: подписать cookie сессии (ge_s) для пользователя по e-mail — для проверки страниц curl'ом и автотестов.
// Локально берёт .env.local; на стенде — переменные окружения: set -a; . /opt/ge-portal2/portal.env; node scripts/token.mjs <email>
import fs from 'node:fs'
import pg from 'pg'
import { SignJWT } from 'jose'
const env = process.env.DATABASE_URL && process.env.SESSION_SECRET ? process.env : Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const db = new pg.Client({ connectionString: env.DATABASE_URL }); await db.connect()
const u = (await db.query('select id, session_ver from portal.users where email = $1', [process.argv[2]])).rows[0]; await db.end()
process.stdout.write(await new SignJWT({ uid: u.id, as: null, ver: u.session_ver }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1d').sign(new TextEncoder().encode(env.SESSION_SECRET)))
