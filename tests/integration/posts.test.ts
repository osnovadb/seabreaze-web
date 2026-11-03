// М9: лента для партнёров — кто что видит, права на запись. Тест кладёт записи «QA …» прямо в seabreeze_v2 и удаляет их.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page, formWith, submit } from './_portal'

const MR = 'c531e4dd-e500-47cf-b000-febd86a6fc7f' // test-marina: партнёрам закрыт
let db: pg.Client
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const add = (title: string, x: { markets?: string[]; lang?: string | null; project?: string; starts?: string; ends?: string; kind?: string } = {}) =>
  db.query(`insert into portal.posts (kind, title, lang, markets, project_id, starts_on, ends_on) values ($1,$2,$3,$4,$5,$6,$7)`,
    [x.kind || 'news', title, x.lang === undefined ? 'en' : x.lang, x.markets || [], x.project || null, x.starts || day(0), x.ends || null])
const cleanup = () => db.query(`delete from portal.posts where title like 'QA %'`)
const seen = async (email: string, all = false) => { const h = (await page(await login(email), '/news' + (all ? '?all=1' : ''))).html; return (t: string) => h.includes(t) }

before(async () => {
  if (SKIP) return
  db = await dbConnect(); await cleanup()
  await add('QA IL he', { markets: ['IL'], lang: 'he' })
  await add('QA all en', {})
  await add('QA all de', { lang: 'de' })
  await add('QA all ru', { lang: 'ru' })
  await add('QA DE de', { markets: ['DE'], lang: 'de' })
  await add('QA closed project', { project: MR })
  await add('QA expired', { ends: day(-1) })
  await add('QA future', { starts: day(1) })
  await add('QA auto', { lang: null, kind: 'auto' })
})
after(async () => { if (SKIP) return; await cleanup(); await db.end() })

test('агент DE: видит DE и «всем» на de/en и авто; не видит IL, ru, закрытый проект, прошлое и будущее', { skip: SKIP }, async () => {
  const s = await seen(U.agent)
  for (const t of ['QA all en', 'QA all de', 'QA DE de', 'QA auto']) assert.ok(s(t), 'должен видеть: ' + t)
  for (const t of ['QA IL he', 'QA all ru', 'QA closed project', 'QA expired', 'QA future']) assert.ok(!s(t), 'не должен видеть: ' + t)
})
test('агент IL: видит he и en, не видит de и рынок DE', { skip: SKIP }, async () => {
  const s = await seen(U.agentIl)
  for (const t of ['QA IL he', 'QA all en', 'QA auto']) assert.ok(s(t), 'должен видеть: ' + t)
  for (const t of ['QA all de', 'QA DE de', 'QA closed project', 'QA expired']) assert.ok(!s(t), 'не должен видеть: ' + t)
})
test('команда: руководитель DE видит записи своего рынка на любом языке, но не IL; закрытый партнёрам проект — видит', { skip: SKIP }, async () => {
  const s = await seen(U.head)
  for (const t of ['QA all ru', 'QA all de', 'QA DE de', 'QA closed project']) assert.ok(s(t), 'должен видеть: ' + t)
  assert.ok(!s('QA IL he'))
})
test('редактор (owner) с ?all=1 видит все рынки; прошлое и будущее — нет', { skip: SKIP }, async () => {
  const s = await seen(U.owner, true)
  for (const t of ['QA IL he', 'QA DE de', 'QA all ru']) assert.ok(s(t), t)
  assert.ok(!s('QA expired') && !s('QA future'))
})
test('seller и agent не могут вызвать savePost; market_head пишет только на свой рынок', { skip: SKIP }, async () => {
  const own = await login(U.owner)
  const f = formWith((await page(own, '/news')).html, 'title', 'kind', 'lang')
  assert.ok(f, 'форма записи у владельца')
  for (const who of [U.seller, U.agent]) await submit(await login(who), '/news', f!, { title: 'QA от ' + who, body: 'x', lang: 'en', m_IL: 'on' })
  assert.equal((await db.query(`select count(*)::int n from portal.posts where title like 'QA от %'`)).rows[0].n, 0)
  const head = await login(U.head)
  const hf = formWith((await page(head, '/news')).html, 'title', 'kind', 'lang')!
  await submit(head, '/news', hf, { title: 'QA от руководителя', body: 'x', lang: 'en', m_IL: 'on', m_GLOBAL: 'on' })
  const m = (await db.query(`select markets from portal.posts where title='QA от руководителя'`)).rows[0]?.markets
  assert.deepEqual(m, ['DE'])
})
test('счётчик: непрочитанные есть до открытия ленты', { skip: SKIP }, async () => {
  const n = (await db.query(`select count(*)::int n from portal.posts p where title like 'QA %' and not exists (select 1 from portal.post_reads r join portal.users u on u.id=r.user_id where r.post_id=p.id and u.email=$1)`, [U.agent])).rows[0].n
  assert.ok(n > 0)
})
