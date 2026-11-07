// QA 2.2 · 15 Фоновая обработка: шаги без ошибок, повторный прогон не дублирует уведомления и задачи; обработчик обмена без вебхука выходит спокойно
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { q, one, close, tick } from './h.mjs'

after(close)
test('tick: без ошибок шагов', async () => {
  const out = await tick()
  const json = JSON.parse(out.trim().split('\n').pop().replace(/^\S+\s/, ''))
  const errs = Object.entries(json).filter(([k]) => k.endsWith('_error'))
  assert.equal(errs.length, 0, JSON.stringify(errs))
})
test('tick дважды подряд: уведомлений и автозадач не прибавилось во втором прогоне', async () => {
  await tick()
  const n1 = (await one('select count(*)::int n from portal.notifications')).n, t1 = (await one('select count(*)::int n from portal.tasks')).n, o1 = (await one(`select count(*)::int n from portal.outbox_messages where kind = 'consent'`)).n
  await tick()
  const n2 = (await one('select count(*)::int n from portal.notifications')).n, t2 = (await one('select count(*)::int n from portal.tasks')).n, o2 = (await one(`select count(*)::int n from portal.outbox_messages where kind = 'consent'`)).n
  assert.equal(n2, n1, `уведомлений стало больше: ${n1} → ${n2}`); assert.equal(t2, t1, `задач стало больше: ${t1} → ${t2}`); assert.equal(o2, o1, 'письма-напоминания задублировались')
})
test('обработчик обмена Bitrix24 без вебхука — выходит без ошибок', async () => {
  const env = { ...process.env }; delete env.B24_WEBHOOK
  const out = execFileSync('node', ['scripts/b24worker.mjs'], { env, encoding: 'utf8', timeout: 60000 })
  assert.match(out, /B24_WEBHOOK не задан/)
})
test('очередь обмена на QA-базе пуста от «мёртвых» задач после прогонов', async () => {
  const dead = (await one(`select count(*)::int n from portal.b24_jobs where status = 'dead'`)).n
  assert.equal(dead, 0)
  void q
})
