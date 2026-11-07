// 2.2 · §13 Обмен с Bitrix24 — общий модуль для приложения (server actions) и фонового обработчика (scripts/b24worker.mjs).
// Портал → Bitrix24: очередь portal.b24_jobs с повторами (≤ 2 запроса в секунду в обработчике); задача на клиента склеивается.
// Bitrix24 → портал: опрос изменений через вебхук по курсорам (DATE_MODIFY), журнал portal.b24_inbox — одно событие обрабатывается один раз.
// q(sql, params) → rows. Вебхук — только из B24_WEBHOOK на сервере, в логи и журнал не пишется.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const b24on = () => !!process.env.B24_WEBHOOK
const OURS = 'GetsEstate ·' // так начинаются наши записи в ленте — обратно в портал их не тянем

let gap = 0, last = 0
export const setGap = (ms) => { gap = ms }

export async function rest(method, params = {}) {
  const wait = gap - (Date.now() - last)
  if (wait > 0) await sleep(wait)
  last = Date.now()
  const r = await fetch(process.env.B24_WEBHOOK.replace(/\/+$/, '') + '/' + method + '.json', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), cache: 'no-store', signal: AbortSignal.timeout(20000),
  })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(`b24 ${method} ${j.error}: ${String(j.error_description || '').slice(0, 160)}`)
  if (!r.ok) throw new Error(`b24 ${method} HTTP ${r.status}`)
  return j
}
const res = async (m, p) => (await rest(m, p)).result
async function listAll(method, params, max = 1000) {
  const out = []
  for (let start = 0; ;) {
    const j = await rest(method, { ...params, start })
    const items = Array.isArray(j.result) ? j.result : j.result?.items || j.result?.tasks || []
    out.push(...items)
    if (j.next == null || out.length >= max) return out
    start = j.next
  }
}

// ── Справочники Bitrix24 (кеш 10 минут) ──
const cache = new Map()
async function cached(key, fn) {
  const c = cache.get(key)
  if (c && c.at > Date.now() - 600000) return c.v
  const v = await fn()
  cache.set(key, { v, at: Date.now() })
  return v
}
const categories = () => cached('cat', async () => ((await res('crm.category.list', { entityTypeId: 2 })).categories || []).map((c) => ({ id: Number(c.id), name: String(c.name) })))
export const stagesOf = (cat) => cached('st' + cat, async () =>
  (await res('crm.status.list', { filter: { ENTITY_ID: cat ? `DEAL_STAGE_${cat}` : 'DEAL_STAGE' }, order: { SORT: 'ASC' } })).map((s) => ({ id: s.STATUS_ID, name: s.NAME })))
const enumId = async (entity, field, value) => {
  if (!value) return ''
  const list = await cached(`uf:${entity}:${field}`, async () => ((await res(`crm.${entity}.userfield.list`, { filter: { FIELD_NAME: field } }))[0]?.LIST || []))
  return list.find((x) => x.VALUE === value)?.ID || ''
}
const mkt = (m) => (m === 'DE' ? 'DE' : m === 'IL' ? 'IL' : 'Global')
async function catFor(prefix, market) {
  const name = `${prefix} ${mkt(market)}`
  const c = (await categories()).find((x) => x.name === name)
  if (!c) throw new Error(`нет воронки «${name}»`)
  return c.id
}
async function catName(id) { return (await categories()).find((x) => x.id === Number(id))?.name || (Number(id) === 0 ? 'Sales DE' : '') }

// Стадии продаж по порядку: портал двигает стадию только вперёд (Reserved и SPA signed ставит только портал)
const ORDER = ['Selection', 'Developer registration', 'Reservation request', 'Reserved', 'KYC', 'SPA approval', 'SPA signed', 'Payments', 'Won']
const RES = { hold: 'Hold', queued: 'Queued', requested: 'Requested', confirmed: 'Reserved', release_pending: 'Reserved', declined: 'Declined', cancelled: 'Released', expired: 'Expired', converted: 'Reserved' }
const STAGE_OF = { requested: 'Reservation request', queued: 'Reservation request', confirmed: 'Reserved', release_pending: 'Reserved', converted: 'SPA signed' }
const KYC = { none: 'Not requested', pending: 'On review', passed: 'Passed', rejected: 'Rejected' }
const REG = { to_send: 'To send', sent: 'Sent', confirmed: 'Confirmed', confirmed_silence: 'Confirmed by silence', rejected: 'Rejected', expired: 'Expired' }

const splitName = (n) => { const p = String(n || '').trim().split(/\s+/); return { NAME: p[0] || '—', LAST_NAME: p.slice(1).join(' ') } }
const multi = (v) => (v ? [{ VALUE: v, VALUE_TYPE: 'WORK' }] : undefined)

async function staffFor(q, who, market) {
  if (who === 'office' || who === 'finance') {
    const r = await q(`select b24_user_id from portal.users where active and b24_user_id is not null and role = $1 and (market = $2 or market is null) order by (market = $2) desc nulls last, created_at limit 1`, [who, market])
    if (r[0]) return Number(r[0].b24_user_id)
  }
  return responsibleFor(q, market)
}
async function responsibleFor(q, market) {
  const r = await q(`select b24_user_id from portal.users where active and b24_user_id is not null and (role = 'market_head' and market = $1 or role = 'owner')
    order by (role = 'market_head') desc, created_at limit 1`, [market])
  return r[0]?.b24_user_id ? Number(r[0].b24_user_id) : undefined
}

// ── Портал → Bitrix24 ──

// Поставить синхронизацию клиента в очередь (склейка: одна ожидающая задача на клиента, строки для ленты копятся)
export async function enqueueSync(q, clientId, note) {
  if (!clientId || !b24on()) return null
  const r = await q(`insert into portal.b24_jobs (kind, ref_id, notes) values ('deal_sync', $1, $2)
    on conflict (kind, ref_id) where status in ('pending','error') and ref_id is not null and kind in ('deal_sync','app_sync')
    do update set notes = portal.b24_jobs.notes || excluded.notes, next_at = least(portal.b24_jobs.next_at, now()), updated_at = now() returning id`, [clientId, note ? [note] : []])
  return r[0]?.id || null
}
// Задача сотруднику в Bitrix24 по клиенту (к сделке, иначе к лиду): who — market_head | office | owner; привязка — в момент отправки
export async function enqueueTask(q, clientId, title, description, who = 'market_head') {
  if (!clientId || !b24on()) return null
  return (await q(`insert into portal.b24_jobs (kind, ref_id, params) values ('task', $1, $2) returning id`, [clientId, JSON.stringify({ title, description, who })]))[0]?.id || null
}
// Заявка партнёра → сделка в воронке заявок и её стадия (события 18, 20)
export async function enqueueApp(q, appId, note) {
  if (!appId || !b24on()) return null
  const r = await q(`insert into portal.b24_jobs (kind, ref_id, notes) values ('app_sync', $1, $2)
    on conflict (kind, ref_id) where status in ('pending','error') and ref_id is not null and kind in ('deal_sync','app_sync')
    do update set notes = portal.b24_jobs.notes || excluded.notes, next_at = least(portal.b24_jobs.next_at, now()), updated_at = now() returning id`, [appId, note ? [note] : []])
  return r[0]?.id || null
}
export async function enqueueCall(q, method, params) {
  if (!b24on()) return null
  return (await q(`insert into portal.b24_jobs (kind, method, params) values ('call', $1, $2) returning id`, [method, JSON.stringify(params)]))[0]?.id
}

