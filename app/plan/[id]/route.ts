import fs from 'node:fs'
import path from 'node:path'
import { one } from '@/lib/db'

// План квартиры: файл из хранилища Directus (uploads) по id файла
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new Response('bad id', { status: 400 })
  const f = await one<{ filename_disk: string; type: string }>('select filename_disk, type from directus_files where id = $1', [params.id])
  if (!f) return new Response('not found', { status: 404 })
  const p = path.join(process.env.UPLOADS_DIR || '', path.basename(f.filename_disk))
  if (!fs.existsSync(p)) return new Response('missing', { status: 404 })
  return new Response(fs.readFileSync(p), { headers: { 'Content-Type': f.type || 'image/png', 'Cache-Control': 'public, max-age=86400' } })
}
