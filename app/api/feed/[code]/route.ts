// 2.2 · §6 П8 Белый фид для сайта агентства: проекты без нашего бренда и без точных цен; заявки шлите на страницу ссылки
import { NextResponse } from 'next/server'
import { linkPage } from '@/lib/partnerPage'

export const dynamic = 'force-dynamic'
export async function GET(_: Request, props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  const p = await linkPage(params.code)
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  return NextResponse.json({
    updated_at: new Date().toISOString(), currency: 'USD', lead_form: `${base}/r/${p.code}`,
    projects: p.projects.map((x) => ({ name: x.name, developer: x.developer, city: x.city, delivery: x.delivery, units_available: x.free, price_from: x.from_usd, lead_form: `${base}/r/${p.code}?project=${encodeURIComponent(x.slug)}` })),
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=900', 'X-Robots-Tag': 'noindex' } })
}
