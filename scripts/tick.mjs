// Фоновый обработчик портала (systemd-таймер раз в 15 минут): сроки броней, напоминания, правило молчания застройщика, автозадачи.
// Тексты — шаблоны словаря (русский ключ) + переменные; dedup не даёт одному напоминанию прийти дважды.
import fs from 'node:fs'
import pg from 'pg'
import { normFilter, matchUnit } from '../lib/unitMatch.mjs'
import { bestOffer } from '../lib/promoMatch.mjs'
import { notifyOut } from './notify-out.mjs'
import { pbSync, pbFlush } from '../lib/pb.mjs'

const url = process.env.DATABASE_URL || (() => {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  return env.DATABASE_URL
})()
const db = new pg.Client({ connectionString: url, options: '-c timezone=Asia/Baku' }) // current_date — по Баку
await db.connect()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const notify = (user, kind, text, link, vars, dedup) =>
  q(`insert into portal.notifications (user_id, kind, text, link, vars, dedup) values ($1,$2,$3,$4,$5,$6) on conflict (dedup) where dedup is not null do nothing`, [user, kind, text, link, JSON.stringify(vars), dedup])
const task = (client, user, title, vars, dedup) =>
  q(`insert into portal.tasks (client_id, user_id, title, vars, due, auto, dedup) values ($1,$2,$3,$4, current_date, true, $5) on conflict (dedup) where dedup is not null do nothing`, [client, user, title, JSON.stringify(vars), dedup])
const out = {}

// 1. Истёкшие брони: срок вышел — квартира снова свободна, агенту и куратору уведомление
// М3: подтверждённая бронь из Profitbase истекает — снять её и у застройщика (очередь pb_outbox, отправка в шаге 10)
await q(`insert into portal.pb_outbox (source_id, unit_id, booking_id, op, status_alias) select s.id, b.unit_id, b.id, 'release', 'AVAILABLE'
  from portal.bookings b join units u on u.id = b.unit_id join sources s on s.id = u.source_id and s.kind = 'profitbase' and s.active
  where b.status = 'confirmed' and b.ends_at < now()`)
const expired = await q(`update portal.bookings b set status = 'expired' from units u join buildings bl on bl.id = u.building_id
  where u.id = b.unit_id and b.status in ('requested','confirmed') and b.ends_at < now()
  returning b.id, b.client_id, b.agent_id, portal.unit_no(bl.external_id, u.number) as unit`)
for (const b of expired) {
  await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Бронь {u} истекла',$2)`, [b.client_id, JSON.stringify({ u: b.unit })])
  await notify(b.agent_id, 'booking', 'Бронь {u} истекла', '/bookings', { u: b.unit }, 'expired:' + b.id)
  const cur = (await q('select curator_id from portal.users where id = $1', [b.agent_id]))[0]?.curator_id
  if (cur) await notify(cur, 'booking', 'Бронь {u} истекла', '/bookings', { u: b.unit }, 'expired-c:' + b.id)
}
// Платная бронь истекла после оплаты взноса — финансам решить: вернуть или удержать
const feeLeft = await q(`select b.id from portal.bookings b where b.status = 'expired' and b.fee_status = 'paid' and b.ends_at > now() - interval '1 day'`)
if (feeLeft.length) for (const o of await q(`select id from portal.users where active and role in ('finance','owner')`)) for (const b of feeLeft) await notify(o.id, 'booking', 'Оплаченная бронь истекла — решите по взносу: вернуть или удержать', '/bookings?f=fee', {}, 'fee-left:' + b.id + ':' + o.id)
for (const cid of new Set(expired.map((b) => b.client_id))) await q('select portal.sync_client_stage($1)', [cid]) // бронь истекла — стадия клиента назад
out.expired = expired.length

