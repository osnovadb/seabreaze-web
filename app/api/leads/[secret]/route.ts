import { ingestLead } from '@/lib/leads'
import { secretOk, cors, body } from '../common'

// Заявки с форм и квиза сайтов (М5): POST /api/leads/<секрет> — JSON или form-data. Ответ сразу, тяжёлой работы нет.
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: cors(req) }) }
export async function POST(req: Request, { params }: { params: { secret: string } }) {
  const h = cors(req)
  if (!secretOk(params.secret)) return Response.json({ ok: false }, { status: 404, headers: h })
  const b = await body(req)
  if (JSON.stringify(b).length > 20_000) return Response.json({ ok: false, error: 'too large' }, { status: 413, headers: h })
  const src = ['quiz', 'landing'].includes(b.source) ? b.source : 'website'
  const consent = typeof b.consent === 'object' ? b.consent : b.consent === 'true' || b.consent === 'on' || b.consent === true ? { text: b.consent_text, version: b.consent_version, marketing: b.marketing === 'true' || b.marketing === 'on' || b.marketing === true } : null
  const utm = b.utm && typeof b.utm === 'object' ? b.utm : Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].filter((k) => b[k]).map((k) => [k, String(b[k])]))
  try {
    const r = await ingestLead(src, { ...b, utm, consent }, b)
    return Response.json({ ok: r.result !== 'error', id: r.id }, { status: r.result === 'error' ? 422 : 200, headers: h })
  } catch (e) {
    console.error('lead', e)
    return Response.json({ ok: false }, { status: 500, headers: h })
  }
}