// Выполнить одну задачу; ошибка — повтор через 30 с · 2^n (до 6 ч), после 10 попыток — dead (видно в админке, «переотправить»)
export async function processJob(q, id) {
  const j = (await q(`update portal.b24_jobs set status = 'running', attempts = attempts + 1, updated_at = now() where id = $1 and status in ('pending','error') returning *`, [id]))[0]
  if (!j) return null
  try {
    const result = j.kind === 'call' ? await res(j.method, j.params || {}) : j.kind === 'task' ? await syncTask(q, j.ref_id, j.params || {})
      : j.kind === 'app_sync' ? await syncApp(q, j.ref_id, j.notes || []) : j.kind === 'privacy' ? await syncPrivacy(j.params || {}) : await syncClient(q, j.ref_id, j.notes || [])
    await q(`update portal.b24_jobs set status = 'sent', sent_at = now(), updated_at = now(), last_error = null, result = $2 where id = $1`, [id, JSON.stringify(result ?? null)])
    return true
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300)
    await q(`update portal.b24_jobs set status = case when attempts >= 10 then 'dead' else 'error' end, last_error = $2, updated_at = now(),
      next_at = now() + make_interval(secs => least(21600, 30 * power(2, attempts - 1))) where id = $1`, [id, msg])
    return false
  }
}

export async function runQueue(q, deadline) {
  let ok = 0, fail = 0
  // зависшие «running» (обработчик упал посреди задачи) — вернуть в очередь
  await q(`update portal.b24_jobs set status = 'error', last_error = coalesce(last_error, 'прервано') where status = 'running' and updated_at < now() - interval '5 minutes'`)
  while (Date.now() < deadline) {
    const due = await q(`select id from portal.b24_jobs where status in ('pending','error') and next_at <= now() order by next_at limit 10`)
    if (!due.length) break
    for (const d of due) { if (Date.now() >= deadline) break; (await processJob(q, d.id)) ? ok++ : fail++ }
  }
  return { ok, fail }
}

// Состояние клиента → лид / контакт / сделка (события 4, 5, 7, 8, 11, 17, 23)
async function syncClient(q, clientId, notes) {
  const cl = (await q(`select c.*, c.protected_until::text pu, c.consent_at, c.marketing_consent_at, u.name owner_name, u.b24_user_id owner_b24, a.name agency_name, pp.name prev_partner, rf.name referrer_name
    from portal.clients c left join portal.users u on u.id = c.owner_id left join portal.agencies a on a.id = c.agency_id left join portal.users pp on pp.id = c.previous_partner_id
    left join portal.users rf on rf.id = c.referrer_id
    where c.id = $1`, [clientId]))[0]
  if (!cl) return { skipped: 'no client' }
  const done = {}
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  // клиент рекомендателя — клиент команды (§6 П9): лид New в воронку команды с полем Referrer, конвертирует сейлз
  const partner = cl.owner_type === 'partner', referral = cl.owner_type === 'referrer'
  const resp = (partner || referral ? await responsibleFor(q, cl.market) : cl.owner_b24 ? Number(cl.owner_b24) : await responsibleFor(q, cl.market))
  // Новые лиды, контакты и сделки — только для клиентов, заведённых после включения обмена (старые клиенты стенда в Bitrix24 не льём)
  const from = await kvGet(q, 'b24:create_from')
  const fresh = !from || new Date(cl.created_at) >= new Date(from)

  // 4. Кандидат партнёра — лид Candidate с полями партнёра
  if (fresh && (partner || referral) && !cl.b24_lead_id && !cl.b24_deal_id && cl.attach_status !== 'junk') {
    const id = await res('crm.lead.add', { fields: {
      TITLE: `${referral ? 'Referral' : 'Partner'} · ${cl.name}`, ...splitName(cl.name), PHONE: multi(cl.phone), EMAIL: multi(cl.email),
      STATUS_ID: referral ? 'NEW' : 'GE_CANDIDATE', SOURCE_ID: referral ? 'GE_REFERRER' : 'GE_PARTNER', ASSIGNED_BY_ID: resp, UF_CRM_GE_REFERRER: cl.referrer_name || '',
      UF_CRM_GE_MARKET: await enumId('lead', 'UF_CRM_GE_MARKET', mkt(cl.market)), UF_CRM_GE_COUNTRY: cl.country || '',
      UF_CRM_GE_PARTNER: referral ? '' : cl.agency_name || cl.owner_name || '', UF_CRM_GE_AGENCY: referral ? '' : cl.agency_name || '', UF_CRM_GE_AGENT: referral ? '' : cl.owner_name || '',
      UF_CRM_GE_CHECK: await enumId('lead', 'UF_CRM_GE_CHECK', referral ? 'Team' : 'Partner candidate'), UF_CRM_GE_DATA_CONSENT: cl.consent_at || '', UF_CRM_GE_MKT_CONSENT: cl.marketing_consent_at || '',
      COMMENTS: `${base}/clients/${cl.id}`,
    }, params: { REGISTER_SONET_EVENT: 'N' } })
    await q('update portal.clients set b24_lead_id = $2 where id = $1', [cl.id, id])
    await q(`insert into portal.b24_inbox (entity, b24_id, version, event, client_id, result) values ('lead', $1, 'ours', 4, $2, $3) on conflict do nothing`, [id, cl.id, referral ? 'лид рекомендации создан порталом' : 'лид Candidate создан порталом'])
    cl.b24_lead_id = id; done.lead = id
  }
  // Соперник проиграл (другой партнёр квалифицировал первым) — лид Duplicate
  if (partner && cl.b24_lead_id && !cl.b24_deal_id && cl.attach_status === 'junk') {
    await res('crm.lead.update', { id: cl.b24_lead_id, fields: { STATUS_ID: 'GE_DUPLICATE', UF_CRM_GE_CHECK: await enumId('lead', 'UF_CRM_GE_CHECK', 'Duplicate') } })
    done.lead_closed = true
  }
  // 5. Квалифицирован и закреплён (или клиент команды заведён в портале без Bitrix24) — контакт, сделка, лид Qualified, задача на регистрацию
  const attached = ['protected', 'extended', 'transferred'].includes(cl.attach_status)
  // клиент команды, заведённый из лида Bitrix24, конвертирует сейлз в Bitrix24 — сами сделку не создаём
  if (fresh && attached && !cl.b24_deal_id && (partner || (!referral && !cl.b24_lead_id))) {
    if (!cl.b24_contact_id) {
      cl.b24_contact_id = await res('crm.contact.add', { fields: { ...splitName(cl.name), PHONE: multi(cl.phone), EMAIL: multi(cl.email), ASSIGNED_BY_ID: resp, SOURCE_ID: partner ? 'GE_PARTNER' : 'GE_OFFICE' }, params: { REGISTER_SONET_EVENT: 'N' } })
      done.contact = cl.b24_contact_id
    }
    const cat = await catFor(partner ? 'Partner clients' : 'Sales', cl.market)
    const st = (await stagesOf(cat))[0]
    const dealId = await res('crm.deal.add', { fields: {
      TITLE: `${cl.name} · ${cl.reg_no}`, CATEGORY_ID: cat, STAGE_ID: st?.id, CONTACT_ID: cl.b24_contact_id, LEAD_ID: cl.b24_lead_id || undefined, ASSIGNED_BY_ID: resp,
      SOURCE_ID: partner ? 'GE_PARTNER' : 'GE_OFFICE', CURRENCY_ID: 'USD',
      UF_CRM_GE_DEAL_MARKET: await enumId('deal', 'UF_CRM_GE_DEAL_MARKET', mkt(cl.market)), UF_CRM_GE_AGENCY: cl.agency_name || '', UF_CRM_GE_AGENT: partner ? cl.owner_name || '' : '',
    }, params: { REGISTER_SONET_EVENT: 'N' } })
    await q('update portal.clients set b24_contact_id = $2, b24_deal_id = $3, b24_category = $4, b24_stage_id = $5, b24_stage = $6, b24_semantic = $7 where id = $1',
      [cl.id, cl.b24_contact_id, dealId, cat, st?.id || null, st?.name || null, 'P'])
    cl.b24_deal_id = dealId; done.deal = dealId
    if (cl.b24_lead_id) await res('crm.lead.update', { id: cl.b24_lead_id, fields: { STATUS_ID: 'CONVERTED', CONTACT_ID: cl.b24_contact_id, UF_CRM_GE_CHECK: await enumId('lead', 'UF_CRM_GE_CHECK', 'Partner') } })
    if (resp) await res('tasks.task.add', { fields: { TITLE: `Developer registrations · ${cl.name}`, RESPONSIBLE_ID: resp, UF_CRM_TASK: [`D_${dealId}`],
      DESCRIPTION: `Клиент закреплён (${cl.reg_no}). Отправить регистрацию застройщикам: ${base}/registrations`, DEADLINE: new Date(Date.now() + 86400000).toISOString() } })
  }
  // 23. Контакт: номер клиента, закрепление, согласия, Do not contact, сегмент
  if (cl.b24_contact_id) {
    await res('crm.contact.update', { id: cl.b24_contact_id, fields: {
      UF_CRM_GE_CLIENT_ID: cl.reg_no, UF_CRM_GE_OWNER_TYPE: await enumId('contact', 'UF_CRM_GE_OWNER_TYPE', cl.owner_type), UF_CRM_GE_PROTECTED: cl.pu || '',
      UF_CRM_GE_PREV_PARTNER: cl.prev_partner || '', UF_CRM_GE_DNC: cl.do_not_contact ? 1 : 0, UF_CRM_GE_SEGMENT: await enumId('contact', 'UF_CRM_GE_SEGMENT', cl.segment),
      UF_CRM_GE_DATA_CONSENT: cl.consent_at || '', UF_CRM_GE_MKT_CONSENT: cl.marketing_consent_at || '', UF_CRM_GE_CITIZEN: cl.kyc_citizenship || '', UF_CRM_GE_TAXRES: cl.kyc_tax_residence || '',
      UF_CRM_GE_KYC: await enumId('contact', 'UF_CRM_GE_KYC', KYC[cl.kyc_status] || 'Not requested'), // §13 п.10
    }, params: { REGISTER_SONET_EVENT: 'N' } })
  }
  // 7, 8, 11. Сделка: квартиры, бронь, регистрации у застройщиков, стадия только вперёд
  if (cl.b24_deal_id) done.deal_update = await updateDeal(q, cl, base)
  // 13. Оплата внесена (есть SPA signed): по каждой купленной квартире — Aftercare, при рассрочке ещё Installments; стадии Installments — по оплате
  if (cl.b24_contact_id) done.after = await afterSale(q, cl, base)
  // 17. Записи в ленту: сделка, если есть, иначе лид
  const target = cl.b24_deal_id ? ['deal', cl.b24_deal_id] : cl.b24_lead_id ? ['lead', cl.b24_lead_id] : null
  if (target) for (const n of notes) await res('crm.timeline.comment.add', { fields: { ENTITY_ID: target[1], ENTITY_TYPE: target[0], COMMENT: `${OURS} ${n}` } })
  return done
}

