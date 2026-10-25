import fs from 'node:fs'
import path from 'node:path'
import { one } from '@/lib/db'
import { getCtx } from '@/lib/auth'
import { isExternal } from '@/lib/perm'
import { projectVisible } from '@/lib/catalog'
import { clientScope } from '@/lib/scope'

// Отдача файла с проверкой прав: файл проекта — если проект виден и аудитория подходит; документ клиента — если клиент в зоне видимости.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new Response('bad id', { status: 400 })
  const c = await getCtx()
  if (!c) return new Response('unauthorized', { status: 401 })
  const f = await one<{ filename: string; mime: string; disk_name: string }>('select filename, mime, disk_name from portal.files where id = $1', [params.id])
  if (!f) return new Response('not found', { status: 404 })
  const ext = isExternal(c.user.role)
  let ok = false
  const pf = await one<{ project_id: string; audience: string }>('select project_id, audience from portal.project_files where file_id = $1', [params.id])
  if (pf) ok = !ext || (pf.audience !== 'team' && (await projectVisible(pf.project_id, c.user)))
  const cd = await one<{ client_id: string; internal: boolean }>('select client_id, internal from portal.client_documents where file_id = $1', [params.id])
  if (cd && !(ext && cd.internal)) {
    const cs = clientScope(c.user)
    ok = !!(await one(`select 1 from portal.clients cl where cl.id = $${cs.params.length + 1} and ${cs.sql}`, [...cs.params, cd.client_id]))
  }
  // Картинки разметки (генплан, фасады, поэтажные планы) — тем, кому виден проект
  if (!ok) {
    const img = await one<{ project_id: string }>(`select project_id from portal.genplans where file_id = $1
      union all select b.project_id from portal.facades f join buildings b on b.id = f.building_id where f.file_id = $1
      union all select b.project_id from portal.floor_plans f join buildings b on b.id = f.building_id where f.file_id = $1 limit 1`, [params.id])
    if (img) ok = !ext || (await projectVisible(img.project_id, c.user))
  }
  if (!ok) return new Response('forbidden', { status: 404 })
  const p = path.join(process.env.FILES_DIR || './dev-files', path.basename(f.disk_name))
  if (!fs.existsSync(p)) return new Response('missing', { status: 404 })
  const inline = /^(image\/|application\/pdf|video\/)/.test(f.mime)
  return new Response(fs.readFileSync(p), { headers: {
    'Content-Type': f.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
  } })
}