// 2. Бронь кончается через 3 дня или меньше
const soon = await q(`select b.id, b.agent_id, b.ends_at, portal.unit_no(bl.external_id, u.number) as unit, ceil(extract(epoch from b.ends_at - now()) / 86400)::int as d
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
const changed = await q(`select ph.id, ph.unit_id, se.id sel, se.user_id, se.client_id, cl.name, portal.unit_no(bl.external_id, u.number) unit
  from price_history ph join units u on u.id = ph.unit_id join buildings bl on bl.id = u.building_id
  join portal.selection_items si on si.unit_id = ph.unit_id join portal.selections se on se.id = si.selection_id join portal.clients cl on cl.id = se.client_id
  where ph.changed_at > now() - interval '1 day' and ph.changed_at > si.created_at
    and exists (select 1 from price_history p0 where p0.unit_id = ph.unit_id and p0.changed_at < ph.changed_at and p0.price is not null)`)
for (const r of changed) await notify(r.user_id, 'selection', 'Изменилась цена {u} в подборке для {c}', '/selections/' + r.sel, { u: r.unit, c: r.name }, 'selprice:' + r.id + ':' + r.sel)
out.selection_prices = changed.length

// 7б. Акция закончилась — владельцу подборки, где есть квартира под этой акцией (цена по ссылке выросла)
const promoEnd = await q(`select o.id, o.name, se.id sel, se.user_id, cl.name client
  from portal.special_offers o join units u on u.project_id = o.project_id and (o.building_id is null or u.building_id = o.building_id) and (o.unit_ids is null or u.id = any(o.unit_ids))
  join portal.selection_items si on si.unit_id = u.id join portal.selections se on se.id = si.selection_id join portal.clients cl on cl.id = se.client_id
  where o.active and o.ends_on = current_date - 1 group by o.id, o.name, se.id, se.user_id, cl.name`)
for (const r of promoEnd) await notify(r.user_id, 'selection', 'Акция «{n}» закончилась — цены в подборке для {c} изменились', '/selections/' + r.sel, { n: r.name, c: r.client }, 'promoend:' + r.id + ':' + r.sel)
out.promo_ended = promoEnd.length

// 7в. Лист ожидания (М12): квартира свободна — первому в очереди сразу, следующему — через паузу проекта после предыдущего
const FREE = `u.status = 'available' and u.price_list is not null
  and not exists (select 1 from portal.bookings b where b.unit_id = u.id and b.status in ('requested','confirmed'))
  and not exists (select 1 from portal.deals d where d.unit_id = u.id and d.stage <> 'cancelled')`
const waitUnits = await q(`select u.id, portal.unit_no(bl.external_id, u.number) unit, coalesce(ps.waitlist_pause_hours, 24) pause,
    (select max(w.notified_at) from portal.waitlist w where w.unit_id = u.id and w.notified_at > now() - interval '30 days') last
  from units u join buildings bl on bl.id = u.building_id left join portal.project_settings ps on ps.project_id = u.project_id
  where ${FREE} and exists (select 1 from portal.waitlist w where w.unit_id = u.id and w.active)`)
let waitN = 0
for (const u of waitUnits) {
  if (u.last && Date.now() - new Date(u.last).getTime() < u.pause * 3600_000) continue
  // партнёру — только если квартира ему видна (не скрыта)
  const next = (await q(`select w.id, w.user_id, w.client_id, cl.name client from portal.waitlist w join portal.users us on us.id = w.user_id left join portal.clients cl on cl.id = w.client_id
    where w.unit_id = $1 and w.active and (us.role not in ('agent','agency_head') or (not exists (select 1 from portal.unit_hidden h where h.unit_id = w.unit_id)
      -- партнёру проект должен быть по-прежнему виден (как visibleSql в lib/catalog.ts)
      and exists (select 1 from units uu join portal.project_settings ps on ps.project_id = uu.project_id where uu.id = w.unit_id and ps.sales_status in ('sales','stop')
        and not exists (select 1 from portal.project_exceptions x where x.project_id = ps.project_id and not x.allow and (x.user_id = us.id or x.agency_id = us.agency_id))
        and (us.market = any(ps.agent_markets) or exists (select 1 from portal.project_exceptions x where x.project_id = ps.project_id and x.allow and (x.user_id = us.id or x.agency_id = us.agency_id))))))
    order by w.created_at limit 1`, [u.id]))[0]
  if (!next) continue
  await q(`update portal.waitlist set active = false, notified_at = now() where id = $1`, [next.id])
  await notify(next.user_id, 'waitlist', next.client ? 'Освободилась {u} — вы первый в очереди (клиент {c})' : 'Освободилась {u} — вы первый в очереди', '/units/' + u.id, { u: u.unit, c: next.client || '' }, 'wait:' + next.id)
  if (next.client_id) await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Освободилась квартира из листа ожидания: {u}',$2)`, [next.client_id, JSON.stringify({ u: u.unit })])
  waitN++
}
out.waitlist = waitN

