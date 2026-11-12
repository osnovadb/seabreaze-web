// 2.2 · §7 Регистрации: общий фильтр для экрана и выгрузки в xlsx (одни и те же условия — файл совпадает с тем, что на экране)
import { q } from './db'

export type RegParams = { f?: string; d?: string; p?: string; m?: string; src?: string; s?: string; from?: string; to?: string; by?: string; flag?: string; cons?: string; ids?: string }
export type RegRow = { id: string; status: string; reject_reason: string | null; mass: boolean; priority: boolean; due_send: string | null; sent_at: string | null; answer_due: string | null
  valid_until: string | null; created_at: string; decided_at: string | null; client: string; client_id: string; reg_no: string; phone: string | null; email: string | null; country: string | null
  consent_status: string | null; owner_type: string; owner: string; agency: string | null; market: string | null; developer: string; developer_id: string; project: string; project_id: string; silence_rule: string; anonymized: boolean; withdrawn_at: string | null }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/

// Группы статусов — вкладки экрана
export function groupOf(r: Pick<RegRow, 'status' | 'answer_due' | 'valid_until'>, today: string) {
  const soon = r.valid_until !== null && r.valid_until <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  return { today: r.status === 'to_send', wait: r.status === 'sent' && (r.answer_due ?? '9') >= today, silence: r.status === 'sent' && (r.answer_due ?? '9') < today,
    expiring: ['confirmed', 'confirmed_silence'].includes(r.status) && soon, confirmed: ['confirmed', 'confirmed_silence'].includes(r.status), rejected: r.status === 'rejected', all: true } as Record<string, boolean>
}

export async function loadRegistrations(sp: RegParams, user: { role: string; market: string | null }) {
  const w: string[] = [], a: unknown[] = []
  const add = (sql: string, v: unknown) => { a.push(v); w.push(sql.replace(/\$\?/g, '$' + a.length)) }
  // удалённые по запросу клиента — только во «Все» (история), никогда в отправку и файл застройщику
  if (sp.f !== 'all') w.push('cl.anonymized_at is null')
  if (user.role === 'market_head') add('cl.market = $?', user.market || '')
  if (sp.d && UUID.test(sp.d)) add('r.developer_id = $?::uuid', sp.d)
  if (sp.p && UUID.test(sp.p)) add('r.project_id = $?::uuid', sp.p)
  if (sp.m && ['DE', 'IL', 'GLOBAL'].includes(sp.m)) add('cl.market = $?', sp.m)
  if (sp.src === 'team') w.push(`cl.owner_type = 'team'`)
  else if (sp.src === 'partner') w.push(`cl.owner_type = 'partner'`)
  else if (sp.src === 'referrer') w.push(`(cl.owner_type = 'referrer' or cl.referrer_id is not null)`)
  if (sp.flag === 'priority') w.push('r.priority'); else if (sp.flag === 'mass') w.push('r.mass')
  if (sp.cons === 'yes') w.push(`cl.consent_status = 'given'`); else if (sp.cons === 'no') w.push(`coalesce(cl.consent_status, '') <> 'given'`)
  // период — по дате, которая важна для выбранной вкладки: поставлено в очередь / отправлено / решение
  const col = sp.by === 'sent' ? 'r.sent_at' : sp.by === 'decided' ? 'r.decided_at' : 'r.created_at'
  if (sp.from && DATE.test(sp.from)) add(`${col} >= $?::date`, sp.from)
  if (sp.to && DATE.test(sp.to)) add(`${col} < $?::date + 1`, sp.to)
  const s = (sp.s || '').trim().toLowerCase().slice(0, 80)
  if (s) {
    // имя, номер R-, e-mail, партнёр — подстрокой; телефон — по цифрам (от 5)
    a.push(`%${s}%`); const n = a.length
    const digits = s.replace(/\D/g, '')
    let phone = ''
    if (digits.length >= 5) { a.push(`%${digits}%`); phone = ` or cl.phone_norm like $${a.length}` }
    w.push(`(lower(cl.name) like $${n} or lower(cl.reg_no) like $${n} or lower(coalesce(cl.email, '')) like $${n} or lower(u.name) like $${n}${phone})`)
  }
  const ids = (sp.ids || '').split(',').filter((x) => UUID.test(x))
  if (ids.length) add('r.id = any($?::uuid[])', ids)
  const rows = await q<RegRow>(`select r.id, r.status, r.reject_reason, r.mass, r.priority, r.due_send::text, r.sent_at, r.answer_due::text, r.valid_until::text, r.created_at, r.decided_at,
      cl.name client, cl.id client_id, cl.reg_no, cl.phone, cl.email, cl.country, cl.consent_status, cl.owner_type, u.name owner, ag.name agency, cl.market,
      d.name developer, d.id developer_id, p.name project, p.id project_id, coalesce(k.silence_rule, 'remind') silence_rule, cl.anonymized_at is not null anonymized,
      case when cl.consent_status = 'withdrawn' then (select max(a.created_at) from portal.activities a where a.client_id = cl.id and a.text = 'Клиент отозвал согласие на обработку данных') end withdrawn_at -- О100
    from portal.registrations r join portal.clients cl on cl.id = r.client_id join portal.users u on u.id = cl.owner_id left join portal.agencies ag on ag.id = u.agency_id
      join portal.developers d on d.id = r.developer_id join public.projects p on p.id = r.project_id cross join lateral (select * from portal.cur_conditions(r.project_id)) k
    ${w.length ? 'where ' + w.join(' and ') : ''}
    order by r.priority desc, r.due_send nulls last, r.created_at`, a)
  return rows
}
