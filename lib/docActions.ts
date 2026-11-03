'use server'
// Действия М8: шаблоны документов (владелец и контент), создание документа по брони или фиксации, статусы и подписанная копия.
import { revalidatePath } from 'next/cache'
import { q, one, audit, notify } from './db'
import { requireCtx, type Ctx } from './auth'
import { clientScope } from './scope'
import { storeFile, isFile } from './files'
import { t, LANGS, type Lang } from './i18n'
import { DOC_KINDS, inspectTemplate, varAllowed, createDocument, canEditTemplates, type DocKind } from './docs'
import { syncAct } from './acts'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function writeCtx() {
  const c = await requireCtx()
  if (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1') throw new Error('read-only: impersonation')
  return c
}
const log = (c: Ctx, action: string, entity: string, id: string, data?: unknown) => audit(c.real.id, action, entity, id, data, c.impersonating ? c.user.id : null)
async function seesClient(c: Ctx, id: string) {
  const cs = clientScope(c.user)
  return !!(await one(`select 1 from portal.clients cl where cl.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, id]))
}

export async function uploadTemplate(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!canEditTemplates(c.user.role)) return { error: 'Нет прав' }
  const kind = s(f, 'kind') as DocKind, lang = s(f, 'lang') as Lang
  if (!DOC_KINDS.includes(kind) || !LANGS.includes(lang)) return { error: 'Выберите вид документа и язык' }
  const file = f.get('file')
  if (!isFile(file) || !file.name.toLowerCase().endsWith('.docx')) return { error: t(c.lang, 'Нужен файл .docx') }
  let vars: string[]
  try { vars = inspectTemplate(Buffer.from(await file.arrayBuffer())) } catch (e: any) {
    const m = String(e?.message || '')
    if (m.startsWith('vars:')) return { error: t(c.lang, 'В шаблоне неизвестные переменные: {v}', { v: m.slice(5) }) }
    return { error: t(c.lang, 'Не получилось прочитать шаблон: проверьте, что все скобки { } закрыты') }
  }
  const wrong = vars.filter((v) => !varAllowed(kind, v))
  if (wrong.length) return { error: t(c.lang, 'Эти переменные не подходят к виду документа: {v}', { v: wrong.join(', ') }) }
  const fileId = await storeFile(file, c.user.id, { exts: ['docx'] })
  const v = await one<{ n: number }>('select coalesce(max(version), 0) + 1 n from portal.doc_templates where kind = $1 and lang = $2', [kind, lang])
  await q('update portal.doc_templates set active = false where kind = $1 and lang = $2 and active', [kind, lang])
  const r = await one<{ id: string }>(`insert into portal.doc_templates (kind, lang, version, name, file_id, vars, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [kind, lang, v!.n, s(f, 'name') || file.name, fileId, vars, c.user.id])
  await log(c, 'template.upload', 'doc_template', r!.id, { kind, lang, version: v!.n })
  revalidatePath('/admin/templates')
  return { ok: true }
}
export async function activateTemplate(f: FormData) {
  const c = await writeCtx()
  if (!canEditTemplates(c.user.role)) return
  const tpl = await one<{ kind: string; lang: string }>('select kind, lang from portal.doc_templates where id = $1', [s(f, 'id')])
  if (!tpl) return
  await q('update portal.doc_templates set active = false where kind = $1 and lang = $2 and active', [tpl.kind, tpl.lang])
  await q('update portal.doc_templates set active = true where id = $1', [s(f, 'id')])
  await log(c, 'template.activate', 'doc_template', s(f, 'id'))
  revalidatePath('/admin/templates')
}

// Документ по брони (оферта, акт вознаграждения) или по фиксации (акт фиксации) — тот, кто видит клиента
export async function makeDocument(_: unknown, f: FormData) {
  const c = await writeCtx()
  const clientId = s(f, 'client'), kind = s(f, 'kind') as DocKind
  if (!DOC_KINDS.includes(kind) || !(await seesClient(c, clientId))) return { error: 'Нет прав' }
  if (kind === 'commission_act' && !['owner', 'finance', 'office'].includes(c.user.role)) return { error: 'Нет прав' }
  const cl = await one<{ language: string }>('select language from portal.clients where id = $1', [clientId])
  const lang = (LANGS.includes(s(f, 'lang') as Lang) ? s(f, 'lang') : LANGS.includes(cl?.language as Lang) ? cl!.language : 'en') as Lang
  try {
    const d = await createDocument(kind, lang, { clientId, bookingId: s(f, 'booking') || undefined, projectId: s(f, 'project') || undefined }, c.user.id)
    await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Создан документ {n}',$3)`, [clientId, c.user.id, { n: d.number }])
    await log(c, 'document.create', 'document', d.id, { kind, number: d.number })
    revalidatePath(`/clients/${clientId}`)
    return { ok: true, number: d.number, pdf: d.pdf }
  } catch (e: any) {
    const m = String(e?.message || '')
    return { error: m === 'template' ? t(c.lang, 'Нет шаблона для этого вида документа — загрузите его в «Шаблоны документов»') : m === 'booking' ? t(c.lang, 'Выберите бронь клиента') : m === 'fixation' ? t(c.lang, 'Клиент не отправлен на фиксацию в этом проекте') : t(c.lang, 'Документ не создан: {e}', { e: m.slice(0, 80) }) }
  }
}
// Статусы: черновик → отправлен → подписан (с подписанной копией); аннулировать можно до подписания
export async function docStatus(_: unknown, f: FormData) {
  const c = await writeCtx()
  const d = await one<{ id: string; client_id: string; status: string; number: string; kind: string }>('select id, client_id, status, number, kind from portal.documents where id = $1', [s(f, 'id')])
  if (!d || !(await seesClient(c, d.client_id))) return { error: 'Нет прав' }
  const to = s(f, 'to')
  if (to === 'sent' && d.status === 'draft') await q(`update portal.documents set status = 'sent', sent_at = now() where id = $1`, [d.id])
  else if (to === 'void' && ['draft', 'sent'].includes(d.status)) await q(`update portal.documents set status = 'void' where id = $1`, [d.id])
  else if (to === 'signed' && d.status === 'sent') {
    const file = f.get('file')
    if (!isFile(file)) return { error: t(c.lang, 'Загрузите подписанную копию') }
    let fid: string
    try { fid = await storeFile(file, c.user.id, { exts: ['pdf', 'jpg', 'jpeg', 'png', 'heic'] }) } catch { return { error: t(c.lang, 'Подписанная копия — PDF или фото до 25 МБ') } }
    await q(`update portal.documents set status = 'signed', signed_at = now(), signed_file_id = $2 where id = $1`, [d.id, fid])
    await q(`insert into portal.client_documents (client_id, file_id, kind, note, internal, created_by) values ($1,$2,$3,$4,false,$5)`, [d.client_id, fid, d.kind === 'booking_offer' ? 'booking' : 'contract', d.number + ' · подписан', c.user.id])
  } else return { error: t(c.lang, 'Так нельзя изменить статус') }
  await q(`insert into portal.activities (client_id, user_id, kind, text, vars) values ($1,$2,'system','Документ {n}: {s}',$3)`, [d.client_id, c.user.id, { n: d.number, s: to }])
  await log(c, 'document.' + to, 'document', d.id)
  revalidatePath(`/clients/${d.client_id}`)
  return { ok: true }
}

// Акт вознаграждения из «Финансов» (М4 + М8): документ по сделке акта, язык — интерфейса партнёра
export async function actDocument(_: unknown, f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'finance'].includes(c.user.role)) return { error: 'Нет прав' }
  const a = await one<{ id: string; client_id: string; booking_id: string; locale: string }>(`select ca.id, d.client_id, d.booking_id, u.locale from portal.commission_acts ca join portal.deals d on d.id = ca.deal_id join portal.users u on u.id = ca.agent_id where ca.id = $1`, [s(f, 'id')])
  if (!a?.booking_id) return { error: 'Нет прав' }
  try {
    const d = await createDocument('commission_act', (LANGS.includes(a.locale as Lang) ? a.locale : 'en') as Lang, { clientId: a.client_id, bookingId: a.booking_id }, c.user.id)
    await q('update portal.commission_acts set document_id = $2 where id = $1', [a.id, d.id])
    await log(c, 'document.create', 'document', d.id, { kind: 'commission_act', number: d.number })
    revalidatePath('/finance')
    return { ok: true }
  } catch (e: any) {
    return { error: String(e?.message) === 'template' ? t(c.lang, 'Нет шаблона для этого вида документа — загрузите его в «Шаблоны документов»') : t(c.lang, 'Документ не создан: {e}', { e: String(e?.message || '').slice(0, 80) }) }
  }
}
export async function payActNow(f: FormData) {
  const c = await writeCtx()
  if (!['owner', 'finance'].includes(c.user.role)) return
  const a = await one<{ deal_id: string }>(`select deal_id from portal.commission_acts where id = $1 and status = 'due'`, [s(f, 'id')])
  if (!a) return
  // выплата акта = стадия сделки «выплачено агенту»; вычет возвратов — в payAct
  await q(`update portal.deals set stage = 'paid_out', paid_pct = 100, paid_out_at = current_date where id = $1`, [a.deal_id])
  await syncAct(a.deal_id)
  const ag = await one<{ agent_id: string }>('select agent_id from portal.commission_acts where id = $1', [s(f, 'id')])
  if (ag) await notify(ag.agent_id, 'payout', 'Комиссия выплачена', '/commission')
  await log(c, 'act.pay', 'commission_act', s(f, 'id'))
  revalidatePath('/finance')
}