// 7г. Сохранённые поиски (М12): новые подходящие свободные квартиры с прошлой проверки; первая проверка только запоминает
const searches = await q(`select s.id, s.user_id, s.name, s.filters, s.seen_ids, s.checked_at, us.role, us.agency_id, us.market from portal.saved_searches s join portal.users us on us.id = s.user_id where s.active and us.active`)
let searchN = 0
// Свободные квартиры с теми же расчётными полями, что в каталоге (комнаты — lib/catalog.ts roomsSql, цена — в долларах);
// акция — той же функцией bestOffer, что и в каталоге (lib/promoMatch.mjs), цена для фильтра — с акцией
const unitsOf = new Map(), offersOf = new Map()
const offers = async (project) => {
  if (!offersOf.has(project)) offersOf.set(project, await q(`select id, building_id, kind, value::float, currency, unit_ids from portal.special_offers
    where project_id = $1 and active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date) order by ends_on nulls last, created_at, id`, [project]))
  return offersOf.get(project)
}
const freeUnits = async (project, partner) => {
  const key = project + ':' + partner
  if (!unitsOf.has(key)) {
    const rows = await q(`select u.id, u.project_id, u.building_id, u.unit_type, u.floor, u.area_total_m2::float area, u.area_external_m2::float ext_area, u.plot_area_m2::float plot_area, u.view_side, u.is_corner,
        coalesce((u.raw->>'rooms')::int, case u.unit_type when 'studio' then 1 when '1br' then 2 when '2br' then 3 when '3br' then 4 else u.bedrooms + 1 end) rooms,
        u.price_list::float price, u.price_currency currency,
        (case when u.price_currency = 'USD' then u.price_list when u.price_currency = 'AZN' then u.price_list / (select azn_per_unit from currency_rates where currency = 'USD' order by valid_from desc limit 1)
          when u.price_currency = 'EUR' then u.price_list * (select azn_per_unit from currency_rates where currency = 'EUR' order by valid_from desc limit 1) / (select azn_per_unit from currency_rates where currency = 'USD' order by valid_from desc limit 1) end)::float usd /* как toUsdSql в lib/catalog.ts */
      from units u where u.project_id = $1 and ${FREE} and (not $2 or not exists (select 1 from portal.unit_hidden h where h.unit_id = u.id))`, [project, partner])
    const of = await offers(project)
    unitsOf.set(key, rows.map((u) => { const b = bestOffer(u, of); return { ...u, promo: !!b, net: u.usd != null ? u.usd - (b?.usd || 0) : null } }))
  }
  return unitsOf.get(key)
}
// Видимость проекта партнёру — как visibleSql в lib/catalog.ts: в продаже или стоп, рынок открыт или исключение «открыть»; «закрыть» сильнее
const visibleTo = async (s, project) => (await q(`select 1 from portal.project_settings ps where ps.project_id = $1 and ps.sales_status in ('sales','stop')
    and not exists (select 1 from portal.project_exceptions x where x.project_id = ps.project_id and not x.allow and (x.user_id = $2 or x.agency_id = $3))
    and ($4 = any(ps.agent_markets) or exists (select 1 from portal.project_exceptions x where x.project_id = ps.project_id and x.allow and (x.user_id = $2 or x.agency_id = $3)))`, [project, s.user_id, s.agency_id, s.market])).length > 0
for (const s of searches) {
  const nf = normFilter(s.filters)
  if (!nf.project) continue
  const partner = ['agent', 'agency_head'].includes(s.role)
  // Проект закрыли для партнёра после сохранения поиска — молчим и не запоминаем квартиры
  if (partner && !(await visibleTo(s, nf.project))) continue
  const ids = (await freeUnits(nf.project, partner)).filter((u) => matchUnit(u, nf)).map((r) => r.id)
  const fresh = s.checked_at ? ids.filter((id) => !s.seen_ids.includes(id)) : []
  if (fresh.length) {
    await notify(s.user_id, 'search', 'По поиску «{s}» новых квартир: {n}', '/waitlist', { s: s.name, n: fresh.length }, 'search:' + s.id + ':' + fresh.sort().join(',').slice(0, 200))
    searchN++
  }
  await q(`update portal.saved_searches set seen_ids = $2, checked_at = now() where id = $1`, [s.id, ids])
}
out.searches = searchN

