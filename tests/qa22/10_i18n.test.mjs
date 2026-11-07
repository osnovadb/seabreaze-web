// QA 2.2 · 10 Языки: экраны партнёра (DE, HE) и команды (EN — интерфейс Bitrix24 английский) без русских «хвостов».
// Мягкая проверка: находки пишутся в tests/qa22/out/i18n.txt и в вывод, прогон не валят. Данные проектов (названия, описания) не считаются.
import { test, after } from 'node:test'
import fs from 'node:fs'
import { user, agency, register, freeUnit, close, page, act, lastBooking } from './h.mjs'

const found = []
after(async () => {
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
  fs.writeFileSync(new URL('./out/i18n.txt', import.meta.url), found.join('\n') + '\n')
  console.log(`\n# i18n: экранов с русским текстом — ${found.length}\n` + found.map((x) => '# ' + x).join('\n'))
  await close()
})
const DATA = /QA|Обложка|тест\)|Premium|BRABUS|Marina|Положено|Баку$/ // данные проектов и тестов
async function scan(u, label, paths) {
  for (const p of paths) {
    const r = await page(u, p)
    if (r.status !== 200) continue
    const text = r.html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n').replace(/&[a-z#0-9]+;/g, ' ')
    const ru = Array.from(new Set(text.split('\n').map((s) => s.trim()).filter((s) => /[А-Яа-яЁё]{3,}/.test(s) && !DATA.test(s))))
    if (ru.length) found.push(`${label} ${p.replace(/[0-9a-f-]{36}/g, ':id')} — ${ru.slice(0, 6).map((s) => s.slice(0, 60)).join(' | ')}${ru.length > 6 ? ` (+${ru.length - 6})` : ''}`)
  }
}
test('партнёр: DE, HE, EN', async () => {
  for (const locale of ['de', 'he', 'en']) {
    const ag = await agency('DE'); const H = await user('agency_head', { agency_id: ag.id, locale })
    const cl = (await register(H)).result?.id
    await scan(H, `partner ${locale}`, ['/', '/clients', '/clients?v=list', `/clients/${cl}`, '/commission', '/links', '/catalog', '/projects', '/projects/premium-residence', '/projects/premium-residence/chess', '/selections', '/bookings', '/news', '/materials', '/profile', '/notifications', '/waitlist', '/team'])
  }
})
test('команда в EN (как во фрейме Bitrix24)', async () => {
  const roles = ['owner', 'market_head', 'seller', 'office', 'finance', 'content']
  const S = await user('seller', { locale: 'en' })
  const cl = (await register(S)).result?.id
  await act(S, 'createBooking', { unit: (await freeUnit()).id, client: cl, discount: 0 })
  void (await lastBooking(cl))
  for (const r of roles) {
    const u = r === 'seller' ? S : await user(r, { locale: 'en', market: r === 'owner' ? null : 'DE' })
    await scan(u, `${r} en`, ['/', '/catalog', '/clients', `/clients/${cl}`, `/b24/units/${cl}`, `/b24/units/${cl}?tab=terms`, `/b24/units/${cl}?tab=pick`, '/bookings', '/registrations', '/kyc', '/finance', '/finance?tab=tranches', '/finance?tab=register', '/finance?tab=debts',
      '/admin', '/admin/users', '/admin/conditions', '/admin/developers', '/admin/markets', '/admin/privacy', '/admin/b24', '/admin/agents', '/admin/journal', '/reports', '/news'])
  }
})
test('публичные страницы клиента: DE и HE', async () => {
  const S = await user('seller')
  const cl = (await register(S, { language: 'de' })).result?.id
  const { client } = await import('./h.mjs')
  const c = await client(cl)
  await act(S, 'kycLink', { client: cl })
  const k = (await client(cl)).kyc_token
  for (const lang of ['de', 'he', 'en']) await scan(null, `client ${lang}`, [`/c/${c.consent_token}?lang=${lang}`, `/k/${k}?lang=${lang}`])
  await scan(null, 'public', ['/apply?lang=de', '/apply?lang=he', '/login?lang=de', '/login/link?lang=de'])
})
