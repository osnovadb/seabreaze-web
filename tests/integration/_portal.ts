// Помощники для интеграционных тестов: вход через /dev/login, разбор форм server actions и отправка их без браузера.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import pg from 'pg'

export const URL0 = process.env.PORTAL_URL || ''
const env = fs.existsSync('.env.local') ? Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
export const DB = process.env.DATABASE_URL || env.DATABASE_URL || ''
// Только seabreeze_v2: интеграционные тесты пишут в базу
export const SKIP = !URL0 || !/seabreeze_v2/.test(DB) ? 'нужны PORTAL_URL и DATABASE_URL на seabreeze_v2' : false
export const U = { office: 'leyla.baku@demo.getsestate', owner: 'denis@demo.getsestate', head: 'anna.becker@demo.getsestate', seller: 'martin.schulz@demo.getsestate', agent: 'sophie.lang@demo.getsestate', agentIl: 'david.levi@demo.getsestate' }

export async function dbConnect() { const c = new pg.Client({ connectionString: DB }); await c.connect(); return c }
export async function login(email: string) {
  const r = await fetch(`${URL0}/dev/login?as=${encodeURIComponent(email)}`, { redirect: 'manual' })
  const c = (r.headers.get('set-cookie') || '').split(';')[0]
  assert.ok(c.startsWith('ge_s='), 'нет cookie сессии от /dev/login')
  return c
}
export async function page(cookie: string, path: string) { const r = await fetch(URL0 + path, { headers: { cookie }, redirect: 'manual' }); return { status: r.status, html: r.status === 200 ? await r.text() : '' } }

const unent = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
export type Form = { html: string; fields: [string, string][] }
// Все формы страницы со значениями полей (input/select: выбранное или первое)
export function forms(html: string): Form[] {
  return html.split('<form').slice(1).map((chunk) => {
    const body = chunk.slice(0, chunk.indexOf('</form>') + 1 || undefined)
    const fields: [string, string][] = []
    for (const m of body.matchAll(/<input\b([^>]*)>/g)) {
      const a = m[1], name = a.match(/\bname="([^"]*)"/)?.[1]; if (!name) continue
      const type = a.match(/\btype="([^"]*)"/)?.[1] || 'text'
      if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/.test(a)) continue
      fields.push([unent(name), unent(a.match(/\bvalue="([^"]*)"/)?.[1] ?? '')])
    }
    for (const m of body.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) {
      const opt = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/) || m[2].match(/<option[^>]*value="([^"]*)"/)
      fields.push([unent(m[1]), unent(opt?.[1] ?? '')])
    }
    return { html: body, fields }
  })
}
export const formWith = (html: string, ...names: string[]) => forms(html).find((f) => names.every((n) => f.fields.some(([k]) => k === n)))
// Отправка формы как без JS: все скрытые поля формы + свои значения
export async function submit(cookie: string, path: string, f: Form, values: Record<string, string>) {
  const fd = new FormData(); const set = new Set(Object.keys(values))
  for (const [k, v] of f.fields) if (!set.has(k)) fd.append(k, v)
  for (const [k, v] of Object.entries(values)) fd.append(k, v)
  const r = await fetch(URL0 + path, { method: 'POST', body: fd, headers: { cookie }, redirect: 'manual' })
  return { status: r.status, text: await r.text() }
}
// Итог графика платежей (таблица .sched, последняя строка) — в долларах
export function scheduleTotal(html: string) {
  const t = html.match(/<table class="tbl sched">([\s\S]*?)<\/table>/)?.[1]; if (!t) return null
  const last = t.split('<tr').pop() || ''
  const m = last.replace(/<[^>]+>/g, ' ').match(/\$\s?([\d.,\s ]+)/)
  return m ? Number(m[1].replace(/[^\d]/g, '')) : null
}
