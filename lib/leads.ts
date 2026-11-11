// Заявки с сайтов и смарт-каталога (М5). Портал принимает сырую заявку, проверяет «чей клиент» по телефону и e-mail
// (правило «кто раньше»), заводит или находит клиента и ставит лид в очередь Bitrix24 (bitrix_outbox).
import { enqueueWebLead, processJob } from './b24x.mjs'
import { q, one, tx, notify } from './db'
import { bakuYear } from './i18n'
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
  const name = clip(raw.name, 120), email = clip(raw.email, 160).toLowerCase()
  let phone = clip(raw.phone, 40), pn = normPhone(phone)
  // опечатка в телефоне при нормальном e-mail — принимаем по e-mail
  if (pn && pn.length < 7 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { phone = ''; pn = '' }
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
  if (source === 'website' || source === 'quiz' || source === 'landing') { if (!consent) { const r = await ins('error', 'no consent'); return { id: r!.id, result: 'error' as const } } }
  // Одновременные одинаковые заявки (двойной клик) — по очереди: блокировка по телефону и e-mail до конца обработки
  return tx(async (t) => {
    for (const k of [pn.length >= 9 ? 'p:' + pn.slice(-9) : '', email ? 'e:' + email : ''].filter(Boolean).sort()) await t.query('select pg_advisory_xact_lock(hashtext($1))', ['lead:' + k])
    return matchLead()
  })
  async function matchLead() {
  // Повтор той же заявки за 10 минут — не дублируем (неудачные и спам не считаются)
  const rep = await one<{ id: string; result: string }>(`select id, result from portal.inbound_leads where result not in ('spam','error') and created_at > now() - interval '10 minutes'
    and ((length($1) >= 9 and right(phone_norm, 9) = right($1, 9)) or ($2 <> '' and email_norm = $2)) order by created_at desc limit 1`, [pn, email])
  if (rep) return { id: rep.id, result: 'repeat' as const }

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
    // Б5 / 290 (Денис 11.11): срок закрепления — одна настройка, 6 месяцев (было — старое поле условий проекта, 3 мес.)
    void pid; const months = 6
    const seq = await one<{ n: number }>(`select nextval('portal.client_reg_seq')::int n`)
    const reg = `R-${bakuYear()}-${String(seq!.n).padStart(4, '0')}`
    const r = await one<{ id: string; protected_until: string }>(`insert into portal.clients (reg_no, owner_id, name, phone, phone_norm, email, email_norm, language, market, consent_at, source, interest, stage, protected_until)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'lead', current_date + ($13 || ' months')::interval) returning id, protected_until::text`,
      [reg, ownerId, name || phone || email, phone || null, pn, email || null, email, lang, market, consent ? new Date() : null, source, clip(raw.comment, 1000) || null, months])
    clientId = r!.id; result = 'new_client'
    // §15: галочки на сайте поставил сам клиент — журнал согласий; маркетинг — только по второй галочке
    if (consent) {
      const mk = typeof consent === 'object' && 'marketing' in consent && !!consent.marketing
      await q(`update portal.clients set consent_status = 'given', marketing_consent_at = case when $2 then now() end where id = $1`, [clientId, mk])
      await q(`insert into portal.consents (client_id, kind, granted, source, lang) values ($1,'data',true,$3,$4), ($1,'marketing',$2,$3,$4)`, [clientId, mk, source, lang || null])
    }
    await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Заявка с сайта ({s}) — клиент зарегистрирован ({r}), закреплён до {d}',$2)`, [clientId, { s: source, r: reg, d: r!.protected_until }])
    await notify(ownerId, 'client', 'Новая заявка с сайта: {c}', `/clients/${clientId}`, { c: name || phone || email })
  }
  const lead = await ins(result)
  await q('update portal.inbound_leads set client_id = $2 where id = $1', [lead!.id, clientId])
  if (unitId) await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Интерес к квартире с сайта',$2)`, [clientId, { unit: unitId }])
  // 2.2 · §13 п.1: лид в Bitrix24 — через очередь обмена (метки, согласия, «чей клиент», распределение); копия — письмом в ящик рынка
  const job = await enqueueWebLead(q, clientId, { source, result, lang, comment: clip(raw.comment, 1000), page: utm.page, utm })
  if (job) await processJob(q, job).catch(() => null)
  const box = await one<{ mailbox: string | null }>('select mailbox from portal.markets where code = $1', [market || 'GLOBAL'])
  if (box?.mailbox) await q(`insert into portal.outbox_messages (channel, to_addr, subject, body, kind) values ('email',$1,$2,$3,'lead_copy')`,
    [box.mailbox, `GetsEstate · ${source}: ${name || phone || email}`, [`${name || ''} · ${phone || ''} · ${email || ''}`, `Source: ${source} · ${utm.page || ''}`, `Result: ${result}`, clip(raw.comment, 1000) || '', `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/clients/${clientId}`].join('\n')])
  return { id: lead!.id, result, clientId }
  }
}
