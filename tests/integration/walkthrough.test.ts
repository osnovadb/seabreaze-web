// Несостыковки из ручного обхода по ролям (исправлены в fa42699): закрепляем, чтобы не вернулись.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { SKIP, U, dbConnect, login, page } from './_portal'

let db: pg.Client
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#x27;|&quot;/g, ' ').replace(/\s+/g, ' ')
const money = (s: string) => Number(s.replace(/[^\d]/g, ''))

before(async () => { if (!SKIP) db = await dbConnect() })
after(async () => { if (!SKIP) await db.end() })

test('партнёру не виден черновик Marina: ставки в «Комиссии», регистрации в карточке клиента', { skip: SKIP }, async () => {
  for (const who of [U.agent, U.agentIl]) {
    const c = await login(who)
    assert.ok(!text((await page(c, '/commission')).html).includes('Marina'), `${who}: /commission`)
    const cl = (await db.query(`select c.id from portal.clients c join portal.users u on u.id=c.owner_id where u.email=$1 limit 1`, [who])).rows[0].id
    assert.ok(!text((await page(c, `/clients/${cl}`)).html).includes('Marina Village'), `${who}: карточка клиента`)
  }
})

test('ожидаемая комиссия партнёра: главная = «в активных бронях» на странице комиссий', { skip: SKIP }, async () => {
  for (const who of [U.agent, U.agentIl]) {
    const c = await login(who)
    const home = text((await page(c, '/')).html), com = text((await page(c, '/commission')).html)
    const h = home.match(/(?:Erwartete Provision|עמלה צפויה|Expected commission|Ожидаемая комиссия)\s*([$₪€][\d.,\s]+|[\d.,\s]+[$₪€])/)?.[1]
    const k = com.match(/(?:In aktiven Reservierungen \(erwartet\)|בהזמנות פעילות \(צפוי\)|In active bookings \(expected\)|В активных бронях \(ожидается\))\s*([$₪€][\d.,\s]+|[\d.,\s]+[$₪€])/)?.[1]
    assert.ok(h && k, `${who}: не нашёл суммы (${h} / ${k})`)
    assert.equal(money(h!), money(k!), `${who}: главная ${h}, комиссии ${k}`)
  }
})

test('стадия клиента: в «Брони» только клиенты с активной бронью; в «Платежах» и дальше — только со сделкой', { skip: SKIP }, async () => {
  const bad = (await db.query(`select c.name, c.stage from portal.clients c where
      (c.stage = 'booking' and not exists (select 1 from portal.bookings b where b.client_id=c.id and b.status in ('requested','confirmed')))
      or (c.stage in ('contract','payments','fee') and not exists (select 1 from portal.deals d where d.client_id=c.id and d.stage <> 'cancelled'))`)).rows
  assert.deepEqual(bad, [])
})

test('бейдж «Партнёры» = число заявок на проверке на главной', { skip: SKIP }, async () => {
  for (const who of [U.owner, U.head]) {
    const t = text((await page(await login(who), '/')).html)
    const badge = Number(t.match(/Партнёры (\d+)/)?.[1] || 0)
    const att = Number(t.match(/Заявки партнёров на проверке: (\d+)/)?.[1] || 0)
    assert.equal(badge, att, `${who}: бейдж ${badge}, на главной ${att}`)
  }
})

test('финансы: «К выплате партнёрам» = сумма актов к выплате', { skip: SKIP }, async () => {
  const due = Number((await db.query(`select coalesce(sum(amount - coalesce(deducted,0)),0)::float s from portal.commission_acts where status='due'`)).rows[0].s)
  const t = text((await page(await login(U.finance), '/')).html)
  const v = t.match(/К выплате партнёрам[^$\d]*\$?\s*([\d\s ]+)/)?.[1]
  assert.ok(v != null, 'нет показателя')
  assert.equal(money(v!), Math.round(due))
})

test('публичная подборка: проекты в шапке и у квартир, у BRABUS нет фото-примера Premium', { skip: SKIP }, async () => {
  const s = (await db.query(`select s.token from portal.selections s join portal.selection_items i on i.selection_id=s.id join units u on u.id=i.unit_id
    group by s.token having count(distinct u.project_id) > 1 limit 1`)).rows[0]
  if (!s) return
  const h = (await page('', `/s/${s.token}`)).html, t = text(h)
  assert.ok(!/Sea Breeze, Baku/.test(t), 'шапка «Sea Breeze, Baku» у смешанной подборки')
  assert.ok(t.includes('BRABUS'), 'нет названия проекта BRABUS')
  // у квартиры BRABUS (номер с префиксом корпуса и 4 цифрами) — нет картинки d83cf914/52f59819 (дизайн Premium)
  const card = h.split(/Wohnung |Apartment |Квартира /).find((x) => /^[A-Z]-\d{4}/.test(x))
  if (card) assert.ok(!/\/img\/(d83cf914|52f59819)\.jpg/.test(card.slice(0, card.indexOf('</section>') > 0 ? card.indexOf('</section>') : 3000)), 'у BRABUS фото дизайна Premium')
})

test('тексты: «квартир: N» без склонения, источник — названием, /materials без CMS, иврит — диапазон цен в bdi', { skip: SKIP }, async () => {
  assert.ok(!/свободны: \d+ квартир\b/.test(text((await page(await login(U.owner), '/')).html)))
  assert.ok(!/CMS|Payload/.test(text((await page(await login(U.agent), '/materials')).html)))
  const cl = (await db.query(`select c.id from portal.clients c join portal.users u on u.id=c.owner_id where u.email=$1 and c.source='agent' limit 1`, [U.agent])).rows[0]?.id
  if (cl) assert.ok(!/Quelle agent\b/.test(text((await page(await login(U.agent), `/clients/${cl}`)).html)), 'источник кодом «agent»')
  assert.match((await page(await login(U.agentIl), '/projects')).html.replace(/<!-- -->/g, ''), /<bdi[^>]*>\$[\d,]+ – \$[\d,]+<\/bdi>/)
})
