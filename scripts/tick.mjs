// Фоновый обработчик портала (systemd-таймер раз в 15 минут): сроки броней, напоминания, правило молчания застройщика, автозадачи.
// Тексты — шаблоны словаря (русский ключ) + переменные; dedup не даёт одному напоминанию прийти дважды.
import fs from 'node:fs'
import pg from 'pg'

const url = process.env.DATABASE_URL || (() => {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  return env.DATABASE_URL
})()
const db = new pg.Client({ connectionString: url })
await db.connect()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const notify = (user, kind, text, link, vars, dedup) =>
  q(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1,$2,$3,$4,$5,$6) on conflict (dedup) where dedup is not null do nothing`, [user, kind, text, link, JSON.stringify(vars), dedup])
const task = (client, user, title, vars, dedup) =>
  q(`insert into portal.tasks (client_id, user_id, title, vars, due, auto, dedup) values ($1,$2,$3,$4, current_date, true, $5) on conflict (dedup) where dedup is not null do nothing`, [client, user, title, JSON.stringify(vars), dedup])
const out = {}

// 1. Истёкшие брони: срок вышел — квартира снова свободна, агенту и куратору уведомление
const expired = await q(`update portal.bookings b set status = 'expired' from units u join buildings bl on bl.id = u.building_id
  where u.id = b.unit_id and b.status in ('requested','confirmed') and b.ends_at < now()
  returning b.id, b.client_id, b.agent_id, coalesce(bl.external_id, '') || '-' || u.number as unit`)
for (const b of expired) {
  await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Бронь {u} истекла',$2)`, [b.client_id, JSON.stringify({ u: b.unit })])
  await notify(b.agent_id, 'booking', 'Бронь {u} истекла', '/bookings', { u: b.unit }, 'expired:' + b.id)
  const cur = (await q('select curator_id from portal.users where id = $1', [b.agent_id]))[0]?.curator_id
  if (cur) await notify(cur, 'booking', 'Бронь {u} истекла', '/bookings', { u: b.unit }, 'expired-c:' + b.id)
}
out.expired = expired.length

// 2. Бронь кончается через 3 дня или меньше
const soon = await q(`select b.id, b.agent_id, b.ends_at, coalesce(bl.external_id, '') || '-' || u.number as unit, ceil(extract(epoch from b.ends_at - now()) / 86400)::int as d
  from portal.bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
  where b.status in ('requested','confirmed') and b.ends_at < now() + interval '3 days'`)
for (const b of soon) await notify(b.agent_id, 'booking', 'Бронь {u} истекает через {d} дн.', '/bookings', { u: b.unit, d: b.d }, 'soon:' + b.id + ':' + (b.ends_at.toISOString?.() || b.ends_at))
out.soon = soon.length

// 3. Защита клиента заканчивается через неделю
const prot = await q(`select id, owner_id, name, protected_until::text d from portal.clients
  where stage not in ('lost','handed') and protected_until between current_date and current_date + 7`)
for (const c of prot) await notify(c.owner_id, 'client', 'Защита клиента {c} заканчивается {d}', '/clients/' + c.id, { c: c.name, d: c.d }, 'prot:' + c.id + ':' + c.d)
out.protection = prot.length

// 4. Правило молчания: застройщик не ответил на фиксацию 3 + 2 рабочих дня (считаем 5 календарных) — считается подтверждённой
const silent = await q(`update portal.fixations set status = 'approved', decided_at = now(), protected_until = current_date + interval '12 months'
  where status = 'sent' and sent_at < now() - interval '5 days' returning client_id, project_id`)
for (const f of silent) {
  const c = (await q('select owner_id, name from portal.clients where id = $1', [f.client_id]))[0]
  await q(`insert into portal.activities (client_id, kind, text) values ($1,'system','Застройщик не ответил 5 дней — фиксация считается подтверждённой')`, [f.client_id])
  if (c) await notify(c.owner_id, 'fixation', 'Фиксация одобрена: {c}', '/clients/' + f.client_id, { c: c.name }, 'silent:' + f.client_id + ':' + f.project_id)
}
out.silent = silent.length

// 5. Автозадачи: подборка не открыта 3 дня; квалификация без движения 7 дней
const unopened = await q(`select s.id, s.user_id, s.client_id, cl.name from portal.selections s join portal.clients cl on cl.id = s.client_id
  where s.opened = 0 and s.created_at < now() - interval '3 days' and cl.stage not in ('lost','handed')`)
for (const s of unopened) await task(s.client_id, s.user_id, 'Подборка не открыта 3 дня: {c}', { c: s.name }, 'unopened:' + s.id)
const idle = await q(`select id, owner_id, name, last_activity_at::date::text d from portal.clients
  where stage in ('lead','qualify') and pause_until is null and last_activity_at < now() - interval '7 days'`)
for (const c of idle) await task(c.id, c.owner_id, 'Нет движения 7 дней: {c}', { c: c.name }, 'idle:' + c.id + ':' + c.d)
out.tasks = unopened.length + idle.length

// 6. Пауза закончилась — клиент возвращается в работу
const back = await q(`update portal.clients set pause_until = null where pause_until is not null and pause_until <= current_date returning id, owner_id, name`)
for (const c of back) await task(c.id, c.owner_id, 'Вернуться к клиенту после паузы: {c}', { c: c.name }, 'pause:' + c.id + ':' + new Date().toISOString().slice(0, 10))
out.unpaused = back.length

// 7. Цена квартиры из подборки изменилась — владельцу подборки (клиент увидит новую цену по ссылке)
const changed = await q(`select ph.id, ph.unit_id, se.id sel, se.user_id, se.client_id, cl.name, coalesce(bl.external_id, '') || '-' || u.number unit
  from price_history ph join units u on u.id = ph.unit_id join buildings bl on bl.id = u.building_id
  join portal.selection_items si on si.unit_id = ph.unit_id join portal.selections se on se.id = si.selection_id join portal.clients cl on cl.id = se.client_id
  where ph.changed_at > now() - interval '1 day' and ph.changed_at > si.created_at
    and exists (select 1 from price_history p0 where p0.unit_id = ph.unit_id and p0.changed_at < ph.changed_at and p0.price is not null)`)
for (const r of changed) await notify(r.user_id, 'selection', 'Изменилась цена {u} в подборке для {c}', '/selections/' + r.sel, { u: r.unit, c: r.name }, 'selprice:' + r.id + ':' + r.sel)
out.selection_prices = changed.length

await db.end()
console.log(new Date().toISOString(), JSON.stringify(out))