async function updateDeal(q, cl, base) {
  const units = await q(`select portal.unit_no(bl.external_id, u.number) no, b.status, b.ends_at::date::text ends_at, b.price_list::float list, b.final_price::float final, b.discount_pct::float disc, b.dev_booking_no dev_no, p.name project
    from portal.bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id join public.projects p on p.id = bl.project_id
    where b.client_id = $1 and b.status in ('hold','queued','requested','confirmed','release_pending','converted') order by b.created_at`, [cl.id])
  const liked = await q(`select distinct portal.unit_no(bl.external_id, u.number) no from portal.selection_items si join portal.selections s on s.id = si.selection_id
    join units u on u.id = si.unit_id join buildings bl on bl.id = u.building_id where s.client_id = $1`, [cl.id])
  const regs = await q(`select coalesce(p.name, d.name) what, r.status, r.valid_until::text until from portal.registrations r join portal.developers d on d.id = r.developer_id
    left join public.projects p on p.id = r.project_id where r.client_id = $1 order by d.name, p.name`, [cl.id])
  const rank = (s) => ORDER.indexOf(STAGE_OF[s] || 'Selection')
  const main = [...units].sort((a, z) => rank(z.status) - rank(a.status))[0]
  const paid = (await q(`select count(*)::int n from portal.deals where client_id = $1 and stage <> 'cancelled' and paid_pct > 0`, [cl.id]))[0].n
  const deal = await res('crm.deal.get', { id: cl.b24_deal_id })
  const cat = Number(deal.CATEGORY_ID)
  const stages = await stagesOf(cat)
  const curName = stages.find((s) => s.id === deal.STAGE_ID)?.name || 'Selection'
  let want = main ? STAGE_OF[main.status] || 'Selection' : 'Selection'
  if (ORDER.indexOf(want) < 1 && regs.some((r) => ['sent', 'confirmed', 'confirmed_silence'].includes(r.status))) want = 'Developer registration'
  // KYC — после Reserved: документы отправлены на проверку или проверка пройдена (§5 П4)
  if (ORDER.indexOf(want) === ORDER.indexOf('Reserved') && ['pending', 'passed'].includes(cl.kyc_status)) want = 'KYC'
  // Won — есть SPA signed и внесена оплата (полная или первый взнос, §9 п.1)
  if (paid && ORDER.indexOf(want) >= ORDER.indexOf('SPA signed')) want = 'Won'
  const fields = {
    UF_CRM_GE_UNITS: Array.from(new Set([...units.map((u) => u.no), ...liked.map((u) => u.no)])).join(', '),
    UF_CRM_GE_MAIN_UNIT: main?.no || '', UF_CRM_GE_PROJECT: main?.project || '',
    UF_CRM_GE_LIST_PRICE: main?.list ?? '', UF_CRM_GE_FINAL_PRICE: main?.final ?? '', UF_CRM_GE_DISCOUNT: main?.disc ?? '',
    UF_CRM_GE_RES_UNTIL: main?.ends_at || '', UF_CRM_GE_DEV_RES_NO: main?.dev_no || '',
    UF_CRM_GE_RES_STATUS: main ? await enumId('deal', 'UF_CRM_GE_RES_STATUS', RES[main.status]) : '',
    UF_CRM_GE_DEV_REGS: regs.map((r) => `${r.what}: ${REG[r.status] || r.status}${r.until && r.status.startsWith('confirmed') ? ' до ' + r.until : ''}`).join('; ').slice(0, 2000),
    UF_CRM_GE_PORTAL_LINK: `${base}/b24/units/${cl.id}`,
    UF_CRM_GE_DEAL_ID: cl.reg_no,
    UF_CRM_GE_REFERRER: cl.referrer_name || '',
    // §6 П10: открытый спор «чей клиент» — флаг Ownership dispute (выплата спорной доли заморожена до решения)
    UF_CRM_GE_DISPUTE: (await q(`select 1 from portal.disputes where client_id = $1 and status = 'open' limit 1`, [cl.id])).length ? 1 : 0,
  }
  // сумма сделки — по самой продвинутой квартире (решение 253)
  if (main) { fields.OPPORTUNITY = main.final ?? 0; fields.CURRENCY_ID = 'USD' }
  // Стадию не трогаем, если сделка закрыта (Won / Lost) или стоит дальше
  if (deal.STAGE_SEMANTIC_ID === 'P' && ORDER.indexOf(want) > ORDER.indexOf(curName)) {
    const st = stages.find((s) => s.name === want)
    if (st) fields.STAGE_ID = st.id
  }
  await res('crm.deal.update', { id: cl.b24_deal_id, fields, params: { REGISTER_SONET_EVENT: 'N' } })
  return { stage: fields.STAGE_ID || null }
}

