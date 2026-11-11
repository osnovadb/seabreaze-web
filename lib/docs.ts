// Документы из шаблонов (М8): шаблон docx с переменными вида {unit.number} → docx и PDF клиента.
// Переменные — только из словаря VARS: при загрузке шаблона неизвестная переменная — ошибка с её именем.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { q, one, tx } from './db'
import { num, date, bakuYear, t, type Lang } from './i18n'
import { planLabel } from './plans'
import { roomsSql } from './catalog'

export const DOC_KINDS = ['booking_offer', 'fixation_act', 'commission_act'] as const
export type DocKind = (typeof DOC_KINDS)[number]
export const DOC_KIND_NAMES: Record<DocKind, string> = { booking_offer: 'Оферта брони', fixation_act: 'Акт фиксации клиента', commission_act: 'Акт вознаграждения' }
export const canEditTemplates = (role: string) => role === 'owner' || role === 'content'
const PREFIX: Record<DocKind, string> = { booking_offer: 'OF', fixation_act: 'FX', commission_act: 'AV' }

// Словарь переменных: имя → описание (для экрана шаблонов). Группы booking.* и fixation.* есть только у своих видов документов.
export const VARS: Record<string, string> = {
  'doc.number': 'номер документа', 'doc.date': 'дата документа', 'doc.city': 'город',
  'client.name': 'имя клиента', 'client.reg_no': 'номер клиента в портале', 'client.email': 'e-mail клиента', 'client.phone': 'телефон клиента',
  'client.country': 'страна клиента', 'client.citizenship': 'гражданство', 'client.tax_residence': 'налоговое резидентство',
  'agent.name': 'кто ведёт клиента', 'agent.email': 'e-mail ведущего', 'agent.company': 'агентство',
  'project.name': 'проект', 'project.developer': 'застройщик', 'project.city': 'город проекта',
  'unit.number': 'номер квартиры', 'unit.block': 'блок', 'unit.floor': 'этаж', 'unit.rooms': 'комнат (как на сайтах: спальни + 1)', 'unit.area': 'площадь, м²',
  'booking.price_list': 'прайс застройщика', 'booking.plan_discount': 'скидка за 100% (сумма)', 'booking.promo': 'акция (название и сумма)', 'booking.discount_pct': 'скидка, %', 'booking.discount': 'скидка, сумма',
  'booking.final': 'итоговая цена', 'booking.options': 'опции (список с ценами)', 'booking.options_total': 'опции, сумма', 'booking.total': 'итого с опциями', 'booking.fee': 'взнос за платную бронь', 'booking.currency': 'валюта', 'booking.plan': 'план оплаты', 'booking.starts_at': 'дата брони', 'booking.ends_at': 'бронь до', 'booking.days': 'срок брони, дней',
  'act.amount': 'комиссия по акту', 'act.deducted': 'удержано в счёт возвратов', 'act.net': 'к выплате по акту',
  'fixation.sent_at': 'дата отправки на фиксацию', 'fixation.decided_at': 'дата решения застройщика', 'fixation.protected_until': 'клиент закреплён до',
}
// Переменные брони и квартиры есть только у документов по брони, фиксации — только у акта фиксации
export const varAllowed = (kind: DocKind, v: string) => (v.startsWith('act.') ? kind === 'commission_act' : v.startsWith('booking.') || v.startsWith('unit.') ? kind !== 'fixation_act' : v.startsWith('fixation.') ? kind === 'fixation_act' : true)

