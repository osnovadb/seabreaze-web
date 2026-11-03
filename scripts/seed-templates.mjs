// Стартовые шаблоны документов (М8) из db/templates/<kind>.<lang>.docx: загружает недостающие и новые версии стартовых.
// Локально — .env.local; на стенде — переменные portal.env (как token.mjs). Не трогает шаблоны, загруженные через портал.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

const env = process.env.DATABASE_URL ? process.env : Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'db', 'templates')
const filesDir = env.FILES_DIR || './dev-files'
const NAMES = { booking_offer: 'Оферта брони (проект)', fixation_act: 'Акт фиксации (проект)', commission_act: 'Акт вознаграждения (проект)' }
const db = new pg.Client({ connectionString: env.DATABASE_URL }); await db.connect()
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.docx')).sort()) {
  const [kind, lang] = f.split('.')
  const buf = fs.readFileSync(path.join(dir, f))
  // есть версия, загруженная через портал (created_by не пуст), — не трогаем; стартовая и файл в репозитории изменился — новая версия
  const cur = (await db.query(`select t.id, t.version, t.created_by, f.disk_name from portal.doc_templates t join portal.files f on f.id = t.file_id where t.kind = $1 and t.lang = $2 order by t.version desc limit 1`, [kind, lang])).rows[0]
  if (cur && (cur.created_by || fs.readFileSync(path.join(filesDir, cur.disk_name)).equals(buf))) continue
  const vars = new Set()
  new Docxtemplater(new PizZip(buf), { paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' }, parser: (t) => { vars.add(t.trim()); return { get: () => '' } } }).render({})
  const id = crypto.randomUUID()
  fs.writeFileSync(path.join(filesDir, id + '.docx'), buf, { mode: 0o640 })
  await db.query(`insert into portal.files (id, filename, mime, size, disk_name) values ($1,$2,$3,$4,$5)`, [id, f, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf.length, id + '.docx'])
  if (cur) await db.query('update portal.doc_templates set active = false where kind = $1 and lang = $2', [kind, lang])
  await db.query(`insert into portal.doc_templates (kind, lang, version, name, file_id, vars) values ($1,$2,$3,$4,$5,$6)`, [kind, lang, (cur?.version || 0) + 1, NAMES[kind] || f, id, [...vars]])
  console.log('→', f, [...vars].length, 'переменных')
}
await db.end()
