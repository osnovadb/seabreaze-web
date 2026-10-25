'use server'
// Материалы и документы проекта: загружают владелец и роль «Контент» (ТЗ: материалы на 4 языках, права на фото)
import { revalidatePath } from 'next/cache'
import { q, one, audit } from './db'
import { requireCtx } from './auth'
import { t } from './i18n'
import { storeFile, isFile } from './files'

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
async function editor() {
  const c = await requireCtx()
  if (!['owner', 'content'].includes(c.user.role) || (c.impersonating && process.env.ALLOW_IMPERSONATE_WRITE !== '1')) throw new Error('forbidden')
  return c
}

export async function saveProjectFile(_: unknown, f: FormData) {
  const c = await editor()
  const pid = s(f, 'project')
  const kind = ['material', 'document', 'video'].includes(s(f, 'kind')) ? s(f, 'kind') : 'material'
  const lang = ['all', 'ru', 'en', 'de', 'he'].includes(s(f, 'lang')) ? s(f, 'lang') : 'all'
  const audience = ['partner', 'client', 'team'].includes(s(f, 'audience')) ? s(f, 'audience') : 'partner'
  const file = f.get('file'), url = s(f, 'url')
  if (!s(f, 'title')) return { error: t(c.lang, 'Нужно название') }
  if (!isFile(file) && !/^https?:\/\//.test(url)) return { error: t(c.lang, 'Загрузите файл или укажите ссылку') }
  let fileId: string | null = null
  if (isFile(file)) {
    try { fileId = await storeFile(file, c.user.id) } catch (e: any) {
      return { error: t(c.lang, e?.message === 'size' ? 'Файл больше 25 МБ — дайте ссылку на облако' : 'Такой тип файла не поддерживается') }
    }
  }
  await q(`insert into portal.project_files (project_id, kind, title, lang, audience, file_id, url, sort, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [pid, kind, s(f, 'title'), lang, audience, fileId, fileId ? null : url, Number(s(f, 'sort')) || 0, c.user.id])
  await audit(c.real.id, 'content.file_add', 'project', pid, { title: s(f, 'title'), kind }, c.impersonating ? c.user.id : null)
  revalidatePath('/projects', 'layout'); revalidatePath('/materials')
  return { ok: true }
}
export async function deleteProjectFile(f: FormData) {
  const c = await editor()
  const r = await one<{ project_id: string; file_id: string | null }>('delete from portal.project_files where id = $1 returning project_id, file_id', [s(f, 'id')])
  if (r?.file_id) await q('delete from portal.files where id = $1', [r.file_id])
  await audit(c.real.id, 'content.file_delete', 'project', r?.project_id, { id: s(f, 'id') }, c.impersonating ? c.user.id : null)
  revalidatePath('/projects', 'layout'); revalidatePath('/materials')
}