// Шаблон: проверить переменные. Возвращает найденные имена или бросает Error('vars:<имена>')
export function inspectTemplate(buf: Buffer): string[] {
  const seen = new Set<string>()
  const doc = new Docxtemplater(new PizZip(buf), {
    paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' },
    parser: (tag: string) => { seen.add(tag.trim()); return { get: () => '' } },
  })
  doc.render({})
  const bad = Array.from(seen).filter((v) => !VARS[v])
  if (bad.length) throw new Error('vars:' + bad.join(', '))
  return Array.from(seen)
}
function render(buf: Buffer, vars: Record<string, string>) {
  const doc = new Docxtemplater(new PizZip(buf), {
    paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' },
    // пустое значение — прочерк, чтобы в документе не оставалось «Акция: .»
    parser: (tag: string) => ({ get: () => vars[tag.trim()] || '—' }),
    nullGetter: () => '',
  })
  doc.render({})
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

// docx → PDF через LibreOffice; у каждого вызова свой профиль, чтобы параллельные конвертации не мешали друг другу.
// Нет soffice (локальная разработка) — null, документ остаётся только в docx.
async function toPdf(docx: Buffer): Promise<Buffer | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ge-doc-'))
  try {
    const src = path.join(dir, 'doc.docx')
    await fs.writeFile(src, docx)
    await new Promise<void>((res, rej) => execFile('soffice', ['-env:UserInstallation=file://' + path.join(dir, 'profile'), '--headless', '--convert-to', 'pdf', '--outdir', dir, src],
      { timeout: 90_000, env: { ...process.env, HOME: dir } }, (e) => (e ? rej(e) : res())))
    return await fs.readFile(path.join(dir, 'doc.pdf'))
  } catch { return null } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
async function saveFile(buf: Buffer, filename: string, mime: string, userId: string, t?: { query: (sql: string, p: unknown[]) => Promise<unknown> }) {
  const id = crypto.randomUUID(), ext = filename.split('.').pop()
  await fs.writeFile(path.join(process.env.FILES_DIR || './dev-files', `${id}.${ext}`), buf, { mode: 0o640 })
  const sql = `insert into portal.files (id, filename, mime, size, disk_name, created_by) values ($1,$2,$3,$4,$5,$6)`, p = [id, filename, mime, buf.length, `${id}.${ext}`, userId]
  if (t) await t.query(sql, p); else await q(sql, p)
  return id
}
export async function readFileBuf(fileId: string) {
  const f = await one<{ disk_name: string }>('select disk_name from portal.files where id = $1', [fileId])
  if (!f) throw new Error('file')
  return fs.readFile(path.join(process.env.FILES_DIR || './dev-files', f.disk_name))
}

const money = (lang: Lang, n: number | null | undefined) => (n == null ? '' : num(lang, Math.round(Number(n))))
// Данные документа: клиент и ведущий + бронь (оферта, акт вознаграждения) или фиксация (акт фиксации)
async function collect(kind: DocKind, lang: Lang, src: { clientId: string; bookingId?: string; projectId?: string }) {
  const cl = await one<any>(`select cl.*, u.name agent_name, u.email agent_email, a.name agency from portal.clients cl join portal.users u on u.id = cl.owner_id left join portal.agencies a on a.id = cl.agency_id where cl.id = $1`, [src.clientId])
  if (!cl) throw new Error('client')
  const v: Record<string, string> = {
    'doc.city': lang === 'ru' ? 'Баку' : lang === 'he' ? 'באקו' : 'Baku',
    'client.name': cl.name, 'client.reg_no': cl.reg_no, 'client.email': cl.email || '', 'client.phone': cl.phone || '', 'client.country': cl.country || '',
    'client.citizenship': cl.kyc_citizenship || '', 'client.tax_residence': cl.kyc_tax_residence || '',
    'agent.name': cl.agent_name, 'agent.email': cl.agent_email, 'agent.company': cl.agency || 'GetsEstate',
  }
  let projectId = src.projectId, bookingId: string | null = null
  if (kind === 'booking_offer' || kind === 'commission_act') {
    const b = await one<any>(`select b.*, un.number, un.floor, ${roomsSql.replace(/\bu\./g, 'un.')} rooms, un.area_total_m2::float area, coalesce(bl.external_id, bl.name) block
      from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id where b.id = $1 and b.client_id = $2`, [src.bookingId, src.clientId])
    if (!b) throw new Error('booking')
    projectId = b.project_id; bookingId = b.id
    const promo = b.snapshot?.promo, plan = b.snapshot?.plan
    const list0 = Number(b.snapshot?.list_original ?? b.price_list)
    Object.assign(v, {
      'unit.number': b.number, 'unit.block': b.block, 'unit.floor': String(b.floor), 'unit.rooms': b.rooms == null ? '' : String(b.rooms), 'unit.area': num(lang, b.area, 2),
      // скидка за 100% = прайс − акция − цена брони до скидки из пула (цена брони уже после неё и акции)
      'booking.price_list': money(lang, list0), 'booking.plan_discount': money(lang, Math.max(0, list0 - Number(promo?.amount || 0) - Number(b.price_list))), 'booking.promo': promo ? `${promo.name} (−${money(lang, promo.amount)})` : '',
      'booking.discount_pct': num(lang, Number(b.discount_pct), Number(b.discount_pct) % 1 ? 1 : 0), 'booking.discount': money(lang, Number(b.price_list) - Number(b.final_price)),
      'booking.final': money(lang, b.final_price), 'booking.currency': 'USD', 'booking.plan': planLabel((x, vv) => t(lang, x, vv), plan?.name, plan ? { down_payment_pct: plan.down, months: plan.months } : null),
      'booking.options': (b.options || []).map((o: { title: string; usd: number }) => `${o.title} — ${money(lang, o.usd)}`).join('; '), 'booking.options_total': money(lang, Number(b.options_usd || 0)), 'booking.total': money(lang, Number(b.final_price) + Number(b.options_usd || 0)), 'booking.fee': Number(b.fee_amount) ? `${b.fee_currency} ${num(lang, Number(b.fee_amount))}` : '',
      'booking.starts_at': date(lang, b.starts_at), 'booking.ends_at': date(lang, b.ends_at), 'booking.days': String(b.snapshot?.booking_days ?? ''),
    })
  }
  if (kind === 'commission_act') {
    const a = await one<{ amount: number; deducted: number }>('select ca.amount::float, ca.deducted::float from portal.commission_acts ca join portal.deals d on d.id = ca.deal_id where d.booking_id = $1', [src.bookingId])
    if (a) Object.assign(v, { 'act.amount': money(lang, a.amount), 'act.deducted': money(lang, a.deducted), 'act.net': money(lang, a.amount - a.deducted) })
  }
  if (kind === 'fixation_act') {
    const fx = await one<any>('select * from portal.fixations where client_id = $1 and project_id = $2', [src.clientId, src.projectId])
    if (!fx) throw new Error('fixation')
    Object.assign(v, { 'fixation.sent_at': date(lang, fx.sent_at), 'fixation.decided_at': date(lang, fx.decided_at), 'fixation.protected_until': date(lang, fx.protected_until) })
  }
  const p = await one<any>('select p.name, p.city, d.name developer from projects p left join developers d on d.id = p.developer_id where p.id = $1', [projectId])
  Object.assign(v, { 'project.name': p?.name || '', 'project.developer': p?.developer || '', 'project.city': p?.city || '' })
  return { v, projectId: projectId || null, bookingId }
}

// Создать документ: номер по счётчику, docx из активного шаблона языка (нет — английский), PDF, запись в документах клиента
export async function createDocument(kind: DocKind, langWanted: Lang, src: { clientId: string; bookingId?: string; projectId?: string }, userId: string) {
  const tpl = await one<{ id: string; file_id: string; lang: Lang; vars: string[] }>(`select id, file_id, lang, vars from portal.doc_templates where kind = $1 and active and lang = any($2) order by lang = $3 desc limit 1`, [kind, [langWanted, 'en'], langWanted])
  if (!tpl) throw new Error('template')
  const lang = tpl.lang
  const { v, projectId, bookingId } = await collect(kind, lang, src)
  // в иврите телефон и e-mail — изолированным LTR-фрагментом, иначе цифры переставляются в RTL-абзаце
  if (lang === 'he') for (const k of ['client.phone', 'client.email', 'agent.email']) if (v[k]) v[k] = '\u2066' + v[k] + '\u2069'
  const tplBuf = await readFileBuf(tpl.file_id)
  const year = bakuYear()
  const docKind = kind === 'booking_offer' ? 'booking' : kind === 'fixation_act' ? 'other' : null
  // Номер берётся в той же транзакции, что и запись документа: ошибка сборки откатывает счётчик, дыр в нумерации нет
  return tx(async (t) => {
    const n = (await t.query(`insert into portal.doc_numbers (kind, year, last) values ($1, $2, 1) on conflict (kind, year) do update set last = doc_numbers.last + 1 returning last`, [kind, year])).rows[0]
    const number = `${PREFIX[kind]}-${year}-${String(n.last).padStart(4, '0')}`
    v['doc.number'] = number
    v['doc.date'] = date(lang, new Date())
    const docx = render(tplBuf, v)
    const pdf = await toPdf(docx)
    const base = `${number} ${v['client.name']}`.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80)
    const docxId = await saveFile(docx, base + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', userId, t)
    const pdfId = pdf ? await saveFile(pdf, base + '.pdf', 'application/pdf', userId, t) : null
    const d = (await t.query(`insert into portal.documents (template_id, kind, number, lang, client_id, booking_id, project_id, docx_file_id, pdf_file_id, data, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`, [tpl.id, kind, number, lang, src.clientId, bookingId, projectId, docxId, pdfId, v, userId])).rows[0]
    // Файлы оферты и акта фиксации — в документах клиента (права как у клиента). Акт вознаграждения — нет:
    // в нём комиссия партнёра, его видят только финансы, владелец и сам партнёр (правило в /files)
    if (docKind) for (const fid of [pdfId, docxId].filter(Boolean)) await t.query(`insert into portal.client_documents (client_id, file_id, kind, note, internal, created_by) values ($1,$2,$3,$4,false,$5)`, [src.clientId, fid, docKind, number, userId])
    return { id: d.id as string, number, pdf: !!pdfId }
  })
}