// 7д. Очередь в Bitrix24 (М5): пока BITRIX_WEBHOOK не задан — копим; задан — отправляем с повторами (≤ 2 запроса в секунду)
if (process.env.BITRIX_WEBHOOK) {
  const base = process.env.BITRIX_WEBHOOK.replace(/\/?$/, '/')
  const jobs = await q(`select id, method, payload from portal.bitrix_outbox where status <> 'sent' and attempts < 8 order by created_at limit 50`)
  let sent = 0
  for (const j of jobs) {
    try {
      const res = await fetch(base + j.method + '.json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: j.payload.fields, params: { REGISTER_SONET_EVENT: 'Y' } }), signal: AbortSignal.timeout(15000) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error_description || data.error || 'HTTP ' + res.status)
      await q(`update portal.bitrix_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, result = $2, last_error = null where id = $1`, [j.id, JSON.stringify(data)])
      sent++
    } catch (e) {
      await q(`update portal.bitrix_outbox set status = 'error', attempts = attempts + 1, last_error = $2 where id = $1`, [j.id, String(e.message || e).slice(0, 300)])
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  out.bitrix_sent = sent
} else out.bitrix_pending = Number((await q(`select count(*)::int n from portal.bitrix_outbox where status <> 'sent'`))[0].n)

// 8. Курсы ЦБ Азербайджана (USD, EUR, ILS) — раз в сутки, для показа цены в валюте рынка (М7). Сбой сайта ЦБ не роняет tick.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(new Date()) // дата по Баку
if (!(await q(`select 1 from currency_rates where source = 'cbar' and valid_from = $1::date limit 1`, [today])).length) {
  try {
    const d = today.split('-').reverse().join('.')
    const res = await fetch(`https://www.cbar.az/currencies/${d}.xml`, { signal: AbortSignal.timeout(15000) })
    const xml = res.ok ? await res.text() : ''
    let n = 0
    for (const cur of ['USD', 'EUR', 'ILS']) {
      const m = xml.match(new RegExp(`<Valute Code="${cur}">[\\s\\S]*?<Nominal>([\\d.]+)[^<]*</Nominal>[\\s\\S]*?<Value>([\\d.]+)</Value>`))
      if (!m) continue
      await q(`insert into currency_rates (currency, azn_per_unit, source, override, valid_from, note) values ($1, $2, 'cbar', false, $3::date, $4)`, [cur, Number(m[2]) / Number(m[1]), today, 'cbar.az ' + d])
      n++
    }
    out.rates = n
  } catch (e) { out.rates_error = String(e.message || e) }
}

// 10. Profitbase (М1–М3, М11): прогон каждого источника, затем очередь записи; молчит больше часа — владельцу уведомление
const txPb = async (fn) => { await db.query('begin'); try { const r = await fn(db); await db.query('commit'); return r } catch (e) { await db.query('rollback'); throw e } }
const pbSources = await q(`select id, name, config from sources where kind = 'profitbase' and active`)
for (const src of pbSources) {
  const r = await pbSync(q, txPb, src, { notify })
  out['pb_' + src.id] = r.ok ? { checked: r.checked, changed: r.changed, created: r.created, gone: r.gone, floors: r.floors } : { error: r.error.slice(0, 120) }
  const okRecent = (await q(`select 1 from sync_runs where source_id = $1 and status in ('ok','partial') and started_at > now() - interval '1 hour'`, [src.id])).length
  if (!okRecent) for (const o of await q(`select id from portal.users where active and role = 'owner'`))
    await notify(o.id, 'access', 'Синхронизация с Profitbase «{s}» не проходит больше часа — проверьте «Источники»', '/sources', { s: src.name }, 'pb-stale:' + src.id + ':' + new Date().toISOString().slice(0, 13))
}
if (pbSources.length) out.pb_sent = await pbFlush(q, pbSources, { task })

// 11. 2.2 · Регистрации у застройщиков (§7) и закрепление (§10)
// 11а. Срок ответа вышел: по договору молчание = подтверждение — Confirmed by silence; иначе напоминание бэк-офису
const office = await q(`select id from portal.users where active and role in ('office','owner')`)
const bySilence = await q(`update portal.registrations r set status = 'confirmed_silence', decided_at = now(),
    valid_until = current_date + (d.protect_months || ' months')::interval
  from portal.developers d where d.id = r.developer_id and r.status = 'sent' and r.answer_due < current_date and d.silence_rule = 'confirm'
  returning r.id, r.client_id`)
for (const r of bySilence) await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1, null, 'system', 'Застройщик промолчал — регистрация подтверждена по договору', '{}')`, [r.client_id])
const quiet = await q(`select r.id, cl.name client, d.name dev from portal.registrations r join portal.clients cl on cl.id = r.client_id join portal.developers d on d.id = r.developer_id
  where r.status = 'sent' and r.answer_due < current_date and d.silence_rule = 'remind'`)
for (const r of quiet) for (const u of office) await notify(u.id, 'registration', 'Застройщик {d} молчит по регистрации {c} — напомните', '/registrations?f=silence', { d: r.dev, c: r.client }, `reg-quiet:${r.id}:${u.id}:${new Date().toISOString().slice(0, 10)}`)
// 11б. SLA передачи: не отправили к сроку — бэк-офису
const late = await q(`select count(*)::int n from portal.registrations where status = 'to_send' and due_send < current_date`)
if (late[0].n) for (const u of office) await notify(u.id, 'registration', 'Регистрации просрочены по SLA: {n}', '/registrations', { n: late[0].n }, `reg-late:${u.id}:${new Date().toISOString().slice(0, 10)}`)
// 11в. За N дней до окончания — «продлить»: клиент команды — бэк-офису, клиент партнёра — менеджеру по партнёрам (руководителю рынка)
const renew = await q(`update portal.registrations r set renew_task_at = current_date from portal.developers d, portal.clients cl
  where d.id = r.developer_id and cl.id = r.client_id and r.status in ('confirmed','confirmed_silence') and r.renew_task_at is null
    and r.valid_until <= current_date + d.renew_remind_days
  returning r.id, r.client_id, cl.owner_type, cl.market, cl.name client, d.name dev, r.valid_until::text until`)
for (const r of renew) {
  const to = r.owner_type === 'partner' ? await q(`select id from portal.users where active and role = 'market_head' and (market = $1 or $1 is null)`, [r.market]) : office
  for (const u of to) await notify(u.id, 'registration', 'Регистрация {c} у {d} истекает {u} — продлите', '/registrations?f=expiring', { c: r.client, d: r.dev, u: r.until }, `reg-renew:${r.id}:${u.id}`)
}
// 11г. Регистрация истекла
await q(`update portal.registrations set status = 'expired' where status in ('confirmed','confirmed_silence') and valid_until < current_date`)
// 11д. Кандидат партнёра не квалифицирован за 14 дней — защиты не было, карточка остаётся у партнёра без приоритета; уведомление партнёру
const cands = await q(`select id, owner_id, name from portal.clients where attach_status = 'candidate' and candidate_until < current_date`)
for (const c of cands) await notify(c.owner_id, 'client', 'Кандидат {c}: 14 дней на квалификацию прошли — приоритет снят', `/clients/${c.id}`, { c: c.name }, `cand-over:${c.id}`)
// 11е. Закрепление 6 месяцев: при брони или сделке — продлено; без них по истечении — клиента ведёт руководитель рынка, партнёр — Previous partner
await q(`update portal.clients cl set attach_status = 'extended' where attach_status = 'protected' and protected_until < current_date
  and (exists (select 1 from portal.bookings b where b.client_id = cl.id and b.status in ('hold','queued','requested','confirmed','release_pending'))
    or exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled'))`)
await q(`update portal.clients cl set attach_status = 'protected' where attach_status = 'extended'
  and not exists (select 1 from portal.bookings b where b.client_id = cl.id and b.status in ('hold','queued','requested','confirmed','release_pending'))
  and not exists (select 1 from portal.deals d where d.client_id = cl.id and d.stage <> 'cancelled')`)
const gone = await q(`update portal.clients cl set attach_status = 'transferred',
    previous_partner_id = case when cl.owner_type = 'partner' then cl.owner_id end,
    owner_id = coalesce((select id from portal.users h where h.active and h.role = 'market_head' and h.market = cl.market order by h.created_at limit 1), cl.owner_id)
  where attach_status = 'protected' and protected_until < current_date returning id, previous_partner_id, name`)
for (const g of gone) if (g.previous_partner_id) await notify(g.previous_partner_id, 'client', 'Закрепление {c} истекло: клиента ведёт офис; при покупке в течение 12 месяцев доля ваша', `/clients/${g.id}`, { c: g.name }, `transf:${g.id}`)
out.registrations = { silence: bySilence.length, quiet: quiet.length, renew: renew.length, transferred: gone.length }

// 9. Уведомления вне портала: e-mail и Telegram (scripts/notify-out.mjs)
try { await notifyOut(q, out) } catch (e) { out.notify_error = String(e.message || e).slice(0, 200) }

// Наблюдаемость: ошибки шагов (…_error, ошибки прогонов Profitbase) — владельцу, не чаще раза в час
const errs = Object.entries(out).filter(([k, v]) => k.endsWith('_error') || (v && typeof v === 'object' && v.error)).map(([k, v]) => `${k}: ${String(typeof v === 'object' ? v.error : v).slice(0, 120)}`)
if (errs.length) for (const o of await q(`select id from portal.users where active and role = 'owner'`))
  await notify(o.id, 'access', 'Фоновая обработка: ошибки — {e}', '/sources', { e: errs.join('; ').slice(0, 300) }, 'tick-err:' + new Date().toISOString().slice(0, 13) + ':' + o.id)
await db.end()
console.log(new Date().toISOString(), JSON.stringify(out))
