// Заявки с сайтов и смарт-каталога (М5). Портал принимает сырую заявку, проверяет «чей клиент» по телефону и e-mail
// (правило «кто раньше»), заводит или находит клиента и ставит лид в очередь Bitrix24 (bitrix_outbox).
import { q, one, notify } from './db'
import { conditionsFor } from './catalog'

export type LeadIn = {
  name?: string; phone?: string; email?: string; lang?: string; market?: string; comment?: string
  page?: string; site?: string; unit_id?: string; project?: string
  utm?: Record<string, string>; gclid?: string; fbclid?: string; ttclid?: string
  consent?: { text?: string; version?: string; marketing?: boolean } | boolean
  _hp?: string                                       // поле-ловушка: заполнено — бот
}
const normPhone = (p: string) => p.replace(/\D/g, '').replace(/^00/, '')
const MARKETS = ['DE', 'IL', 'GLOBAL']
const clip = (v: unknown, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

export async function ingestLead(source: 'website' | 'quiz' | 'landing' | 'smart_catalog', raw: LeadIn, payload: unknown) {
  const name = clip(raw.name, 120), phone = clip(raw.phone, 40), email = clip(raw.email, 160).toLowerCase()
  const pn = normPhone(phone)
  const market = MARKETS.includes(clip(raw.market).toUpperCase()) ? clip(raw.market).toUpperCase() : raw.lang === 'he' ? 'IL' : raw.lang === 'de' ? 'DE' : 'GLOBAL'
  const lang = ['ru', 'en', 'de', 'he'].includes(clip(raw.lang)) ? clip(raw.lang) : 'en'
  const utm: Record<string, string> = { ...(raw.utm && typeof raw.utm === 'object' ? raw.utm : {}), ...(raw.gclid ? { gclid: clip(raw.gclid) } : {}), ...(raw.fbclid ? { fbclid: clip(raw.fbclid) } : {}), ...(raw.ttclid ? { ttclid: clip(raw.ttclid) } : {}), ...(raw.page ? { page: clip(raw.page, 500) } : {}) }
  const consent = typeof raw.consent === 'object' && raw.consent ? { text: clip(raw.consent.text, 2000), version: clip(raw.consent.version, 40), marketing: !!raw.consent.marketing, at: new Date().toISOString() } : raw.consent === true ? { at: new Date().toISOString() } : null
  const unitId = /^[0-9a-f-]{36}$/.test(clip(raw.unit_id)) ? clip(raw.unit_id) : null
  const project = unitId ? await one<{ project_id: string }>('select project_id from units where id = $1', [unitId]) : clip(raw.project) ? await one<{ project_id: string }>('select id project_id from projects where slug = $1', [clip(raw.project)]) : undefined
  const ins = (result: string | null, err?: string) => one<{ id: string }>(`insert into portal.inbound_leads (source, site, payload, name, phone, phone_norm, email, email_norm, lang, market, unit_id, project_id, utm, consent, result, error)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`, [source, clip(raw.site, 80) || null, payload, name || null, phone || null, pn || null, email || null, email || null, lang, market, unitId, project?.project_id || null, utm, consent, result, err || null])
  // Спам: ловушка, нет ни телефона, ни e-mail, телефон из мусора
  if (raw._hp || (!pn && !email) || (pn && pn.length < 7) || (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) { const r = await ins('spam'); return { id: r!.id, result: 'spam' as const } }
  // Повтор той же заявки за 10 минут — не дублируем
  const rep = await one<{ id: string; result: string }>(`select id, result from portal.inbound_leads where result <> 'spam' and created_at > now() - interval '10 minutes'
    and ((length($1) >= 9 and right(phone_norm, 9) = right($1, 9)) or ($2 <> '' and email_norm = $2)) order by created_at desc limit 1`, [pn, email])
  if (rep) return { id: rep.id, result: 'repeat' as const }
  if (source === 'website' || source === 'quiz' || source === 'landing') { if (!consent) { const r = await ins('error', 'no consent'); return { id: r!.id, result: 'error' as const } } }

  const dup = await one<{ id: string; owner_id: string; name: string; role: string; market: string | null }>(`select cl.id, cl.owner_id, cl.name, u.role, cl.market from portal.clients cl join portal.users u on u.id = cl.owner_id
    where (length($1) >= 9 and length(cl.phone_norm) >= 9 and right(cl.phone_norm, 9) = right($1, 9)) or (cl.email_norm <> '' and cl.email_norm = $2) order by cl.created_at limit 1`, [pn, email])
  let clientId: string, result: 'new_client' | 'existing' | 'partner_client', ownerId: string
  if (dup) {
    // «Кто раньше» (П14): клиент остаётся у того, за кем закреплён; владельцу — уведомление, команде — пометка
    clientId = dup.id; ownerId = dup.owner_id
    result = ['agent', 'agency_head'].includes(dup.role) ? 'partner_client' : 'existing'
    await q(`insert into portal.activities (client_id, kind, text, vars, internal) values ($1,'system','Повторная заявка с сайта ({s})',$2,$3)`, [clientId, { s: source }, result === 'partner_client'])
    await notify(ownerId, 'client', 'Новая заявка от вашего клиента {c} с сайта', `/clients/${clientId}`, { c: dup.name })
    if (result === 'partner_client') for (const h of await q<{ id: string }>(`select id from portal.users where active and role = 'market_head' and market = $1`, [dup.market])) await notify(h.id, 'client', 'Заявка с сайта от клиента партнёра: {c}', `/clients/${clientId}`, { c: dup.name })
  } else {
    // Новый клиент — руководителю рынка заявки (нет — владельцу); закрепление с момента заявки (решение по ТЗ: при создании лида)
    const owner = await one<{ id: string }>(`select id from portal.users where active and ((role = 'market_head' and market = $1) or role = 'owner') order by role = 'market_head' desc, created_at limit 1`, [market])
    ownerId = owner!.id
    const pid = project?.project_id || (await one<{ id: string }>(`select id from projects where slug = 'premium-residence'`))?.id
    const months = (pid ? (await conditionsFor(pid))?.protect_months : null) ?? 3
    const seq = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
    const reg = `R-${new Date().getFullYear()}-0${seq!.n}`
    const r = await one<{ id: string; protected_until: string }>(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, language, market, consent_at, source, interest, stage, protected_until)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'lead', current_date + ($13 || ' months')::interval) returning id, protected_until::text`,
      [reg, ownerId, name || phone || email, phone || null, pn, email || null, email, lang, market, consent ? new Date() : null, source, clip(raw.comment, 1000) || null, months])
    clientId = r!.id; result = 'new_client'
    await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Заявка с сайта ({s}) — клиент зарегистрирован ({r}), закреплён до {d}',$2)`, [clientId, { s: source, r: reg, d: r!.protected_until }])
    await notify(ownerId, 'client', 'Новая заявка с сайта: {c}', `/clients/${clientId}`, { c: name || phone || email })
  }
  const lead = await ins(result)
  await q('update portal.inbound_leads set client_id = $2 where id = $1', [lead!.id, clientId])
  if (unitId) await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Интерес к квартире с сайта',$2)`, [clientId, { unit: unitId }])
  // Лид в Bitrix24 — через очередь; поля по ТЗ развёртывания (Source, Market, язык, метки, «чей клиент»)
  await q(`insert into portal.bitrix_outbox (method, payload, ref_kind, ref_id) values ('crm.lead.add', $1, 'inbound_lead', $2)`, [{
    fields: {
      TITLE: `${source === 'smart_catalog' ? 'Smart catalog' : 'Website'}: ${name || phone || email}`, NAME: name, SOURCE_ID: 'WEB', SOURCE_DESCRIPTION: source,
      PHONE: phone ? [{ VALUE: phone, VALUE_TYPE: 'WORK' }] : undefined, EMAIL: email ? [{ VALUE: email, VALUE_TYPE: 'WORK' }] : undefined,
      UTM_SOURCE: utm.utm_source, UTM_MEDIUM: utm.utm_medium, UTM_CAMPAIGN: utm.utm_campaign, UTM_CONTENT: utm.utm_content, UTM_TERM: utm.utm_term,
      COMMENTS: [clip(raw.comment, 1000), utm.page ? 'Page: ' + utm.page : '', result === 'partner_client' ? 'Клиент партнёра — закреплён в портале' : ''].filter(Boolean).join('\n'),
    },
    portal: { client_id: clientId, market, lang, result, unit_id: unitId, gclid: utm.gclid, fbclid: utm.fbclid, ttclid: utm.ttclid, consent },
  }, lead!.id])
  return { id: lead!.id, result, clientId }
}
