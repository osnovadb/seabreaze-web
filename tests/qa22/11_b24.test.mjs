// QA 2.2 · 11 Обмен с Bitrix24 (§13, только исходящий): кандидат → лид Candidate; квалификация → контакт, сделка Partner clients, задача, лид Qualified;
// бронь → стадии; «Договор подписан» → SPA signed; оплата → Won + Aftercare (оплата — полем, без Installments); согласия → поля; удаление → лид удалён.
// Запуск только на отдельном экземпляре с вебхуком (QA_URL=:3044, B24_WEBHOOK задан). Всё созданное в Bitrix24 удаляется в конце.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, register, qualify, freeUnit, q, one, close, act, lastBooking, client } from './h.mjs'

const WH = (process.env.B24_WEBHOOK || '').replace(/\/+$/, '')
const skip = !WH || !/3044/.test(process.env.QA_URL || '')
const b24 = async (m, p = {}) => { const r = await fetch(`${WH}/${m}.json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }).then((x) => x.json()); if ('error' in r || r.error_description) throw new Error(`${m}: ${r.error} ${r.error_description || ''}`); return r.result } // Bitrix24 на удалённую запись отвечает error: ''
const made = { lead: new Set(), contact: new Set(), deal: new Set(), task: new Set() }
const keep = async (cl) => { const c = await client(cl); for (const [k, f] of [['lead', 'b24_lead_id'], ['contact', 'b24_contact_id'], ['deal', 'b24_deal_id']]) if (c[f]) made[k].add(Number(c[f])); return c }
const stageName = async (dealId) => { const d = await b24('crm.deal.get', { id: dealId }); const st = await b24('crm.status.list', { filter: { ENTITY_ID: Number(d.CATEGORY_ID) ? `DEAL_STAGE_${d.CATEGORY_ID}` : 'DEAL_STAGE' } }); return st.find((s) => s.STATUS_ID === d.STAGE_ID)?.NAME }

before(async () => {
  if (skip) return
  // QA-копия базы не должна писать в сделки стенда: связи со старыми записями Bitrix24 обнуляем, новые лиды/сделки — только для клиентов этого прогона
  await q(`update portal.clients set b24_lead_id = null, b24_contact_id = null, b24_deal_id = null where created_at < now() - interval '1 minute'`)
  await q(`update portal.deals set b24_inst_id = null, b24_after_id = null`)
  await q(`update portal.agent_applications set b24_deal_id = null, b24_contact_id = null`)
  await q(`insert into portal.kv (key, value) values ('b24:create_from', $1) on conflict (key) do update set value = $1`, [new Date().toISOString()])
  await q(`update portal.conditions set max_bookings_total = 100000, max_bookings_client = 100`)
})
after(async () => {
  if (!skip) {
    for (const t of (await b24('tasks.task.list', { filter: { '%TITLE': 'QA' }, select: ['ID'] }).catch(() => ({ tasks: [] }))).tasks || []) made.task.add(Number(t.id))
    for (const id of made.task) await b24('tasks.task.delete', { taskId: id }).catch(() => null)
    for (const id of made.deal) await b24('crm.deal.delete', { id }).catch(() => null)
    for (const id of made.contact) await b24('crm.contact.delete', { id }).catch(() => null)
    for (const id of made.lead) await b24('crm.lead.delete', { id }).catch(() => null)
    console.log(`# Bitrix24 cleanup: deals ${made.deal.size}, contacts ${made.contact.size}, leads ${made.lead.size}, tasks ${made.task.size}`)
  }
  await close()
})

