// Тестовые данные портала: пользователи всех ролей, условия проектов, клиенты, брони, подборка, сделка.
// Пароли генерируются и пишутся в TEST-ACCESS.md (в git не попадает). Повторный запуск всё пересоздаёт.
import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const env = Object.fromEntries(fs.readFileSync(process.argv[2] || '.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const db = new pg.Client({ connectionString: env.DATABASE_URL })
await db.connect()
const q = (s, p) => db.query(s, p)
const one = async (s, p) => (await q(s, p)).rows[0]

await q('begin')
for (const t of ['audit', 'notifications', 'selection_items', 'selections', 'deals', 'bookings', 'tasks', 'activities', 'fixations', 'clients', 'agent_rates', 'conditions', 'agent_applications', 'genplans']) await q(`delete from portal.${t}`)
await q('update portal.users set curator_id = null')
await q('delete from portal.users')
await q('delete from portal.agencies')

const pr = await one(`select id from projects where slug = 'premium-residence'`)
const br = await one(`select id from projects where slug = 'brabus-island-baku'`)
const unit = async (slug, code) => {
  const [b, num] = code.includes('-') && slug === 'premium-residence' ? code.split(/-(.+)/) : [null, code]
  const r = await one(`select u.id, u.price_list from units u join projects p on p.id = u.project_id join buildings bl on bl.id = u.building_id
    where p.slug = $1 and u.number = $2 and ($3::text is null or bl.external_id = $3)`, [slug, num, b])
  if (!r) throw new Error('unit not found ' + code)
  return r
}

const agency = await one(`insert into portal.agencies (name, market) values ('Weber Immobilien GmbH', 'DE') returning id`)
const pass = () => crypto.randomBytes(6).toString('base64url')
const pin = () => String(1000 + crypto.randomInt(9000))
const people = [
  ['owner', 'denis@demo.getsestate', 'Денис', 'owner', 'GLOBAL', 'ru'],
  ['de_head', 'anna.becker@demo.getsestate', 'Анна Беккер', 'market_head', 'DE', 'ru'],
  ['de_seller', 'martin.schulz@demo.getsestate', 'Мартин Шульц', 'seller', 'DE', 'ru'],
  ['il_seller', 'noam.cohen@demo.getsestate', 'Ноам Коэн', 'seller', 'IL', 'ru'],
  ['office', 'leyla.baku@demo.getsestate', 'Лейла · офис Баку', 'office', 'GLOBAL', 'ru'],
  ['finance', 'irina.finance@demo.getsestate', 'Ирина · финансы', 'finance', 'GLOBAL', 'ru'],
  ['content', 'olga.content@demo.getsestate', 'Ольга · контент', 'content', 'GLOBAL', 'ru'],
  ['agency', 'lukas.weber@demo.getsestate', 'Lukas Weber', 'agency_head', 'DE', 'de'],
  ['agent_de', 'sophie.lang@demo.getsestate', 'Sophie Lang', 'agent', 'DE', 'de'],
  ['agent_il', 'david.levi@demo.getsestate', 'David Levi', 'agent', 'IL', 'he'],
]
const U = {}
const access = ['# Тестовые доступы · ge-portal.pdna.pro', '', 'Тестовый стенд, данные тестовые. PIN — для выхода из режима показа клиенту.', '', '| Роль | Кто | E-mail | Пароль | PIN |', '| --- | --- | --- | --- | --- |']
for (const [key, email, name, role, market, locale] of people) {
  const pw = pass(), pn = pin()
  const r = await one(`insert into portal.users (email, name, password_hash, pin_hash, role, market, locale, agency_id, license_note, contract_signed_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [email, name, bcrypt.hashSync(pw, 10), bcrypt.hashSync(pn, 10), role, market, locale,
     ['agency', 'agent_de'].includes(key) ? agency.id : null,
     role === 'agent' || role === 'agency_head' ? (market === 'DE' ? '§34c GewO, IHK München' : 'רישיון מתווך · ожидает проверки') : null,
     role === 'agent' || role === 'agency_head' ? '2026-10-20' : null])
  U[key] = r.id
  access.push(`| ${role} | ${name} | ${email} | ${pw} | ${pn} |`)
}
await q('update portal.users set curator_id = $1 where id in ($2, $3)', [U.de_seller, U.agency, U.agent_de])
await q('update portal.users set curator_id = $1 where id = $2', [U.il_seller, U.agent_il])

// Условия: Premium — 5% + пул 20%, агенту 2% + 10%; BRABUS — тестовые
const plans = JSON.stringify([{ name: '100% сразу', note: 'скидка — из пула' }, { name: 'Рассрочка', note: '[условия застройщика: взнос, срок, удорожание]' }])
const cPR = await one(`insert into portal.conditions (project_id, version, status, valid_from, fix_pct, pool_pct, agent_fix_pct, agent_pool_pct, seller_share_pct, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing, payment_plans, created_by)
  values ($1, 1, 'published', '2026-10-21', 5, 20, 2, 10, 15, 3, 3, 3, 10, 'after_first_payment', $2, $3) returning id`, [pr.id, plans, U.owner])
await q(`insert into portal.conditions (project_id, version, status, valid_from, fix_pct, pool_pct, agent_fix_pct, agent_pool_pct, seller_share_pct, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing, payment_plans, created_by, note)
  values ($1, 2, 'draft', '2026-11-01', 5, 20, 2, 10, 15, 3, 3, 4, 10, 'after_first_payment', $2, $3, 'Черновик: лимит агента 4')`, [pr.id, plans, U.owner])
await q(`insert into portal.conditions (project_id, version, status, valid_from, fix_pct, pool_pct, agent_fix_pct, agent_pool_pct, seller_share_pct, protect_months, max_bookings_client, max_bookings_agent, max_bookings_total, pay_timing, payment_plans, created_by, note)
  values ($1, 1, 'published', '2026-10-21', 4, 15, 1.5, 7, 15, 3, 3, 3, 5, 'deposit_35', $2, $3, 'Тестовые условия')`, [br.id, plans, U.owner])
await q(`insert into portal.agent_rates (project_id, agency_id, agent_fix_pct, agent_pool_pct, note) values ($1, $2, 2.5, 12, 'Исключение для агентства')`, [pr.id, agency.id])

// Генплан Premium: рендер 1800×1202, контуры домов в долях (привязка блоков — пример)
const poly = (pts) => pts.map(([x, y]) => [+(x / 1800).toFixed(4), +(y / 1202).toFixed(4)])
await q(`insert into portal.genplans (project_id, image, polygons, note) values ($1, '/img/pr-aerial.jpg', $2, 'Привязка блоков к домам — пример, уточнить по генплану застройщика')`, [pr.id, JSON.stringify([
  { block: 'A', points: poly([[0, 100], [640, 100], [640, 1050], [0, 1050]]), label: [0.14, 0.43] },
  { block: 'B', points: poly([[600, 150], [770, 150], [770, 520], [600, 520]]), label: [0.31, 0.22] },
  { block: 'C', points: poly([[1050, 150], [1230, 150], [1230, 520], [1050, 520]]), label: [0.55, 0.22] },
  { block: 'D', points: poly([[1170, 170], [1790, 170], [1790, 1050], [1170, 1050]]), label: [0.77, 0.47] },
])])

// Клиенты
let regN = 140
const addClient = async (owner, agencyId, c) => {
  regN++
  const r = await one(`insert into portal.clients (reg_no, owner_id, agency_id, name, phone, phone_norm, email, email_norm, country, language, market, consent_at, source, goal, budget, timeline, payment, interest, stage, protected_until, kyc_status, created_at, last_activity_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - interval '3 days',$12,$13,$14,$15,$16,$17,$18,$19,$20, now() - ($21 || ' days')::interval, now() - ($22 || ' days')::interval) returning id`,
    [`R-2026-0${regN}`, owner, agencyId, c.name, c.phone, c.phone.replace(/\D/g, ''), c.email, c.email.toLowerCase(), c.country, c.lang, c.market, c.source, c.goal || null, c.budget || null, c.timeline || null, c.payment || null, c.interest || null, c.stage, c.protect || '2027-01-23', c.kyc || 'none', c.age || 5, c.idle ?? 1])
  return r.id
}
const C = {}
C.michael = await addClient(U.agent_de, agency.id, { name: 'Michael Krause', phone: '+49 151 2345 6789', email: 'm.krause@example.de', country: 'DE', lang: 'de', market: 'DE', source: 'agent', goal: 'Eigennutzung + Vermietung', budget: '$150–200k', timeline: 'bis Frühjahr 2027', payment: 'Ratenzahlung', interest: 'Premium, 2–3 Zimmer', stage: 'selection', age: 1, idle: 0 })
C.anna = await addClient(U.agent_de, agency.id, { name: 'Anna Schmidt', phone: '+49 160 555 1212', email: 'anna.schmidt@example.de', country: 'DE', lang: 'de', market: 'DE', source: 'agent', goal: 'Urlaub', budget: '$200k', timeline: '2026', payment: '100%', interest: 'Premium, Bali', stage: 'booking', kyc: 'passed', age: 12, idle: 1 })
C.jonas = await addClient(U.agent_de, agency.id, { name: 'Jonas Becker', phone: '+43 664 123 4567', email: 'j.becker@example.at', country: 'AT', lang: 'de', market: 'DE', source: 'agent', stage: 'fixation', age: 2, idle: 1 })
C.irina = await addClient(U.agent_de, agency.id, { name: 'Ирина Волкова', phone: '+49 171 999 0000', email: 'irina.v@example.de', country: 'DE', lang: 'ru', market: 'DE', source: 'agent', stage: 'lead', age: 45, idle: 45 })
C.peter = await addClient(U.agency, agency.id, { name: 'Peter Klein', phone: '+49 89 1234 567', email: 'peter.klein@example.de', country: 'DE', lang: 'de', market: 'DE', source: 'agent', goal: 'Vermietung', budget: '$150–200k', stage: 'qualify', age: 6, idle: 2 })
C.thomas = await addClient(U.agency, agency.id, { name: 'Thomas Fischer', phone: '+49 30 7777 888', email: 'th.fischer@example.de', country: 'DE', lang: 'de', market: 'DE', source: 'agent', goal: 'Eigennutzung', budget: '$120k', stage: 'contract', kyc: 'passed', age: 30, idle: 4 })
C.noa = await addClient(U.il_seller, null, { name: 'נועה לוי · Noa Levi', phone: '+972 52 123 4567', email: 'noa.levi@example.co.il', country: 'IL', lang: 'he', market: 'IL', source: 'site IL · Meta', goal: 'инвестиция', budget: '$120–150k', timeline: 'ноябрь', payment: 'частями', interest: 'Premium', stage: 'booking', kyc: 'passed', age: 9, idle: 0 })
C.yossi = await addClient(U.agent_il, null, { name: 'יוסי כהן · Yossi Cohen', phone: '+972 54 765 4321', email: 'yossi.cohen@example.co.il', country: 'IL', lang: 'he', market: 'IL', source: 'agent', stage: 'viewing', age: 7, idle: 2 })
C.dirk = await addClient(U.de_seller, null, { name: 'Dirk Lange', phone: '+49 221 333 444', email: 'dirk.lange@example.de', country: 'DE', lang: 'de', market: 'DE', source: 'site DE', stage: 'lead', age: 1, idle: 0 })
await q(`update portal.clients set pause_until = '2027-01-15' where id = $1`, [C.irina])

for (const [c, p, st] of [[C.jonas, pr.id, 'approved'], [C.michael, pr.id, 'approved'], [C.anna, pr.id, 'approved'], [C.thomas, pr.id, 'approved'], [C.noa, pr.id, 'approved'], [C.peter, pr.id, 'sent'], [C.yossi, pr.id, 'sent']])
  await q(`insert into portal.fixations (client_id, project_id, status, decided_at, protected_until) values ($1,$2,$3, case when $3 = 'approved' then now() - interval '1 day' end, case when $3 = 'approved' then date '2027-10-23' end)`, [c, p, st])

const act = (c, u, kind, text, internal = false, days = 0, vars = null) => q(`insert into portal.activities (client_id, user_id, kind, text, internal, created_at, vars) values ($1,$2,$3,$4,$5, now() - ($6 || ' hours')::interval, $7)`, [c, u, kind, text, internal, days * 24, vars && JSON.stringify(vars)])
await act(C.michael, U.agent_de, 'system', 'Клиент зарегистрирован ({r}), закреплён до {d}', false, 1.1, { r: 'R-2026-0141', d: '2027-01-23' })
await act(C.michael, U.agent_de, 'call', 'Interessiert an Vermietung, Budget bis 200.000 $', false, 1)
await act(C.michael, null, 'system', 'Застройщик одобрил фиксацию', false, 0.6)
await act(C.michael, null, 'system', 'Клиент открыл подборку (раз: {n})', false, 0.1, { n: 2 })
await act(C.noa, U.il_seller, 'message', 'WhatsApp: спрашивает, можно ли платить частями после брони', false, 0.2)
await act(C.noa, U.de_head, 'note', 'Скидку больше 5% не обещать — ждём акцию застройщика', true, 1)
await act(C.noa, U.il_seller, 'call', 'Обсудили KYC и тур 10–12 ноября, нужен трансфер', false, 1.1)
await act(C.thomas, null, 'system', 'договор подписан, ждём платёж', false, 4)
await q(`insert into portal.tasks (client_id, user_id, title, due, auto) values ($1,$2,'Anrufen: hat die Auswahl 2-mal geöffnet', current_date, true), ($3,$4,'Ответить про рассрочку', current_date, false), ($3,$4,'Заявка офису: тур 10–12.11', current_date + 3, false)`, [C.michael, U.agent_de, C.noa, U.il_seller])

// Брони и сделка
const snap = (agentFix, agentPool) => JSON.stringify({ fix_pct: 5, pool_pct: 20, agent_fix_pct: agentFix, agent_pool_pct: agentPool, seller_share_pct: 15, version: 1 })
const book = async (slug, num, client, agent, status, disc, daysLeft, snapAgent = [2, 10]) => {
  const u = await unit(slug, num)
  const fin = Math.round(u.price_list * (1 - disc / 100))
  const r = await one(`insert into portal.bookings (unit_id, project_id, client_id, agent_id, status, price_list, discount_pct, final_price, conditions_id, snapshot, starts_at, ends_at, confirmed_by, confirmed_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - interval '2 days', now() + ($11 || ' days')::interval, $12, case when $5 = 'confirmed' then now() - interval '1 day' end) returning id`,
    [u.id, slug === 'premium-residence' ? pr.id : br.id, client, agent, status, u.price_list, disc, fin, cPR.id, snap(...snapAgent), daysLeft, status === 'confirmed' ? U.office : null])
  return { id: r.id, unit: u.id, fin }
}
await book('premium-residence', 'D-1205d', C.michael, U.agent_de, 'confirmed', 6, 13, [2.5, 12])
await book('premium-residence', 'B-704', C.anna, U.agent_de, 'confirmed', 5, 2, [2.5, 12])
await book('premium-residence', 'C-912', C.noa, U.il_seller, 'confirmed', 4, 2)
await book('premium-residence', 'D-908', C.yossi, U.agent_il, 'requested', 8, 14)
const th = await book('premium-residence', 'D-716', C.thomas, U.agency, 'converted', 7, 0, [2.5, 12])
const fin = th.fin, list = Math.round(fin / 0.93)
const agentAmt = Math.round(fin * 0.025 + list * 0.05), ourAmt = Math.round(fin * 0.025 + list * 0.08 + list * 0.05 - list * 0.05)
await q(`insert into portal.deals (booking_id, client_id, unit_id, project_id, agent_id, seller_id, stage, final_price, agent_amount, our_amount, seller_amount, paid_pct) values ($1,$2,$3,$4,$5,$6,'payments',$7,$8,$9,$10,30)`,
  [th.id, C.thomas, th.unit, pr.id, U.agency, U.de_seller, fin, agentAmt, ourAmt, Math.round(ourAmt * 0.15)])

// Подборка
const tok = crypto.randomBytes(9).toString('base64url')
const sel = await one(`insert into portal.selections (token, client_id, user_id, title, lang, opened, last_opened_at) values ($1,$2,$3,'Premium · 4 Wohnungen','de',2, now() - interval '2 hours') returning id`, [tok, C.michael, U.agent_de])
let i = 0
for (const [num, note] of [['D-816', 'Ruhige Seite, Blick in den Innenhof'], ['B-914', ''], ['C-912', 'Gut zur Vermietung'], ['D-316', '']]) {
  const u = await unit('premium-residence', num); await q(`insert into portal.selection_items (selection_id, unit_id, note, sort) values ($1,$2,$3,$4)`, [sel.id, u.id, note || null, i++])
}
access.push('', `Пример подборки для клиента (публичная ссылка): /s/${tok}`)

// Заявки агентов
await q(`insert into portal.agent_applications (kind, name, company, email, phone, city, languages, license, volume, channels, market, status) values
  ('agency','Markus Hoffmann','Hoffmann & Partner Immobilien','m.hoffmann@example.de','+49 40 555 0101','Hamburg','DE, EN','§34c GewO · файл приложен','20–40','своя база, мероприятия','DE','new'),
  ('agent','Elena Petrova',null,'elena.p@example.de','+49 176 222 3344','Berlin','RU, DE','нет','5–10','русскоязычное сообщество','DE','review'),
  ('agent','Avi Ben-David',null,'avi.bd@example.co.il','+972 50 444 5566','Tel Aviv','HE, EN','רישיון מתווך 12345','10–20','инвест-клубы','IL','new')`)

// Уведомления
for (const [u, k, t, l, v] of [[U.agent_de, 'selection', '{c} открыл подборку — хороший момент позвонить', `/clients/${C.michael}`, { c: 'Michael Krause' }], [U.agent_de, 'booking', 'Бронь {u} истекает через {d} дн.', '/bookings', { u: 'B-704', d: 2 }], [U.agent_de, 'fixation', 'Фиксация одобрена: {c}', `/clients/${C.jonas}`, { c: 'Jonas Becker' }], [U.office, 'booking', 'Новая бронь {u} ждёт подтверждения у застройщика', '/bookings', { u: 'D-908' }], [U.owner, 'application', 'Новая заявка: {n}', '/admin/agents', { n: 'Hoffmann & Partner' }]])
  await q(`insert into portal.notifications (user_id, kind, text, link, vars) values ($1,$2,$3,$4,$5)`, [u, k, t, l, JSON.stringify(v)])

await q(`insert into portal.audit (user_id, action, entity, entity_id, data) values ($1, 'conditions.publish', 'conditions', $2, '{"project":"premium-residence","version":1}')`, [U.owner, cPR.id])
await q('commit')
fs.writeFileSync('TEST-ACCESS.md', access.join('\n') + '\n', { mode: 0o600 })
console.log('seed ok; users', Object.keys(U).length)
await db.end()