const catId = async (name) => { const c = (await categories()).find((x) => x.name === name); if (!c) throw new Error(`нет воронки «${name}»`); return c.id }
const stageId = async (cat, name) => (await stagesOf(cat)).find((s) => s.name === name)?.id || (await stagesOf(cat))[0]?.id

async function afterSale(q, cl, base) {
  const list = await q(`select d.id, d.paid_pct::float paid, d.final_price::float price, d.b24_inst_id, d.b24_after_id, portal.unit_no(bl.external_id, u.number) no, p.name project
    from portal.deals d join units u on u.id = d.unit_id join buildings bl on bl.id = u.building_id join public.projects p on p.id = d.project_id
    where d.client_id = $1 and d.stage <> 'cancelled' and d.paid_pct > 0`, [cl.id])
  if (!list.length) return null
  const office = await staffFor(q, 'office', cl.market)
  const out = []
  for (const d of list) {
    const common = { CONTACT_ID: cl.b24_contact_id, ASSIGNED_BY_ID: office, CURRENCY_ID: 'USD', OPPORTUNITY: d.price, UF_CRM_GE_MAIN_UNIT: d.no, UF_CRM_GE_PROJECT: d.project,
      UF_CRM_GE_FINAL_PRICE: d.price, UF_CRM_GE_PAID_PCT: d.paid, UF_CRM_GE_PORTAL_LINK: `${base}/b24/units/${cl.id}`, UF_CRM_GE_DEAL_ID: cl.reg_no }
    if (!d.b24_after_id) {
      const cat = await catId('Aftercare')
      const id = await res('crm.deal.add', { fields: { ...common, TITLE: `${d.no} · ${cl.name}`, CATEGORY_ID: cat, STAGE_ID: (await stagesOf(cat))[0]?.id }, params: { REGISTER_SONET_EVENT: 'N' } })
      await q('update portal.deals set b24_after_id = $2 where id = $1', [d.id, id]); out.push('aftercare ' + id)
    }
    if (d.paid < 100 && !d.b24_inst_id) {
      const cat = await catId('Installments')
      const id = await res('crm.deal.add', { fields: { ...common, TITLE: `${d.no} · ${cl.name} · installments`, CATEGORY_ID: cat, STAGE_ID: await stageId(cat, 'Paying') }, params: { REGISTER_SONET_EVENT: 'N' } })
      await q('update portal.deals set b24_inst_id = $2 where id = $1', [d.id, id]); out.push('installments ' + id)
    } else if (d.b24_inst_id) {
      // стадии Installments двигает портал: полная оплата — Paid in full (Overdue — по сверке, позже)
      const cur = await res('crm.deal.get', { id: d.b24_inst_id })
      const f = { UF_CRM_GE_PAID_PCT: d.paid }
      if (d.paid >= 100 && cur.STAGE_SEMANTIC_ID === 'P') f.STAGE_ID = await stageId(Number(cur.CATEGORY_ID), 'Paid in full')
      await res('crm.deal.update', { id: d.b24_inst_id, fields: f, params: { REGISTER_SONET_EVENT: 'N' } })
    }
  }
  return out
}

// Задача сотруднику Bitrix24 (события 9, 12, 16): к сделке клиента, иначе к лиду
async function syncTask(q, clientId, p) {
  const cl = (await q('select id, name, market, b24_deal_id, b24_lead_id, b24_contact_id from portal.clients where id = $1', [clientId]))[0]
  if (!cl) return { skipped: 'no client' }
  const who = await staffFor(q, p.who || 'market_head', cl.market)
  if (!who) return { skipped: 'нет сотрудника Bitrix24' }
  const bind = cl.b24_deal_id ? [`D_${cl.b24_deal_id}`] : cl.b24_lead_id ? [`L_${cl.b24_lead_id}`] : cl.b24_contact_id ? [`C_${cl.b24_contact_id}`] : []
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const r = await res('tasks.task.add', { fields: { TITLE: String(p.title).slice(0, 250), RESPONSIBLE_ID: who, UF_CRM_TASK: bind,
    DESCRIPTION: `${p.description || ''}\n${base}/b24/units/${cl.id}`.trim(), DEADLINE: new Date(Date.now() + 86400000).toISOString() } })
  return { task: r?.task?.id || r }
}

// 24. Удаление по запросу человека: лид без сделки и контакт без сделок — удалить; при сделке (договор хранится по закону) — обезличить контакт и названия сделок
export async function enqueuePrivacy(q, params) {
  if (!b24on()) return null
  return (await q(`insert into portal.b24_jobs (kind, params) values ('privacy', $1) returning id`, [JSON.stringify(params)]))[0]?.id || null
}
async function syncPrivacy(p) {
  const done = {}
  if (p.lead && !p.hasDeal) { await res('crm.lead.delete', { id: p.lead }).catch((e) => { if (!/not found/i.test(String(e.message))) throw e }); done.lead = 'deleted' }
  if (p.contact) {
    if (!p.hasDeal) { await res('crm.contact.delete', { id: p.contact }).catch((e) => { if (!/not found/i.test(String(e.message))) throw e }); done.contact = 'deleted' }
    else {
      const c = await res('crm.contact.get', { id: p.contact })
      const wipe = (arr) => (arr || []).map((x) => ({ ID: x.ID, VALUE: '' }))
      await res('crm.contact.update', { id: p.contact, fields: { NAME: 'Deleted', LAST_NAME: p.reg || '', SECOND_NAME: '', PHONE: wipe(c.PHONE), EMAIL: wipe(c.EMAIL), IM: wipe(c.IM), BIRTHDATE: '', ADDRESS: '', COMMENTS: '' } })
      done.contact = 'anonymized'
    }
  }
  for (const d of p.deals || []) { await res('crm.deal.update', { id: d, fields: { TITLE: `Deleted · ${p.reg || ''}` } }); done.deals = (done.deals || 0) + 1 }
  const target = p.deals?.[0] ? ['deal', p.deals[0]] : null
  if (target) await res('crm.timeline.comment.add', { fields: { ENTITY_ID: target[1], ENTITY_TYPE: target[0], COMMENT: `${OURS} данные клиента удалены по его запросу; договор и KYC хранятся по закону` } })
  return done
}