let P, OF, FI, OW
test('setup', { skip }, async () => { const ag = await agency('DE'); P = await user('agency_head', { agency_id: ag.id, name: 'QA Partner B24' }); OF = await user('office'); FI = await user('finance'); OW = await user('owner', { market: null }) })
test('кандидат партнёра → лид Candidate с полями партнёра', { skip }, async () => {
  const r = await register(P, { name: 'QA B24 Candidate' })
  const c = await keep(r.result.id)
  assert.ok(c.b24_lead_id, 'лид не создан')
  const l = await b24('crm.lead.get', { id: c.b24_lead_id })
  assert.equal(l.STATUS_ID, 'GE_CANDIDATE'); assert.equal(l.SOURCE_ID, 'GE_PARTNER'); assert.ok(l.UF_CRM_GE_AGENCY, 'нет агентства в лиде')
})
let sale
test('квалификация → контакт, сделка Partner clients DE, лид Qualified', { skip }, async () => {
  const r = await register(P, { name: 'QA B24 Qualified' })
  await qualify(P, r.result.id)
  const c = await keep(r.result.id)
  assert.ok(c.b24_deal_id && c.b24_contact_id, 'сделка или контакт не созданы')
  const d = await b24('crm.deal.get', { id: c.b24_deal_id })
  const cats = (await b24('crm.category.list', { entityTypeId: 2 })).categories
  assert.equal(cats.find((x) => Number(x.id) === Number(d.CATEGORY_ID))?.name, 'Partner clients DE')
  assert.equal((await b24('crm.lead.get', { id: c.b24_lead_id })).STATUS_ID, 'CONVERTED')
  sale = r.result.id
})
test('бронь → Reservation request → Reserved → KYC → SPA signed → Won; Aftercare с долей оплаты (без Installments)', { skip }, async () => {
  const u = await freeUnit()
  await act(P, 'createBooking', { unit: u.id, client: sale, discount: 0 })
  const c = await client(sale)
  assert.equal(await stageName(c.b24_deal_id), 'Reservation request')
  const b = await lastBooking(sale)
  await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-B24' })
  assert.equal(await stageName(c.b24_deal_id), 'Reserved')
  const d1 = await b24('crm.deal.get', { id: c.b24_deal_id })
  assert.equal(d1.UF_CRM_GE_DEV_RES_NO, 'QA-B24')
  await q(`update portal.clients set kyc_status = 'pending' where id = $1`, [sale])
  await act(OF, 'reviewKyc', { client: sale, decision: 'passed' })
  assert.equal(await stageName(c.b24_deal_id), 'KYC')
  await act(OF, 'bookingAction', { id: b.id, act: 'spa_approval' }) // гл. 6: «Договор на согласовании» — после KYC Passed
  assert.equal(await stageName(c.b24_deal_id), 'SPA approval')
  await act(OF, 'bookingAction', { id: b.id, act: 'contract' })
  assert.equal(await stageName(c.b24_deal_id), 'SPA signed')
  const d = await one('select id from portal.deals where client_id = $1', [sale])
  await act(FI, 'dealPaid', { id: d.id, paid: 30 })
  assert.equal(await stageName(c.b24_deal_id), 'Won')
  const pd = await one('select b24_inst_id, b24_after_id from portal.deals where id = $1', [d.id])
  assert.ok(pd.b24_after_id, 'Aftercare не создана'); assert.ok(!pd.b24_inst_id, 'создана сделка Installments — её больше нет (гл. 12)')
  made.deal.add(Number(pd.b24_after_id))
  assert.equal(Number((await b24('crm.deal.get', { id: pd.b24_after_id })).UF_CRM_GE_PAID_PCT), 30, 'доля оплаты не в поле Aftercare')
  await act(FI, 'dealPaid', { id: d.id, paid: 100 })
  assert.equal(Number((await b24('crm.deal.get', { id: pd.b24_after_id })).UF_CRM_GE_PAID_PCT), 100, 'полная оплата не в поле Aftercare')
})
test('согласие клиента → поля контакта; Do not contact', { skip }, async () => {
  const c = await client(sale)
  await act(null, 'answerConsent', { token: c.consent_token, act: 'give', data: 'on', marketing: 'on' })
  const ct = await b24('crm.contact.get', { id: c.b24_contact_id })
  assert.ok(ct.UF_CRM_GE_DATA_CONSENT && ct.UF_CRM_GE_MKT_CONSENT, 'согласия не в контакте')
})
test('заявка с сайта → лид New с метками (сейлзов нет — назначение вручную)', { skip }, async () => {
  const sec = process.env.LEADS_SECRET
  const r = await fetch(`${process.env.QA_URL}/api/leads/${sec}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://getsestate.com', host: 'portal.pdna.pro' },
    body: JSON.stringify({ name: 'QA B24 Web', phone: '+49 151 ' + Math.floor(Math.random() * 1e8), lang: 'de', market: 'DE', consent: { marketing: false }, utm: { utm_source: 'qa', gclid: 'QA-GCLID', page: '/qa' } }) }).then((x) => x.json())
  assert.ok(r.ok, JSON.stringify(r))
  const cl = await one(`select id from portal.inbound_leads where id = $1`, [r.id]).then((x) => one('select client_id from portal.inbound_leads where id = $1', [r.id]))
  const c = await keep(cl.client_id)
  const l = await b24('crm.lead.get', { id: c.b24_lead_id })
  assert.equal(l.STATUS_ID, 'NEW'); assert.equal(l.SOURCE_ID, 'GE_WEBSITE'); assert.equal(l.UF_CRM_GE_GCLID, 'QA-GCLID'); assert.equal(l.UTM_SOURCE, 'qa')
})
test('удаление по запросу: лид без сделки удалён в Bitrix24', { skip }, async () => {
  const r = await register(P, { name: 'QA B24 Delete' })
  const c = await keep(r.result.id)
  await act(OF, 'createPrivacyRequest', { client: c.reg_no })
  const req = await one(`select id from portal.privacy_requests where client_id = $1`, [c.id])
  await act(OF, 'executePrivacyRequest', { id: req.id })
  await assert.rejects(b24('crm.lead.get', { id: c.b24_lead_id }), /Not found/)
})
test('очередь обмена: ошибок нет', { skip }, async () => {
  const bad = await q(`select kind, last_error from portal.b24_jobs where status in ('error','dead') and created_at > now() - interval '30 minutes'`)
  assert.equal(bad.length, 0, JSON.stringify(bad))
})
test('заявка партнёра → сделка в воронке Partners рынка, тип — полем (гл. 10, без Agencies / Sub-agents)', { skip }, async () => {
  const email = `qa-apply-${Date.now().toString(36)}@qa.test`
  await act(null, 'applyAgent', { kind: 'agency', name: 'QA Apply TEST', company: 'QA Apply TEST GmbH', email, phone: '+49 151 ' + String(Date.now()).slice(-7), market: 'DE', consent: 'on', lang: 'de' })
  const a = await one('select id, b24_deal_id, b24_contact_id from portal.agent_applications where email = $1', [email])
  assert.ok(a?.b24_deal_id, 'сделка заявки не создана')
  made.deal.add(Number(a.b24_deal_id)); if (a.b24_contact_id) made.contact.add(Number(a.b24_contact_id))
  const d = await b24('crm.deal.get', { id: a.b24_deal_id })
  const cats = (await b24('crm.category.list', { entityTypeId: 2 })).categories
  assert.equal(cats.find((c) => String(c.id) === String(d.CATEGORY_ID))?.name, 'Partners DE')
  assert.ok(d.UF_CRM_GE_PARTNER_TYPE, 'тип партнёра не заполнен')
  assert.ok(!cats.some((c) => /^(Agencies|Sub-agents) |^Installments$/.test(c.name)), 'остались прежние воронки')
})
test('две подтверждённые брони → две сделки: вторая квартира — своя сделка того же клиента, сумма — цена её квартиры (гл. 6)', { skip }, async () => {
  const r = await register(P, { name: 'QA B24 Two Units', fields: { goal: 'invest', budget: '300k', timeline: '3m' } })
  const c0 = await keep(r.result.id)
  assert.ok(c0.b24_deal_id, 'нет сделки клиента')
  const u1 = await freeUnit(), u2 = await freeUnit('premium-residence', { exclude: [u1.id] })
  for (const u of [u1, u2]) {
    await act(P, 'createBooking', { unit: u.id, client: c0.id, discount: 0 })
    const b = await one(`select id from portal.bookings where client_id = $1 and unit_id = $2 order by created_at desc limit 1`, [c0.id, u.id])
    await act(OF, 'bookingAction', { id: b.id, act: 'confirm', dev_no: 'QA-2U' })
  }
  const bs = await q(`select b.unit_id, b.b24_deal_id, b.final_price::float price from portal.bookings b where b.client_id = $1 and b.status = 'confirmed' order by b.created_at`, [c0.id])
  assert.equal(bs.length, 2)
  assert.equal(String(bs[0].b24_deal_id), String(c0.b24_deal_id), 'первая подтверждённая бронь — не в сделке клиента')
  assert.ok(bs[1].b24_deal_id && String(bs[1].b24_deal_id) !== String(c0.b24_deal_id), 'вторая бронь без своей сделки')
  made.deal.add(Number(bs[1].b24_deal_id))
  const d1 = await b24('crm.deal.get', { id: bs[0].b24_deal_id }), d2 = await b24('crm.deal.get', { id: bs[1].b24_deal_id })
  assert.equal(d2.CATEGORY_ID, d1.CATEGORY_ID); assert.equal(String(d2.CONTACT_ID), String(d1.CONTACT_ID))
  assert.equal(Number(d1.OPPORTUNITY), Math.round(bs[0].price)); assert.equal(Number(d2.OPPORTUNITY), Math.round(bs[1].price))
  assert.equal(await stageName(bs[1].b24_deal_id), 'Reserved')
})
test('«Отказ» во вкладке Units → сделка Lost с причиной из списка (гл. 6)', { skip }, async () => {
  const S = await user('seller', { market: 'DE' })
  const r = await register(S, { name: 'QA B24 Refuse' })
  const c = await keep(r.result.id)
  assert.ok(c.b24_deal_id, 'нет сделки клиента команды')
  await act(S, 'refuseClient', { client: c.id, reason: 'Financing' })
  const d = await b24('crm.deal.get', { id: c.b24_deal_id })
  assert.equal(d.STAGE_SEMANTIC_ID, 'F', 'сделка не закрыта как Lost')
  const f = (await b24('crm.deal.userfield.list', { filter: { FIELD_NAME: 'UF_CRM_GE_LOST' } }))[0]
  assert.equal(f.LIST.find((x) => String(x.ID) === String(d.UF_CRM_GE_LOST))?.VALUE, 'Financing')
})
