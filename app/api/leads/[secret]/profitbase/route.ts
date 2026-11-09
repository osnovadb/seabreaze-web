import { ingestLead } from '@/lib/leads'
import { secretOk, body } from '../../common'

// Вебхук смарт-каталога Profitbase (М5). Формат в документации API не описан — берём поля по распространённым именам,
// сырой запрос сохраняется целиком (inbound_leads.payload), чтобы подогнать разбор по первой реальной заявке.
const pick = (o: any, keys: string[]): string => { for (const k of keys) { const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (v != null && v !== '') return String(v) } return '' }
export async function POST(req: Request, props: { params: Promise<{ secret: string }> }) {
  const params = await props.params;
  if (!secretOk(params.secret)) return Response.json({ ok: false }, { status: 404 })
  const b = await body(req)
  const r = await ingestLead('smart_catalog', {
    name: pick(b, ['name', 'fio', 'client.name', 'contact.name', 'data.name']),
    phone: pick(b, ['phone', 'client.phone', 'contact.phone', 'data.phone']),
    email: pick(b, ['email', 'client.email', 'contact.email', 'data.email']),
    comment: [pick(b, ['comment', 'message', 'data.comment']), pick(b, ['property.number', 'propertyNumber', 'property_id', 'propertyId']) && 'Profitbase: ' + pick(b, ['property.number', 'propertyNumber', 'property_id', 'propertyId'])].filter(Boolean).join('\n'),
    lang: pick(b, ['lang', 'language']), site: 'profitbase', consent: { text: 'Smart catalog Profitbase' },
  }, b).catch((e) => { console.error('pb lead', e); return null })
  return Response.json({ ok: !!r }, { status: r ? 200 : 500 })
}
