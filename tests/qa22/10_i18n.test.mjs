// QA 2.2 · 10 Языки: экраны партнёра на DE и HE без русских «хвостов» (мягкая проверка — список находок, не падение)
import { test, after } from 'node:test'
import { user, agency, register, close, page, note, findings } from './h.mjs'

after(async () => { if (findings.length) console.log('\nНАХОДКИ i18n:\n' + findings.join('\n')); await close() })
test('кабинет партнёра на DE и HE', async () => {
  for (const locale of ['de', 'he', 'en']) {
    const ag = await agency('DE')
    const H = await user('agency_head', { agency_id: ag.id, locale })
    const cl = (await register(H)).result?.id
    for (const p of ['/', '/clients', '/commission', '/links', '/catalog', '/projects', cl ? `/clients/${cl}` : '/']) {
      const r = await page(H, p)
      const text = r.html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
      const ru = (text.match(/[А-Яа-яЁё][А-Яа-яЁё\s,.«»—-]{6,}/g) || []).filter((s) => !/QA|Client/.test(s)).slice(0, 4)
      if (ru.length) note(`i18n ${locale} ${p.replace(/[0-9a-f-]{36}/, ':id')}`, ru.map((s) => s.trim().slice(0, 50)).join(' | '))
    }
  }
})
