// QA 2.2 · 14 Обход по ссылкам под каждой ролью: ни одной 500 и ни одного экрана ошибки (до 120 страниц на роль)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { user, agency, register, freeUnit, close, page, act, q } from './h.mjs'

after(close)
const SKIP = /\/(api|files|plan|s|r|c|k|l|set-password|show|dev)\/|logout|\.xlsx|export|\/b24(\/|$)|#/
async function crawl(u, start, limit = 120) {
  const seen = new Set(), bad = [], queue = [...start]
  while (queue.length && seen.size < limit) {
    const p = queue.shift()
    if (seen.has(p)) continue
    seen.add(p)
    const r = await page(u, p)
    if (r.status >= 500 || /Что-то пошло не так|Something went wrong|Application error/i.test(r.html)) bad.push(`${p} → ${r.status}`)
    for (const m of r.html.matchAll(/href="(\/[^"#?]*(?:\?[^"#]*)?)"/g)) {
      const h = m[1].replace(/&amp;/g, '&')
      if (!SKIP.test(h) && !seen.has(h) && queue.length < 600) queue.push(h)
    }
  }
  return { seen: seen.size, bad }
}
const ROLES = ['owner', 'market_head', 'seller', 'office', 'finance', 'content', 'agency_head', 'agent', 'referrer']
for (const role of ROLES) {
  test(`обход: ${role}`, async () => {
    const ag = role === 'agency_head' || role === 'agent' ? await agency('DE') : null
    const u = await user(role, { market: role === 'owner' ? null : 'DE', agency_id: ag?.id })
    if (['seller', 'agency_head', 'agent'].includes(role)) {
      const cl = (await register(u)).result?.id
      if (cl && role !== 'seller') await q(`update portal.clients set attach_status = 'protected', protected_until = current_date + 180 where id = $1`, [cl])
      if (cl) await act(u, 'holdUnit', { unit: (await freeUnit()).id, client: cl })
    }
    const r = await crawl(u, role === 'referrer' ? ['/refer'] : ['/', '/admin', '/finance', '/clients?v=list', '/projects'])
    assert.equal(r.bad.length, 0, `${role}: ошибки на ${r.bad.length} из ${r.seen} страниц:\n` + r.bad.join('\n'))
    console.log(`# ${role}: обойдено ${r.seen} страниц`)
  })
}
