import crypto from 'node:crypto'
// Общие правила приёма заявок: секрет в адресе (LEADS_SECRET), разрешённые сайты для браузерных форм (LEADS_ORIGINS через запятую)
export function secretOk(secret: string) {
  const want = process.env.LEADS_SECRET || ''
  if (!want || secret.length !== want.length) return false
  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(want))
}
export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  const ok = (process.env.LEADS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(origin)
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {}
}
export async function body(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await req.json().catch(() => ({}))) || {}
  const f = await req.formData().catch(() => null)
  return f ? Object.fromEntries(Array.from(f.entries()).map(([k, v]) => [k, String(v)])) : {}
}
