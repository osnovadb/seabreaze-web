import { requireCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { planFact, monthly, canSeePlanFact, type PeriodKind } from '@/lib/planfact'
import { makeXlsx } from '@/lib/xlsx'

// Выгрузка плана и факта (М10) в xlsx: листы по рынкам, менеджерам, агентствам и помесячно
export async function GET(req: Request) {
  const c = await requireCtx()
  if (!canSeePlanFact(c.user.role)) return new Response('forbidden', { status: 403 })
  const T = (s: string) => t(c.lang, s)
  const u = new URL(req.url)
  const kind: PeriodKind = u.searchParams.get('kind') === 'quarter' ? 'quarter' : 'month'
  const { period, lines } = await planFact(c.user, kind, u.searchParams.get('p') || undefined)
  const head = ['', T('План, штук'), T('Факт, штук'), T('План, м²'), T('Факт, м²'), T('План, объём USD'), T('Факт, объём USD'), T('План, доход USD'), T('Факт, доход USD')]
  const sheet = (name: string, rows: typeof lines.market) => ({ name, rows: [head, ...rows.map((l) => [l.name, l.plan?.units ?? null, l.fact.units, l.plan?.area ?? null, Math.round(l.fact.area * 100) / 100, l.plan?.revenue ?? null, Math.round(l.fact.revenue), l.plan?.commission ?? null, Math.round(l.fact.commission)])] })
  const m = await monthly(c.user)
  const buf = makeXlsx([
    sheet(T('Рынки'), lines.market), sheet(T('Менеджеры'), lines.user), sheet(T('Агентства'), lines.agency),
    { name: T('Помесячно'), rows: [[T('Месяц'), T('Штук'), T('Площадь, м²'), T('Объём продаж'), T('Наш доход')], ...m.map((r) => [r.month, r.units, Math.round(r.area * 100) / 100, Math.round(r.revenue), Math.round(r.commission)])] },
  ])
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="plan-fact-${period.key}.xlsx"` } })
}