// Заявки партнёров (П7): воронка по типу и рынку, наше юрлицо по рынку, ссылка на документы; стадии портала → Bitrix24 только вперёд
const APP_ORDER = ['New application', 'Contacted', 'Documents', 'Agreement sent', 'Agreement signed', 'Access granted', 'First client', 'Active']
const APP_STAGE = { new: 'New application', review: 'Contacted', contract: 'Agreement sent', approved: 'Access granted' }
const ENTITY = { DE: 'GetsEstate GmbH (DE)', IL: 'GetsEstate IL Ltd (IL)' }
async function syncApp(q, appId, notes) {
  const a = (await q(`select a.*, u.partner_status, (select count(*) from portal.clients c where c.owner_id = a.user_id or (u.agency_id is not null and c.agency_id = u.agency_id))::int clients,
      (select count(*) from portal.deals d join portal.clients c on c.id = d.client_id where d.stage <> 'cancelled' and (c.owner_id = a.user_id or (u.agency_id is not null and c.agency_id = u.agency_id)))::int deals
    from portal.agent_applications a left join portal.users u on u.id = a.user_id where a.id = $1`, [appId]))[0]
  if (!a) return { skipped: 'no application' }
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const done = {}
  const resp = await responsibleFor(q, a.market)
  const cat = await catId(`${a.kind === 'agency' ? 'Agencies' : 'Sub-agents'} ${mkt(a.market)}`)
  if (!a.b24_deal_id) {
    if (!a.b24_contact_id) {
      a.b24_contact_id = await res('crm.contact.add', { fields: { ...splitName(a.name), PHONE: multi(a.phone), EMAIL: multi(a.email), COMPANY_TITLE: a.company || undefined, ASSIGNED_BY_ID: resp, SOURCE_ID: 'GE_PARTNER' }, params: { REGISTER_SONET_EVENT: 'N' } })
    }
    const info = [a.company && `Company: ${a.company}`, a.city && `City: ${a.city}`, a.languages && `Languages: ${a.languages}`, a.license && `License: ${a.license}`, a.volume && `Volume: ${a.volume}`, a.channels && `Channels: ${a.channels}`].filter(Boolean).join('\n')
    const id = await res('crm.deal.add', { fields: {
      TITLE: `${a.kind === 'agency' ? 'Agency' : a.kind === 'referrer' ? 'Referrer' : 'Sub-agent'} · ${a.company || a.name}`, CATEGORY_ID: cat, STAGE_ID: await stageId(cat, 'New application'), CONTACT_ID: a.b24_contact_id, ASSIGNED_BY_ID: resp, SOURCE_ID: 'GE_PARTNER',
      UF_CRM_GE_PARTNER_TYPE: await enumId('deal', 'UF_CRM_GE_PARTNER_TYPE', a.kind === 'agency' ? 'Agency' : a.kind === 'referrer' ? 'Referrer' : 'Sub-agent'),
      UF_CRM_GE_PARTNER_FORM: await enumId('deal', 'UF_CRM_GE_PARTNER_FORM', a.kind === 'agency' ? 'Company' : 'Individual'),
      UF_CRM_GE_OUR_ENTITY: await enumId('deal', 'UF_CRM_GE_OUR_ENTITY', ENTITY[a.market] || 'Caspian (AZ)'),
      UF_CRM_GE_DOCS: `${base}/admin/agents/app/${a.id}`, COMMENTS: info,
    }, params: { REGISTER_SONET_EVENT: 'N' } })
    await q('update portal.agent_applications set b24_contact_id = $2, b24_deal_id = $3, b24_stage = $4 where id = $1', [a.id, a.b24_contact_id, id, 'New application'])
    a.b24_deal_id = id; done.deal = id
  }
  // стадия: из статуса портала, First client — первый клиент, Active — первая сделка (событие 20)
  let want = a.status === 'rejected' ? 'Rejected' : APP_STAGE[a.status] || 'New application'
  if (a.user_id && a.clients > 0) want = 'First client'
  if (a.user_id && a.deals > 0) want = 'Active'
  // Inactive / Blocked — особые стадии: ставятся и снимаются в обе стороны, мимо порядка воронки
  const special = a.partner_status === 'inactive' ? 'Inactive' : a.partner_status === 'blocked' ? 'Blocked' : null
  const deal = await res('crm.deal.get', { id: a.b24_deal_id })
  const stages = await stagesOf(Number(deal.CATEGORY_ID))
  const cur = stages.find((x) => x.id === deal.STAGE_ID)?.name || ''
  const f = { UF_CRM_GE_PARTNER_ID: a.user_id || '' }
  if (special && cur !== special) want = special
  if (!special && ['Inactive', 'Blocked'].includes(cur) && a.partner_status === 'active') want = a.deals > 0 ? 'Active' : a.clients > 0 ? 'First client' : 'Access granted'
  const back = !special && ['Inactive', 'Blocked'].includes(cur) && a.partner_status === 'active'
  if (want === 'Rejected' ? deal.STAGE_SEMANTIC_ID === 'P' : (special ? cur !== special : back || APP_ORDER.indexOf(want) > APP_ORDER.indexOf(cur)) && deal.STAGE_SEMANTIC_ID !== 'F') {
    const st = stages.find((x) => x.name === want)
    if (st) { f.STAGE_ID = st.id; done.stage = want }
  }
  await res('crm.deal.update', { id: a.b24_deal_id, fields: f, params: { REGISTER_SONET_EVENT: 'N' } })
  if (done.stage) await q('update portal.agent_applications set b24_stage = $2 where id = $1', [a.id, done.stage])
  for (const n of notes) await res('crm.timeline.comment.add', { fields: { ENTITY_ID: a.b24_deal_id, ENTITY_TYPE: 'deal', COMMENT: `${OURS} ${n}` } })
  return done
}

// ── Bitrix24 → портал ──

const kvGet = async (q, k) => (await q('select value from portal.kv where key = $1', [k]))[0]?.value || null
const kvSet = (q, k, v) => q(`insert into portal.kv (key, value) values ($1, $2) on conflict (key) do update set value = $2, updated_at = now()`, [k, v])
const since = (iso) => iso || new Date(Date.now() - 2 * 86400000).toISOString()
const keys = (o) => {
  const phone = (o.PHONE || []).map((p) => p.VALUE).find(Boolean) || '', email = (o.EMAIL || []).map((e) => e.VALUE).find(Boolean) || ''
  return { phone, email, pn: phone.replace(/\D/g, '').replace(/^00/, ''), em: email.trim().toLowerCase() }
}
const matchSql = `((length($1) >= 9 and length(phone_norm) >= 9 and right(phone_norm, 9) = right($1, 9)) or ($2 <> '' and email_norm = $2)) and attach_status <> 'junk'`
async function inbox(q, entity, id, version) {
  return (await q(`insert into portal.b24_inbox (entity, b24_id, version, result) values ($1,$2,$3,'…') on conflict do nothing returning id`, [entity, id, version]))[0]?.id || null
}
const mark = (q, rowId, event, clientId, result, data) => q('update portal.b24_inbox set event = $2, client_id = $3, result = $4, data = $5 where id = $1', [rowId, event, clientId, result, data ? JSON.stringify(data) : null])
const note = (q, clientId, text, vars, internal = false, userId = null) =>
  q(`insert into portal.activities (client_id, user_id, kind, text, vars, internal) values ($1,$2,'system',$3,$4,$5)`, [clientId, userId, text, JSON.stringify(vars || {}), internal])
const notifyMany = async (q, ids, kind, text, link, vars) => { for (const u of new Set(ids.filter(Boolean))) await q(`insert into portal.notifications (user_id, kind, text, link, vars) values ($1,$2,$3,$4,$5)`, [u, kind, text, link, JSON.stringify(vars || {})]) }
const heads = async (q, market) => (await q(`select id from portal.users where active and (role = 'market_head' and (market = $1 or $1 is null) or role = 'owner')`, [market])).map((r) => r.id)
const portalUser = async (q, b24id) => (b24id ? (await q('select id from portal.users where b24_user_id = $1 and active', [b24id]))[0]?.id || null : null)

