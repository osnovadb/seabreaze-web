'use server'
// 2.2 · KYC и KYB: покупатели (созаёмщики, компания), документы по покупателю, загрузка клиентом по защищённой ссылке
import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { q, one, audit, notify } from './db'
import { requireCtx } from './auth'
import { isExternal } from './perm'
import { storeFile, isFile } from './files'
import { pushDeal } from './b24sync'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const DOCS = ['passport', 'address', 'funds', 'registry', 'ubo', 'director']
async function canEdit(clientId: string) {
  const c = await requireCtx()
  if (c.impersonating) throw new Error('read-only')
  const cl = await one<{ owner_id: string; agency_id: string | null; kyc_status: string }>('select owner_id, agency_id, kyc_status from portal.clients where id = $1', [clientId])
  if (!cl) throw new Error('client')
  const ok = ['owner', 'market_head', 'seller', 'office'].includes(c.user.role) || cl.owner_id === c.user.id || (c.user.role === 'agency_head' && cl.agency_id === c.user.agency_id)
  if (!ok) throw new Error('forbidden')
  return { c, cl }
}

export async function addBuyer(f: FormData) {
  const id = s(f, 'client')
  const { c, cl } = await canEdit(id)
  if (cl.kyc_status === 'pending') return
  const kind = s(f, 'kind') === 'company' ? 'company' : 'person'
  if (!s(f, 'name')) return
  await q(`insert into portal.buyers (client_id, kind, name, citizenship, tax_residence, pep, reg_no, ubo, share_pct) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, kind, s(f, 'name'), s(f, 'citizenship') || null, s(f, 'tax_residence') || null, s(f, 'pep') === '' ? null : s(f, 'pep') === 'yes', s(f, 'reg_no') || null, s(f, 'ubo') || null, s(f, 'share') ? Number(s(f, 'share')) : null])
  await audit(c.real.id, 'buyer.add', 'client', id, { kind })
  await pushDeal(id) // Co-buyers / Buyer company в сделку
  revalidatePath(`/clients/${id}`)
}
export async function removeBuyer(f: FormData) {
  const b = await one<{ client_id: string }>('select client_id from portal.buyers where id = $1', [s(f, 'id')])
  if (!b) return
  const { c, cl } = await canEdit(b.client_id)
  if (cl.kyc_status === 'pending') return
  await q('delete from portal.buyers where id = $1', [s(f, 'id')])
  await audit(c.real.id, 'buyer.remove', 'client', b.client_id)
  await pushDeal(b.client_id)
  revalidatePath(`/clients/${b.client_id}`)
}
export async function uploadBuyerDoc(_: unknown, f: FormData) {
  const id = s(f, 'client')
  const { c } = await canEdit(id)
  const file = f.get('file')
  if (!isFile(file)) return { error: 'Выберите файл' }
  const kind = DOCS.includes(s(f, 'kind')) ? s(f, 'kind') : 'other'
  const buyer = s(f, 'buyer') || null
  if (buyer && !(await one('select 1 from portal.buyers where id = $1 and client_id = $2', [buyer, id]))) return { error: 'Нет прав' }
  let fid: string
  try { fid = await storeFile(file, c.user.id) } catch { return { error: 'Файл: PDF или фото, до 25 МБ' } }
  await q(`insert into portal.client_documents (client_id, buyer_id, file_id, kind, created_by) values ($1,$2,$3,$4,$5)`, [id, buyer, fid, kind, c.user.id])
  await audit(c.real.id, 'client.document', 'client', id, { kind, buyer: !!buyer }, isExternal(c.user.role) ? c.user.id : null)
  revalidatePath(`/clients/${id}`)
  return { ok: true }
}
// Ссылка клиенту для загрузки документов (П9): без входа, только загрузка — посмотреть уже загруженное по ссылке нельзя
export async function kycLink(f: FormData) {
  const id = s(f, 'client')
  const { c } = await canEdit(id)
  await q(`update portal.clients set kyc_token = coalesce(kyc_token, $2) where id = $1`, [id, crypto.randomBytes(12).toString('base64url')])
  await audit(c.real.id, 'kyc.link', 'client', id)
  revalidatePath(`/clients/${id}`)
}
export async function clientKycUpload(_: unknown, f: FormData) {
  const cl = await one<{ id: string; owner_id: string; name: string; kyc_status: string }>('select id, owner_id, name, kyc_status from portal.clients where kyc_token = $1 and anonymized_at is null', [s(f, 'token')])
  if (!cl) return { error: 'Ссылка больше не действует' }
  if (['pending', 'passed', 'compliance'].includes(cl.kyc_status)) return { error: 'Документы уже на проверке — если нужно что-то добавить, напишите вашему менеджеру' }
  const kind = DOCS.includes(s(f, 'kind')) ? s(f, 'kind') : 'other'
  const buyer = s(f, 'buyer') || null
  if (buyer && !(await one('select 1 from portal.buyers where id = $1 and client_id = $2', [buyer, cl.id]))) return { error: 'Ссылка больше не действует' }
  const files = f.getAll('file').filter(isFile)
  if (!files.length) return { error: 'Выберите файл' }
  if (files.length > 5) return { error: 'Не больше 5 файлов за раз' }
  for (const file of files) {
    let fid: string
    try { fid = await storeFile(file, null, { exts: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp'], max: 15 * 1024 * 1024 }) } catch { return { error: 'Файл: PDF или фото, до 15 МБ' } }
    await q(`insert into portal.client_documents (client_id, buyer_id, file_id, kind, note) values ($1,$2,$3,$4,'загружено клиентом по ссылке')`, [cl.id, buyer, fid, kind])
  }
  await q(`insert into portal.activities (client_id, kind, text, vars) values ($1,'system','Клиент загрузил документы по ссылке: {n}',$2)`, [cl.id, JSON.stringify({ n: files.length })])
  await notify(cl.owner_id, 'kyc', 'Клиент {c} загрузил документы для KYC', `/clients/${cl.id}`, { c: cl.name })
  return { ok: true }
}
export async function uploadBuyerDocPlain(f: FormData) { await uploadBuyerDoc(null, f) }
