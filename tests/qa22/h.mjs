// QA 2.2 — помощники сквозных тестов. Запуск на ams против QA-экземпляра (:3043, база seabreeze_qa22):
//   cd /opt/ge-portal22/src && set -a && . /opt/ge-portal22/qa.env && set +a && node --test --test-concurrency=1 tests/qa22/
// Каждый прогон создаёт своих пользователей и клиентов с меткой RUN (e-mail …@qa.test, имена «QA …»).
import pg from 'pg'
import crypto from 'node:crypto'
import { SignJWT } from 'jose'
import assert from 'node:assert/strict'

export const BASE = process.env.QA_URL || 'http://127.0.0.1:3043'
if (!/seabreeze_qa/.test(process.env.DATABASE_URL || '')) throw new Error('QA: DATABASE_URL должен указывать на seabreeze_qa* — стенд и бой не трогаем')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, options: '-c timezone=Asia/Baku' })
export const q = async (s, p = []) => (await pool.query(s, p)).rows
export const one = async (s, p = []) => (await q(s, p))[0]
export const close = () => pool.end()
export const RUN = Date.now().toString(36).slice(-5) + crypto.randomBytes(2).toString('hex')
let seq = 0
export const uniq = (p = 'x') => `${p}${RUN}${++seq}`
// телефон: уникальные последние 9 цифр на прогон
export const phone = () => '+49 15' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')

export async function agency(market = 'DE') {
  return one(`insert into portal.agencies (name, market) values ($1,$2) returning id, name`, [`QA Agency ${uniq()}`, market])
}
export async function user(role, o = {}) {
  const email = `qa-${role}-${uniq()}@qa.test`
  return one(`insert into portal.users (email, name, password_hash, password_set, role, market, locale, agency_id, curator_id, created_at, partner_form, tax_no, languages)
    values ($1,$2,'!',false,$3,$4,$5,$6,$7, coalesce($8, now()), $9, $10, $11) returning *`,
    [email, o.name || `QA ${role} ${RUN}`, role, o.market === undefined ? 'DE' : o.market, o.locale || 'ru', o.agency_id || null, o.curator_id || null, o.created_at || null, o.partner_form || null, o.tax_no || null, o.languages || []])
}
export async function cookie(u) {
  const r = await one('select session_ver from portal.users where id = $1', [u.id])
  return new SignJWT({ uid: u.id, as: null, ver: r.session_ver }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SESSION_SECRET))
}
// Вызов серверного действия от имени пользователя (null — публичное действие без входа)
export async function act(u, action, fields = {}, extra = {}) {
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update('qa:' + action).digest('hex')
  const r = await fetch(`${BASE}/api/internal/qa`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qa': sig }, body: JSON.stringify({ as: u?.id || null, action, fields, ...extra }) })
  const j = await r.json()
  if (r.status !== 200) throw new Error(`QA route ${r.status}: ${JSON.stringify(j)}`)
  return j
}
// Страница под пользователем: статус, куда редирект, html
export async function page(u, path) {
  const headers = { host: 'portal.pdna.pro' }
  if (u) headers.cookie = `ge_s=${await cookie(u)}`
  const r = await fetch(BASE + path, { headers, redirect: 'manual' })
  return { status: r.status, location: r.headers.get('location') || '', html: r.status === 200 ? await r.text() : '' }
}
export const ok200 = async (u, path) => { const p = await page(u, path); assert.equal(p.status, 200, `${path} → ${p.status} ${p.location}`); return p }
export const denied = async (u, path) => { const p = await page(u, path); assert.ok(p.status !== 200 || /Нет доступа|not found|404/i.test(p.html.slice(0, 400)), `${path} должен быть закрыт, а открылся (200)`); return p }

// Свободная квартира проекта (в продаже, с ценой, без броней и сделок, не скрыта)
export async function freeUnit(slug = 'premium-residence', o = {}) {
  const r = await one(`select u.id, portal.unit_no(bl.external_id, u.number) no, u.price_list::float price, u.project_id from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id
    where p.slug = $1 and u.status = 'available' and u.price_list is not null and u.unit_type in ('studio','1br','2br')
      and not exists (select 1 from portal.unit_hidden h where h.unit_id = u.id)
      and not exists (select 1 from portal.bookings b where b.unit_id = u.id and b.status in ('hold','queued','requested','confirmed','release_pending','converted'))
      and not exists (select 1 from portal.deals d where d.unit_id = u.id and d.stage <> 'cancelled')
      and not (u.id = any($2::uuid[]))
    order by random() limit 1`, [slug, o.exclude || []])
  assert.ok(r, `нет свободной квартиры в ${slug}`)
  return r
}
export const project = (slug) => one(`select p.id, p.name, p.slug from projects p where slug = $1`, [slug])

// Клиент через настоящую регистрацию (партнёр — кандидат; команда — закреплён)
export async function register(u, o = {}) {
  const f = { name: o.name || `QA Client ${uniq()}`, phone: o.phone ?? phone(), email: o.email ?? `${uniq('c')}@qa.test`, country: o.country ?? 'DE', language: o.language ?? 'de', consent: 'on', ...(o.fields || {}) }
  if (o.noConsent) delete f.consent
  const r = await act(u, 'registerClient', f)
  return { ...r, input: f, client: r.result?.id ? await one('select * from portal.clients where id = $1', [r.result.id]) : null }
}
export const qualify = (u, clientId, o = {}) => act(u, 'saveQualification', { client: clientId, goal: 'invest', budget: '200-300k', timeline: '3m', country: o.country ?? 'DE', language: o.language ?? 'de', payment: '', interest: '', ...(o.fields || {}) })
export const client = (id) => one('select * from portal.clients where id = $1', [id])
export const booking = (id) => one('select * from portal.bookings where id = $1', [id])
export const lastBooking = (clientId) => one('select * from portal.bookings where client_id = $1 order by created_at desc limit 1', [clientId])
// Прогон фонового обработчика (tick) на QA-базе
export async function tick() {
  const { execFileSync } = await import('node:child_process')
  return execFileSync('node', ['scripts/tick.mjs'], { env: process.env, encoding: 'utf8', timeout: 180000 })
}
export const findings = []
// «Мягкая» проверка: не валит прогон, а копит замечания (для i18n и UX)
export const note = (area, text) => findings.push(`${area}: ${text}`)