const DEAL_SELECT = ['ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'ASSIGNED_BY_ID', 'CONTACT_ID', 'LEAD_ID', 'DATE_MODIFY', 'UF_CRM_GE_CLAWBACK']

export async function pull(q, out = {}) {
  if (!b24on()) return out
  const step = async (name, fn) => { try { out[name] = await fn() } catch (e) { out[name + '_error'] = String(e.message || e).slice(0, 200) } }
  await step('b24_deals', () => pullDeals(q))
  await step('b24_leads', () => pullLeads(q))
  await step('b24_contacts', () => pullContacts(q))
  const min = new Date().getUTCMinutes()
  if (min % 5 === 0) await step('b24_comments', () => pullComments(q))
  if (min < 2 || !(await kvGet(q, 'b24:users_at'))) {
    await step('b24_users', () => pullUsers(q))
    await step('b24_reconcile', () => reconcile(q))
  }
  return out
}

async function pullDeals(q) {
  const cur = await kvGet(q, 'b24:cur:deal')
  const items = await listAll('crm.deal.list', { filter: { '>=DATE_MODIFY': since(cur) }, order: { DATE_MODIFY: 'ASC' }, select: DEAL_SELECT }, 500)
  let n = 0
  for (const d of items) { if (await handleDeal(q, d)) n++ }
  if (items.length) await kvSet(q, 'b24:cur:deal', items[items.length - 1].DATE_MODIFY)
  return n
}

// Сделка изменилась: зеркало стадии и ответственного, новая сделка команды — клиент в портале, расторжение — клаубэк
async function handleDeal(q, d) {
  const row = await inbox(q, 'deal', d.ID, d.DATE_MODIFY)
  if (!row) return false
  const cname = await catName(d.CATEGORY_ID)
  const stName = (await stagesOf(Number(d.CATEGORY_ID))).find((s) => s.id === d.STAGE_ID)?.name || d.STAGE_ID
  const contact = Number(d.CONTACT_ID) || null
  let cl = (await q('select * from portal.clients where b24_deal_id = $1', [d.ID]))[0]
  // 19. Заявка партнёра: стадия → статус заявителя; Access granted — кабинет и приглашение; Inactive / Blocked — кабинет закрыт
  if (!cl && (cname.startsWith('Agencies ') || cname.startsWith('Sub-agents '))) {
    const r = await handleApp(q, d, stName)
    await mark(q, row, 19, null, r)
    // кабинет не открылся — снять отметку, чтобы сверка раз в час повторила
    if (r.startsWith('кабинет не открыт')) { await q('delete from portal.b24_inbox where id = $1', [row]); await q('update portal.agent_applications set b24_stage = null where b24_deal_id = $1', [d.ID]) }
    return true
  }

  // 14. Расторжение: Installments → Terminated или флаг Clawback
  const clawback = d.UF_CRM_GE_CLAWBACK === '1' || d.UF_CRM_GE_CLAWBACK === 1 || d.UF_CRM_GE_CLAWBACK === true
  if ((cname === 'Installments' && stName === 'Terminated') || clawback) {
    const t = cl || (contact ? (await q('select * from portal.clients where b24_contact_id = $1 order by created_at limit 1', [contact]))[0] : null)
    if (t && !t.clawback) {
      await q('update portal.clients set terminated_at = coalesce(terminated_at, now()), clawback = true where id = $1', [t.id])
      await note(q, t.id, 'Расторжение в Bitrix24 (сделка {d}): клаубэк, клиент исключён из отчётов', { d: d.ID })
      const fin = (await q(`select id from portal.users where active and role in ('finance','owner')`)).map((r) => r.id)
      await notifyMany(q, [...fin, t.owner_id], 'deal', 'Расторжение: {c} — клаубэк по комиссии', `/clients/${t.id}`, { c: t.name })
      await q(`insert into portal.audit (action, entity, entity_id, data) values ('b24.terminated', 'client', $1, $2)`, [t.id, JSON.stringify({ deal: d.ID })])
      // клаубэк по правилам застройщика — логикой приложения (транши отменяются, выплаченное партнёру и сейлзу — минусом)
      await internal('clawback', { client: t.id }).catch(() => null)
      await mark(q, row, 14, t.id, 'расторжение → клаубэк')
      return true
    }
  }

  // 6. Сделка команды в Sales без клиента в портале — зеркало (сначала проверка «чей клиент»)
  if (!cl && cname.startsWith('Sales ') && d.STAGE_SEMANTIC_ID === 'P' && contact) {
    // лид портала (рекомендация, клиент команды из портала) сконвертирован сейлзом — связать по лиду
    cl = Number(d.LEAD_ID) ? (await q('select * from portal.clients where b24_lead_id = $1 and b24_deal_id is null limit 1', [Number(d.LEAD_ID)]))[0] : null
    if (cl) await q('update portal.clients set b24_deal_id = $2, b24_contact_id = coalesce(b24_contact_id, $3) where id = $1', [cl.id, d.ID, contact])
    if (!cl) cl = (await q('select * from portal.clients where b24_contact_id = $1 and b24_deal_id is null order by created_at limit 1', [contact]))[0]
    if (cl && !cl.b24_deal_id) await q('update portal.clients set b24_deal_id = $2 where id = $1', [cl.id, d.ID])
    else if (!cl) {
      const c = await res('crm.contact.get', { id: contact })
      const k = keys(c)
      if (!k.pn && !k.em) { await mark(q, row, 6, null, 'нет телефона и почты — клиент не заведён'); return true }
      const hit = (await q(`select * from portal.clients where ${matchSql} order by (attach_status = 'candidate'), created_at limit 1`, [k.pn, k.em]))[0]
      if (hit && hit.owner_type === 'partner' && ['candidate', 'protected', 'extended'].includes(hit.attach_status)) {
        await res('crm.deal.update', { id: d.ID, fields: { UF_CRM_GE_DISPUTE: 1 } })
        await res('crm.timeline.comment.add', { fields: { ENTITY_ID: d.ID, ENTITY_TYPE: 'deal', COMMENT: `${OURS} клиент закреплён за партнёром (${hit.reg_no}) — спор «чей клиент», решает руководитель рынка` } })
        await notifyMany(q, await heads(q, hit.market), 'dispute', 'Сделка команды по клиенту партнёра: {c} — разберите спор', `/clients/${hit.id}`, { c: hit.name })
        await mark(q, row, 6, hit.id, 'клиент партнёра — спор')
        return true
      }
      if (hit && !hit.b24_deal_id) {
        await q('update portal.clients set b24_deal_id = $2, b24_contact_id = coalesce(b24_contact_id, $3) where id = $1', [hit.id, d.ID, contact])
        cl = hit
      } else if (hit) { await mark(q, row, 6, hit.id, `клиент уже связан со сделкой ${hit.b24_deal_id}`); return true }
      else {
        const owner = (await portalUser(q, d.ASSIGNED_BY_ID)) || (await q(`select id from portal.users where active and role = 'owner' order by created_at limit 1`))[0]?.id
        const n = (await q(`select nextval('portal.client_reg_seq')::int n`))[0].n
        const reg = `R-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`
        const market = cname.endsWith(' DE') ? 'DE' : cname.endsWith(' IL') ? 'IL' : 'GLOBAL'
        const name = [c.NAME, c.LAST_NAME].filter(Boolean).join(' ').trim() || d.TITLE
        cl = (await q(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, market, source, stage, owner_type, attach_status, protected_until, attached_at, b24_contact_id, b24_deal_id, b24_lead_id,
            consent_status, consent_token, consent_requested_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,'bitrix24','lead','team','protected', current_date + interval '6 months', now(), $9, $10, $11,
            'pending', replace(replace(encode(gen_random_bytes(12), 'base64'), '/', '_'), '+', '-'), now()) returning *`,
          [reg, owner, name, k.phone, k.pn, k.email, k.em, market, contact, d.ID, Number(d.LEAD_ID) || null]))[0]
        await note(q, cl.id, 'Клиент заведён по сделке Bitrix24 ({r}), закреплён за командой', { r: reg })
        await q('select portal.enqueue_registrations($1, null, false, null)', [cl.id])
        await enqueueSync(q, cl.id, `клиент заведён в портале (${reg}), регистрации у застройщиков — в очереди`)
      }
    }
  }
  if (!cl) { await mark(q, row, null, null, `не связана с клиентом (${cname || d.CATEGORY_ID} · ${stName})`); return true }

  // Зеркало стадии; 15. партнёр видит новую стадию и получает уведомление; 22. ответственный
  const changed = cl.b24_stage_id !== d.STAGE_ID
  await q(`update portal.clients set b24_category = $2, b24_stage_id = $3, b24_stage = $4, b24_semantic = $5, b24_assigned_id = $6, b24_synced_at = now() where id = $1`,
    [cl.id, Number(d.CATEGORY_ID), d.STAGE_ID, stName, d.STAGE_SEMANTIC_ID, Number(d.ASSIGNED_BY_ID) || null])
  const res15 = []
  if (changed && cl.b24_stage_id) {
    await note(q, cl.id, 'Стадия сделки в Bitrix24: {s}', { s: stName })
    if (cl.owner_type === 'partner') { await notifyMany(q, [cl.owner_id], 'deal', 'Стадия сделки клиента {c}: {s}', `/clients/${cl.id}`, { c: cl.name, s: stName }); res15.push('партнёру — уведомление') }
    res15.push(`стадия → ${stName}`)
  }
  if (cl.owner_type !== 'partner' && Number(d.ASSIGNED_BY_ID) && Number(d.ASSIGNED_BY_ID) !== Number(cl.b24_assigned_id)) {
    const u = await portalUser(q, d.ASSIGNED_BY_ID)
    if (u && u !== cl.owner_id) { await q('update portal.clients set owner_id = $2 where id = $1', [cl.id, u]); await note(q, cl.id, 'Ответственный сменён в Bitrix24', {}); res15.push('ответственный сменён') }
  }
  await mark(q, row, changed ? (cl.owner_type === 'partner' ? 15 : 6) : res15.length ? 22 : null, cl.id, res15.join(', ') || 'без изменений для портала')
  return true
}

const APP_FROM = { 'New application': 'new', Contacted: 'review', Documents: 'review', 'Agreement sent': 'contract', 'Agreement signed': 'contract', Rejected: 'rejected' }
async function handleApp(q, d, stName) {
  const a = (await q('select * from portal.agent_applications where b24_deal_id = $1', [d.ID]))[0]
  if (!a) return `заявка не из портала (${stName})`
  if (a.b24_stage === stName) return 'без изменений'
  await q('update portal.agent_applications set b24_stage = $2 where id = $1', [a.id, stName])
  if (['Access granted', 'First client', 'Active'].includes(stName)) {
    if (a.user_id) {
      const u = (await q(`update portal.users set active = true, partner_status = 'active', partner_status_at = now() where id = $1 and (not active or partner_status <> 'active') returning id`, [a.user_id]))[0]
      return u ? 'кабинет снова активен' : `стадия ${stName}`
    }
    // кабинет открывает приложение — той же логикой, что кнопка «Открыть доступ» (приглашение письмом)
    const r = await internal('grant', { app: a.id })
    return r.ok ? `кабинет открыт, приглашение — ${r.mailed ? 'письмом' : 'в очереди писем'}` : `кабинет не открыт: ${r.error || 'ошибка'}`
  }
  // Inactive — доступ остаётся, закреплённые клиенты и доля сохраняются; Blocked — доступ закрыт (§6 П10)
  if (stName === 'Inactive') {
    if (a.user_id) await q(`update portal.users set partner_status = 'inactive', partner_status_at = now() where id = $1 and partner_status <> 'inactive'`, [a.user_id])
    return 'партнёр Inactive (доступ остаётся)'
  }
  if (stName === 'Blocked') {
    if (a.user_id) {
      await q(`update portal.users set partner_status = 'blocked', partner_status_at = now(), active = false, session_ver = session_ver + 1 where id = $1`, [a.user_id])
      await notifyMany(q, await heads(q, a.market), 'access', 'Партнёр {p} заблокирован: доступ закрыт, сделки в работе доводит офис', `/admin/agents/app/${a.id}`, { p: a.company || a.name })
    }
    return 'кабинет закрыт (Blocked)'
  }
  const st = APP_FROM[stName]
  if (st && st !== a.status && !a.user_id) await q('update portal.agent_applications set status = $2 where id = $1', [a.id, st])
  return `статус заявки: ${st || stName}`
}
// Вызов приложения портала изнутри сервера (подпись от SESSION_SECRET; адрес — 127.0.0.1)
async function internal(action, body) {
  const { createHmac } = await import('node:crypto')
  const sig = createHmac('sha256', process.env.SESSION_SECRET || '').update('b24-internal:' + action).digest('hex')
  const r = await fetch(`${process.env.INTERNAL_URL || 'http://127.0.0.1:3042'}/api/internal/b24`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal': sig }, body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(20000) })
  return r.json().catch(() => ({ error: 'HTTP ' + r.status }))
}

// 2. Лид создан в Bitrix24 (звонок, чат, почта): проверка «чей клиент»
async function pullLeads(q) {
  const cur = await kvGet(q, 'b24:cur:lead')
  const items = await listAll('crm.lead.list', { filter: { '>=DATE_CREATE': since(cur) }, order: { DATE_CREATE: 'ASC' }, select: ['ID', 'TITLE', 'STATUS_ID', 'DATE_CREATE', 'PHONE', 'EMAIL'] }, 500)
  let n = 0
  for (const l of items) {
    const row = await inbox(q, 'lead', l.ID, 'new')
    if (!row) continue
    n++
    if ((await q('select 1 from portal.clients where b24_lead_id = $1', [l.ID])).length) { await mark(q, row, 2, null, 'лид портала'); continue }
    const k = keys(l)
    if (!k.pn && !k.em) { await mark(q, row, 2, null, 'нет телефона и почты'); continue }
    const hit = (await q(`select * from portal.clients where ${matchSql} order by (attach_status = 'candidate'), created_at limit 1`, [k.pn, k.em]))[0]
    const check = async (v) => ({ UF_CRM_GE_CHECK: await enumId('lead', 'UF_CRM_GE_CHECK', v) })
    const comment = (t) => res('crm.timeline.comment.add', { fields: { ENTITY_ID: l.ID, ENTITY_TYPE: 'lead', COMMENT: `${OURS} ${t}` } })
    if (!hit) { await res('crm.lead.update', { id: l.ID, fields: await check('Free') }); await mark(q, row, 2, null, 'свободен'); continue }
    if (hit.owner_type === 'partner' && hit.attach_status === 'candidate') {
      await res('crm.lead.update', { id: l.ID, fields: await check('Partner candidate') })
      await comment(`кандидат партнёра (${hit.reg_no}) — у партнёра приоритет до ${String(hit.candidate_until || '').slice(0, 10)}; согласуйте с руководителем рынка`)
      await notifyMany(q, await heads(q, hit.market), 'client', 'Команда получила лид по кандидату партнёра — у партнёра приоритет 14 дней', `/clients/${hit.id}`, {})
      await mark(q, row, 2, hit.id, 'кандидат партнёра'); continue
    }
    if (hit.owner_type === 'partner' && ['protected', 'extended'].includes(hit.attach_status)) {
      await res('crm.lead.update', { id: l.ID, fields: { STATUS_ID: 'GE_PARTNER_CLIENT', ...(await check('Partner')) } })
      await comment(`клиент закреплён за партнёром (${hit.reg_no}) до ${String(hit.protected_until || '').slice(0, 10)} — лид закрыт как Partner client`)
      await notifyMany(q, await heads(q, hit.market), 'client', 'Лид по клиенту партнёра закрыт как Partner client: {c}', `/clients/${hit.id}`, { c: hit.name })
      await mark(q, row, 2, hit.id, 'Partner client'); continue
    }
    await res('crm.lead.update', { id: l.ID, fields: { STATUS_ID: 'GE_DUPLICATE', ...(await check('Duplicate')) } })
    await comment(`клиент уже есть (${hit.reg_no})${hit.b24_deal_id ? ', сделка ' + hit.b24_deal_id : ''} — лид закрыт как Duplicate`)
    await mark(q, row, 2, hit.id, 'Duplicate')
  }
  if (items.length) await kvSet(q, 'b24:cur:lead', items[items.length - 1].DATE_CREATE)
  return n
}

// 3. Телефон или почта контакта изменены — обновить клиента и проверить совпадения
async function pullContacts(q) {
  const cur = await kvGet(q, 'b24:cur:contact')
  const items = await listAll('crm.contact.list', { filter: { '>=DATE_MODIFY': since(cur) }, order: { DATE_MODIFY: 'ASC' }, select: ['ID', 'DATE_MODIFY', 'PHONE', 'EMAIL'] }, 500)
  let n = 0
  for (const c of items) {
    const row = await inbox(q, 'contact', c.ID, c.DATE_MODIFY)
    if (!row) continue
    const cl = (await q('select * from portal.clients where b24_contact_id = $1 order by created_at limit 1', [c.ID]))[0]
    if (!cl) { await mark(q, row, 3, null, 'не связан с клиентом'); continue }
    const k = keys(c)
    const newPhone = k.pn && k.pn !== cl.phone_norm, newMail = k.em && k.em !== cl.email_norm
    if (!newPhone && !newMail) { await mark(q, row, 3, cl.id, 'без изменений'); continue }
    n++
    await q('update portal.clients set phone = case when $2 then $3 else phone end, phone_norm = case when $2 then $4 else phone_norm end, email = case when $5 then $6 else email end, email_norm = case when $5 then $7 else email_norm end where id = $1',
      [cl.id, newPhone, k.phone, k.pn, newMail, k.email, k.em])
    await note(q, cl.id, 'Контакты обновлены в Bitrix24', {}, true)
    const other = (await q(`select * from portal.clients where id <> $3 and ${matchSql} limit 1`, [newPhone ? k.pn : '', newMail ? k.em : '', cl.id]))[0]
    if (other) {
      await note(q, cl.id, 'Новые контакты совпали с клиентом {r} — проверьте, не один ли это человек', { r: other.reg_no }, true)
      await notifyMany(q, await heads(q, cl.market), 'dispute', 'Совпадение контактов: {a} и {b} — проверьте', `/clients/${cl.id}`, { a: cl.reg_no, b: other.reg_no })
    }
    await mark(q, row, 3, cl.id, other ? `обновлён, совпадение с ${other.reg_no}` : 'контакты обновлены')
  }
  if (items.length) await kvSet(q, 'b24:cur:contact', items[items.length - 1].DATE_MODIFY)
  return n
}

// 17. Комментарии в ленте сделок клиентов партнёров → карточка портала. Партнёр видит только начатые с «Партнёру:» / «Partner:», остальное — внутреннее
async function pullComments(q) {
  const deals = await q(`select id, b24_deal_id, owner_id from portal.clients where b24_deal_id is not null and owner_type = 'partner'
    and coalesce(b24_semantic, 'P') = 'P' order by b24_synced_at desc nulls last limit 40`)
  let n = 0
  for (const d of deals) {
    const list = await res('crm.timeline.comment.list', { filter: { ENTITY_ID: d.b24_deal_id, ENTITY_TYPE: 'deal' }, select: ['ID', 'CREATED', 'COMMENT', 'AUTHOR_ID'] })
    for (const c of list || []) {
      const text = String(c.COMMENT || '').replace(/\[[^\]]+\]/g, '').trim()
      if (!text || text.startsWith(OURS)) continue
      const row = await inbox(q, 'comment', c.ID, '1')
      if (!row) continue
      const pub = /^(партнёру|партнеру|partner)\s*:/i.test(text)
      const body = pub ? text.replace(/^[^:]+:\s*/, '') : text
      await q(`insert into portal.activities (client_id, user_id, kind, text, internal, vars) values ($1,$2,'note',$3,$4,$5)`, [d.id, await portalUser(q, c.AUTHOR_ID), `Bitrix24: ${body}`.slice(0, 4000), !pub, JSON.stringify({ b24_comment: c.ID })])
      if (pub) await notifyMany(q, [d.owner_id], 'deal', 'Новый комментарий команды по клиенту', `/clients/${d.id}`, {})
      await mark(q, row, 17, d.id, pub ? 'комментарий партнёру' : 'внутренний комментарий')
      n++
    }
  }
  return n
}

// 21. Сотрудники: связать по почте, уволенных — выключить в портале; без пользователя портала — список в админке
async function pullUsers(q) {
  const all = [...(await listAll('user.get', { FILTER: { ACTIVE: true } }, 500)), ...(await listAll('user.get', { FILTER: { ACTIVE: false } }, 500))]
  const TEAM = ['owner', 'market_head', 'seller', 'office', 'finance', 'content']
  let linked = 0, off = 0
  const unmatched = []
  for (const u of all) {
    if (u.USER_TYPE && u.USER_TYPE !== 'employee') continue
    const email = String(u.EMAIL || '').trim().toLowerCase(), id = Number(u.ID), active = u.ACTIVE === true || u.ACTIVE === 'Y'
    let pu = (await q('select id, active, role from portal.users where b24_user_id = $1', [id]))[0]
    if (!pu && email) {
      pu = (await q(`select id, active, role from portal.users where lower(email) = $1 and b24_user_id is null and role = any($2)`, [email, TEAM]))[0]
      if (pu) { await q('update portal.users set b24_user_id = $2 where id = $1', [pu.id, id]); linked++ }
    }
    if (!pu) { if (active) unmatched.push({ id, name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' '), email }); continue }
    if (!active && pu.active && TEAM.includes(pu.role) && pu.role !== 'owner') {
      await q('update portal.users set active = false, session_ver = session_ver + 1 where id = $1', [pu.id])
      await q(`insert into portal.audit (action, entity, entity_id, data) values ('b24.user_off', 'user', $1, $2)`, [pu.id, JSON.stringify({ b24: id })])
      off++
    }
  }
  await kvSet(q, 'b24:unmatched', JSON.stringify(unmatched.slice(0, 100)))
  await kvSet(q, 'b24:users_at', new Date().toISOString())
  return { linked, off, unmatched: unmatched.length }
}

// Сверка раз в час: перечитать все связанные сделки — пропущенные изменения обработаются (дубли отсекает журнал)
async function reconcile(q) {
  const ids = (await q('select b24_deal_id id from portal.clients where b24_deal_id is not null union select b24_deal_id from portal.agent_applications where b24_deal_id is not null')).map((r) => Number(r.id))
  let n = 0
  for (let i = 0; i < ids.length; i += 50) {
    const items = await listAll('crm.deal.list', { filter: { ID: ids.slice(i, i + 50) }, select: DEAL_SELECT }, 50)
    for (const d of items) if (await handleDeal(q, d)) n++
  }
  return { deals: ids.length, changed: n }
}
