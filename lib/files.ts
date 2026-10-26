// Файлы портала: материалы и документы проектов, документы клиентов. Диск — FILES_DIR, в базе — portal.files.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { one } from './db'

export const MAX_FILE = 25 * 1024 * 1024
const OK_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp4', 'mov', 'heic']

// userId = null — загрузка без входа (документы к заявке партнёра): там свои, более узкие типы и размер
export async function storeFile(file: File, userId: string | null, opts?: { exts?: string[]; max?: number }) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!(opts?.exts || OK_EXT).includes(ext)) throw new Error('type')
  if (file.size > (opts?.max || MAX_FILE)) throw new Error('size')
  const id = crypto.randomUUID()
  const disk = `${id}.${ext}`
  await fs.writeFile(path.join(process.env.FILES_DIR || './dev-files', disk), Buffer.from(await file.arrayBuffer()), { mode: 0o640 })
  await one(`insert into portal.files (id, filename, mime, size, disk_name, created_by) values ($1,$2,$3,$4,$5,$6)`, [id, file.name, file.type || 'application/octet-stream', file.size, disk, userId])
  return id
}
export const isFile = (v: FormDataEntryValue | null): v is File => !!v && typeof v === 'object' && (v as File).size > 0
export const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
