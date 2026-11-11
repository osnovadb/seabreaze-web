// 2.2 · §7 Регистрации в xlsx (запрос Дениса 09.11): тот же фильтр, что на экране.
// kind=dev — файл застройщику: только данные клиента и наш номер, по листу на проект; ничего о партнёрах и внутренних сроках.
// kind=full — рабочий список офиса со всеми колонками. Каждая выгрузка — в журнал (что и кому ушло — довод в споре «кто первым»).
import { NextResponse } from 'next/server'
import { requireCtx } from '@/lib/auth'
import { audit } from '@/lib/db'
import { makeXlsx } from '@/lib/xlsx'
import { loadRegistrations, groupOf, type RegParams } from '@/lib/regFilter'
import { REG_ST } from '@/lib/stages'
import { t } from '@/lib/i18n'

export const dynamic = 'force-dynamic'
const H: Record<string, { title: string; dev: string; date: string; cols: string[] }> = {
  ru: { title: 'GetsEstate — регистрация клиентов', dev: 'Застройщик', date: 'Дата', cols: ['№', 'Рег. номер GetsEstate', 'Клиент (имя, фамилия)', 'Телефон', 'E-mail', 'Страна', 'Проект', 'Агентство'] },
  en: { title: 'GetsEstate — client registration', dev: 'Developer', date: 'Date', cols: ['No.', 'GetsEstate reg. no.', 'Client (full name)', 'Phone', 'E-mail', 'Country', 'Project', 'Agency'] },
  az: { title: 'GetsEstate — müştərilərin qeydiyyatı', dev: 'Tikinti şirkəti', date: 'Tarix', cols: ['№', 'GetsEstate qeydiyyat nömrəsi', 'Müştəri (ad, soyad)', 'Telefon', 'E-poçt', 'Ölkə', 'Layihə', 'Agentlik'] },
}
const day = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (s: string | null) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '')

export async function GET(req: Request) {
  const c = await requireCtx()
  if (!['owner', 'office', 'finance', 'market_head'].includes(c.user.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const u = new URL(req.url).searchParams
  const sp = Object.fromEntries(['f', 'd', 'p', 'm', 'src', 's', 'from', 'to', 'by', 'flag', 'cons', 'ids'].map((k) => [k, u.get(k) || undefined])) as RegParams
  const today = day(new Date())
  let rows = await loadRegistrations(sp, c.user)
  if (!sp.ids) rows = rows.filter((r) => groupOf(r, today)[sp.f || 'today'] ?? true)
  const kind = u.get('kind') === 'full' ? 'full' : 'dev'
  if (kind === 'dev') rows = rows.filter((r) => !r.anonymized && r.consent_status === 'given') // удалённые по запросу и без согласия клиента (313) — никогда застройщику
  const lang = ['ru', 'en', 'az'].includes(u.get('lang') || '') ? u.get('lang')! : 'ru'
  let buf: Buffer, name: string
  if (kind === 'dev') {
    const h = H[lang]
    const byProject = new Map<string, typeof rows>()
    for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) || []), r])
    const sheets = Array.from(byProject.values()).map((list) => ({
      name: list[0].project, head: 4,
      rows: [[h.title], [`${h.dev}: ${list[0].developer} · ${list[0].project}`], [`${h.date}: ${fmt(today)}`], [], h.cols,
        ...list.map((r, i) => [i + 1, r.reg_no, r.client, r.phone || '', r.email || '', r.country || '', r.project, 'GetsEstate'])],
    }))
    buf = makeXlsx(sheets.length ? sheets : [{ name: 'Registrations', rows: [H[lang].cols] }])
    const one = new Set(rows.map((r) => r.developer)).size === 1 ? rows[0].developer.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') : 'developers'
    name = `GetsEstate-registration-${one}-${today}.xlsx`
  } else {
    const L = c.lang, T = (s: string) => t(L, s)
    const head = ['Рег. номер', 'Клиент', 'Телефон', 'E-mail', 'Страна', 'Рынок', 'Застройщик', 'Проект', 'Статус', 'Источник', 'Партнёр', 'Агентство', 'Согласие клиента', 'Вне очереди', 'Массовая', 'В очереди с', 'Передать до', 'Отправлено', 'Ответ до', 'Решение', 'Действует до', 'Причина отказа'].map(T)
    buf = makeXlsx([{ name: 'Registrations', rows: [head, ...rows.map((r) => [r.reg_no, r.client, r.phone || '', r.email || '', r.country || '', r.market || '', r.developer, r.project, T(REG_ST[r.status]?.[0] || r.status),
      T(r.owner_type === 'partner' ? 'партнёр' : r.owner_type === 'referrer' ? 'рекомендатель' : 'команда'), r.owner_type === 'team' ? '' : r.owner, r.agency || '', T(r.consent_status === 'given' ? 'есть' : 'нет'),
      r.priority ? '✓' : '', r.mass ? '✓' : '', fmt(r.created_at), fmt(r.due_send), fmt(r.sent_at), fmt(r.answer_due), fmt(r.decided_at), fmt(r.valid_until), r.reject_reason || ''])] }])
    name = `registrations-${today}.xlsx`
  }
  await audit(c.real.id, 'registration.export', 'registration', rows[0]?.id, { kind, lang, n: rows.length, ids: rows.slice(0, 500).map((r) => r.id) })
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}` } })
}
