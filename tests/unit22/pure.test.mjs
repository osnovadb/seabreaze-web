// QA 2.2 · юнит-тесты чистых функций (Node 22 снимает типы сам): node --test tests/unit22/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { split } from '../../lib/money.ts'
import { partnerCol, stageBlock, PARTNER_STAGES } from '../../lib/stages.ts'
import { kycMissing } from '../../lib/kyc.ts'

const C = { fix_pct: 5, pool_pct: 20, agent_fix_pct: 2, agent_pool_pct: 10, agent_our_pool_share: 0, seller_share_pct: 15 }
test('split: пример модели от 24.10 (прайс 100 000, пул 20%, часть агента 10%, фикс агента 2%)', () => {
  for (const [disc, agentIncomeFromList] of [[0, 12000], [6, 6000], [10, 2000]]) {
    const s = split(C, 100000, disc, true)
    // в системе фикс — от итоговой цены: 2% от (100 000 − скидка)
    const expect = (100000 * (1 - disc / 100)) * 0.02 + Math.max(0, 10 - disc) * 1000
    assert.ok(Math.abs(s.agent - expect) < 0.01, `скидка ${disc}%: ${s.agent} ≠ ${expect}`)
    assert.ok(Math.abs(agentIncomeFromList - (2000 + Math.max(0, 10 - disc) * 1000)) < 0.01)
  }
})
test('split: всё распределено — агент + мы = фикс + остаток пула', () => {
  for (const disc of [0, 3, 10, 15, 20]) for (const withAgent of [true, false]) {
    const s = split(C, 250000, disc, withAgent)
    const total = s.final * 0.05 + Math.max(0, 20 - disc) * 2500
    assert.ok(Math.abs(s.agent + s.ours - total) < 0.01, `disc ${disc} agent ${withAgent}`)
    assert.ok(s.agent >= 0 && s.ours >= 0)
  }
})
test('split: без агента вся комиссия наша, бонус сейлза = 15% от нашей', () => {
  const s = split(C, 100000, 0, false)
  assert.equal(s.agent, 0); assert.ok(Math.abs(s.seller - s.ours * 0.15) < 0.01)
})
test('split: скидка больше пула не уводит в минус', () => {
  const s = split(C, 100000, 25, true)
  assert.ok(s.ours >= 0 && s.agent >= 0, JSON.stringify(s))
})
test('partnerCol: стадия Bitrix24 главнее фактов портала', () => {
  assert.equal(partnerCol({ b24_stage: 'Reserved', attach_status: 'candidate' }), 'reserved')
  assert.equal(partnerCol({ b24_stage: 'SPA approval' }), 'spa')
  assert.equal(partnerCol({ attach_status: 'candidate' }), 'candidate')
  assert.equal(partnerCol({ booking: 'queued' }), 'request')
  assert.equal(partnerCol({ paid: true, booking: 'converted' }), 'won')
  assert.equal(partnerCol({ regs_sent: true }), 'registration')
  assert.equal(partnerCol({}), 'selection')
  assert.equal(PARTNER_STAGES.length, 8)
})
test('stageBlock: партнёр двигает только Selection, пауза и отказ разрешены', () => {
  const ctx = { stage: 'selection', paused: false, hasBooking: false, hasDeal: false, qualified: true }
  for (const [, , target] of PARTNER_STAGES.filter(([k]) => !['selection', 'request'].includes(k))) assert.ok(stageBlock('agent', ctx, target), target)
  assert.equal(stageBlock('agent', ctx, 'selection'), null)
  assert.equal(stageBlock('agent', ctx, 'pause'), null); assert.equal(stageBlock('agent', ctx, 'lost'), null)
  assert.ok(stageBlock('agent', ctx, 'booking'), 'бронь — только на квартиру')
  assert.ok(stageBlock('content', ctx, 'selection'), 'контент не двигает стадии') // 364: финансы — с правами бэк-офиса
})
test('stageBlock: без квалификации дальше Selection нельзя', () => {
  assert.ok(stageBlock('agent', { stage: 'lead', paused: false, hasBooking: false, hasDeal: false, qualified: false }, 'selection'))
})
test('kycMissing: минимум 251 — паспорт и адрес главного; созаёмщик и компания — свои документы', () => {
  const base = { kyc_citizenship: 'DE', kyc_tax_residence: 'DE', kyc_pep: false }
  assert.deepEqual(kycMissing(['passport', 'address'], base), [])
  assert.ok(kycMissing(['passport'], base).length === 1)
  const buyers = [{ id: 'b1', kind: 'person', name: 'Co', citizenship: 'DE', tax_residence: null, pep: false, reg_no: null, ubo: null }, { id: 'b2', kind: 'company', name: 'Co GmbH', citizenship: null, tax_residence: null, pep: null, reg_no: 'HRB', ubo: 'X' }]
  const docs = [{ kind: 'passport', buyer_id: null }, { kind: 'address', buyer_id: null }]
  assert.equal(kycMissing(docs, base, buyers).length, 5)
  const all = [...docs, { kind: 'passport', buyer_id: 'b1' }, { kind: 'address', buyer_id: 'b1' }, { kind: 'registry', buyer_id: 'b2' }, { kind: 'ubo', buyer_id: 'b2' }, { kind: 'director', buyer_id: 'b2' }]
  assert.deepEqual(kycMissing(all, base, buyers), [])
  assert.ok(kycMissing(all, { ...base, kyc_pep: null }, buyers).includes('ответ про PEP'))
})

// 10.11 · срок сдачи кварталом и годом
import { parseDelivery, canonDelivery, deliveryFromForm, fmtDelivery, deliveryRange } from '../../lib/delivery.ts'
test('срок сдачи: разбор прежних записей и канон с годом впереди (сайты берут slice(0, 4))', () => {
  const c = (x) => canonDelivery(parseDelivery(x))
  assert.equal(c('IV кв. 2027'), '2027-Q4'); assert.equal(c('II квартал 2028'), '2028-Q2'); assert.equal(c('Q3 2026'), '2026-Q3'); assert.equal(c('4 кв 2029'), '2029-Q4')
  assert.equal(c('2030'), '2030'); assert.equal(c('2027-Q1'), '2027-Q1'); assert.equal(c('сдан'), 'done'); assert.equal(c('2025-done'), '2025-done')
  assert.equal(parseDelivery('уточняется'), null); assert.equal(parseDelivery(''), null)
  for (const v of ['2027-Q4', '2030', '2025-done']) assert.match(v.slice(0, 4), /^\d{4}$/)
})
test('срок сдачи: из формы и вывод на четырёх языках', () => {
  assert.equal(deliveryFromForm('4', '2027'), '2027-Q4'); assert.equal(deliveryFromForm('', '2027'), '2027'); assert.equal(deliveryFromForm('4', ''), null); assert.equal(deliveryFromForm('done', '2025'), '2025-done'); assert.equal(deliveryFromForm('done', ''), null); assert.equal(deliveryFromForm('', ''), null)
  assert.equal(fmtDelivery('ru', '2027-Q4'), 'IV кв. 2027'); assert.equal(fmtDelivery('en', '2027-Q4'), 'Q4 2027'); assert.equal(fmtDelivery('de', '2027-Q4'), 'Q4 2027'); assert.equal(fmtDelivery('he', '2027-Q4'), 'רבעון 4 2027')
  assert.equal(fmtDelivery('ru', '2030'), '2030'); assert.equal(fmtDelivery('de', '2025-done'), 'fertiggestellt · 2025'); assert.equal(fmtDelivery('ru', 'уточняется'), 'уточняется')
  assert.equal(fmtDelivery('ru', 'IV кв. 2027'), 'IV кв. 2027', 'прежняя запись выводится в том же виде')
})
test('срок проекта: свой или диапазон по блокам', () => {
  assert.equal(deliveryRange('en', null, ['2028-Q1', '2027-Q2', null, '2027-Q4']), 'Q2 2027 – Q1 2028')
  assert.equal(deliveryRange('ru', '2029', ['2027-Q2']), '2029')
  assert.equal(deliveryRange('ru', null, ['2030', '2030']), '2030')
  assert.equal(deliveryRange('en', null, []), '')
})

// 10.11 · калькулятор вариантов
import { calcVariant, gridDiscount, activeGrid, fromPlan } from '../../lib/calc.ts'
const PL = (o) => ({ id: o.id || 'p', project_id: 'x', building_id: null, name: o.name || 'p', down_payment_pct: o.down ?? null, months: o.months ?? null, full_payment_discount_pct: o.fpd ?? null, valid_from: null, valid_to: null, source_note: null, sort: 0, schedule: o.schedule ?? null })
const COND = { fix_pct: 5, pool_pct: 20, agent_fix_pct: 2, agent_pool_pct: 10, agent_our_pool_share: 0, seller_share_pct: 15 }
test('калькулятор: рамки плана — взнос не меньше минимума, срок не длиннее максимума', () => {
  const r = calcVariant({ list: 200000, plans: [PL({ id: 'a', down: 30, months: 24 })], downPct: 10, months: 36, disc: 0, start: '2026-12-01' })
  assert.equal(r.downPct, 30); assert.equal(r.months, 24); assert.equal(r.clamped.length, 2); assert.equal(r.approx, false)
  assert.equal(r.rows.length, 25); assert.equal(r.down, 60000); assert.equal(r.rows.reduce((a, x) => a + x.amount, 0), 200000, 'сумма строк = цене')
  assert.equal(r.last, '2028-12-01')
  const ok = calcVariant({ list: 200000, plans: [PL({ id: 'a', down: 30, months: 24 })], downPct: 50, months: 12, disc: 0 })
  assert.equal(ok.downPct, 50); assert.equal(ok.months, 12); assert.equal(ok.clamped.length, 0)
})
test('калькулятор: без планов — свободный расчёт с пометкой «ориентировочно»', () => {
  const r = calcVariant({ list: 150000, plans: [], downPct: 20, months: 30, disc: 0 })
  assert.equal(r.approx, true); assert.equal(r.downPct, 20); assert.equal(r.months, 30); assert.equal(r.rows.length, 31)
  assert.equal(r.rows.reduce((a, x) => a + x.amount, 0), 150000)
  const full = calcVariant({ list: 150000, plans: [], downPct: 100, months: 12, disc: 0 })
  assert.equal(full.months, 0); assert.equal(full.rows.length, 1)
})
test('калькулятор (361, 11.11): сетка «взнос и срок» и «скидка за 100 %» — максимум скидки (пул плана), а не вычет из цены', async () => {
  const { planPool } = await import('../../lib/calc.ts')
  const grid = [{ from_pct: 100, max_months: 0, discount_pct: 20 }, { from_pct: 30, max_months: 36, discount_pct: 8 }, { from_pct: 15, max_months: 48, discount_pct: 1 }]
  // пример из ответа Дениса: прайс 100 000, взнос 30 %, 36 мес., сетка Арада 8 % → клиенту не больше 8 000
  const r = calcVariant({ list: 100000, plans: [], grid, downPct: 30, months: 36, disc: 15, cap: 20, ceiling: 20, cond: COND, ext: false })
  assert.equal(r.poolPct, 8); assert.equal(r.poolSource, 'grid'); assert.equal(r.base, 100000, 'из цены ничего не вычтено автоматически')
  assert.equal(r.disc, 8); assert.equal(r.final, 92000); assert.ok(r.clamped.length)
  assert.equal(calcVariant({ list: 100000, plans: [], grid, downPct: 30, months: 36, disc: 0, cond: COND }).total, 100000, 'без скидки клиент платит прайс')
  // строка: наибольший взнос не выше фактического и ближайший срок не короче выбранного
  assert.equal(planPool({ grid, poolPct: 20, downPct: 30, months: 48 }).pct, 1, '30 % на 48 мес. — строка 15 %/48')
  assert.equal(planPool({ grid, poolPct: 20, downPct: 50, months: 24 }).pct, 8)
  assert.equal(planPool({ grid, poolPct: 20, downPct: 100, months: 0 }).pct, 20)
  assert.deepEqual(planPool({ grid, poolPct: 20, downPct: 10, months: 12 }), { pct: 20, source: 'pool' }, 'строка не нашлась — пул проекта')
  assert.deepEqual(planPool({ grid: [], poolPct: 20, downPct: 30, months: 24 }), { pct: 20, source: 'pool' })
  // «скидка за 100 %» плана полной оплаты — максимум, цена не меняется
  const f = calcVariant({ list: 100000, plans: [PL({ id: 'r', down: 30, months: 24 }), PL({ id: 'f', down: 100, fpd: 7 })], planId: 'f', downPct: 100, months: 0, disc: 0, cond: COND })
  assert.equal(f.poolPct, 7); assert.equal(f.total, 100000); assert.equal(f.devAmt, 0)
  // сетка по датам и блоку: своя ступень блока главнее общей
  const g2 = [{ from_pct: 50, discount_pct: 2, valid_to: '2026-01-01' }, { from_pct: 50, discount_pct: 4 }, { from_pct: 50, discount_pct: 6, building_id: 'B' }]
  assert.equal(gridDiscount(activeGrid(g2, '2026-11-10'), 60), 4); assert.equal(gridDiscount(activeGrid(g2, '2026-11-10', 'B'), 60), 6)
})
test('калькулятор: скидка — до порога роли и пула плана; выше порога — «нужно согласование»', () => {
  const r = calcVariant({ list: 100000, plans: [], downPct: 30, months: 24, disc: 12, cap: 5, ceiling: 10, cond: COND, ext: false })
  assert.equal(r.disc, 10); assert.ok(r.clamped.length); assert.equal(r.needsApproval, true); assert.equal(r.final, 90000)
  const ok = calcVariant({ list: 100000, plans: [], downPct: 30, months: 24, disc: 4, cap: 5, ceiling: 10, cond: COND })
  assert.equal(ok.needsApproval, false)
  assert.deepEqual(fromPlan(PL({ down: 30, months: 24 })), { downPct: 30, months: 24 }); assert.deepEqual(fromPlan(PL({ down: 100 })), { downPct: 100, months: 0 })
})
test('калькулятор (349, 373): у партнёра своя часть — его доля пула плана; «попросить больше» — сверх неё; маржа от пула плана', () => {
  const grid = [{ from_pct: 30, max_months: 36, discount_pct: 8 }]
  // доля партнёра в условиях 10 из 20 — половина: при пуле плана 8 % его часть 4 %
  const own = calcVariant({ list: 100000, plans: [], grid, downPct: 30, months: 36, disc: 6, cap: 10, ceiling: 10, cond: COND, ext: true })
  assert.equal(own.capEff, 4); assert.equal(own.disc, 4); assert.equal(own.needsApproval, false)
  assert.ok(Math.abs(own.split.agent - 96000 * 0.02) < 0.01, 'своя часть отдана целиком — у партнёра остаётся фикс')
  assert.ok(Math.abs(own.split.ourPool - 4000) < 0.01, 'наша маржа = (пул плана − наша часть) × прайс')
  const ask = calcVariant({ list: 100000, plans: [], grid, downPct: 30, months: 36, disc: 6, cap: 10, ceiling: 10, askMax: 50, cond: COND, ext: true })
  assert.equal(ask.disc, 6); assert.equal(ask.needsApproval, true)
  // фикс от прайса (Арад) — не зависит от скидки
  const arad = calcVariant({ list: 100000, plans: [], grid, downPct: 30, months: 36, disc: 4, cap: 10, ceiling: 10, cond: { ...COND, fix_base: 'list' }, ext: true })
  assert.equal(arad.split.fix, 5000); assert.ok(Math.abs(arad.split.agentFix - 2000) < 0.01)
})
test('калькулятор (QA 10.11): план выбирается по взносу и сроку; срок до 120; план без срока — ориентировочно', async () => {
  const { pickPlan, startPlan } = await import('../../lib/calc.ts')
  const marina = [PL({ id: 'full', down: 100, fpd: 5 }), PL({ id: 'inst', down: 30, months: 24 })]
  assert.equal(startPlan(marina).id, 'inst', 'старт — с плана рассрочки, а не с «100% сразу»')
  const a = calcVariant({ list: 100000, plans: marina, downPct: 60, months: 12, disc: 0 })
  assert.equal(a.plan.id, 'inst'); assert.equal(a.downPct, 60); assert.equal(a.months, 12); assert.equal(a.clamped.length, 0)
  const f = calcVariant({ list: 100000, plans: marina, downPct: 100, months: 12, disc: 0 })
  assert.equal(f.plan.id, 'full'); assert.equal(f.months, 0); assert.equal(f.total, 100000, '361: «скидка за 100 %» — максимум, а не вычет'); assert.equal(f.poolPct, 5)
  const lo = calcVariant({ list: 100000, plans: marina, downPct: 10, months: 12, disc: 0 })
  assert.equal(lo.plan.id, 'inst'); assert.equal(lo.downPct, 30, 'взнос ниже минимума подтягивается к рассрочке, не к 100 %')
  const free = calcVariant({ list: 100000, plans: [], downPct: 20, months: 200, disc: 0 })
  assert.equal(free.months, 120); assert.ok(free.clamped.length)
  const brabus = [PL({ id: 'b', down: 15 })]
  assert.equal(calcVariant({ list: 100000, plans: brabus, downPct: 15, months: 0, disc: 0 }).approx, false)
  const b36 = calcVariant({ list: 100000, plans: brabus, downPct: 15, months: 36, disc: 0 })
  assert.equal(b36.approx, true, 'у плана застройщика срок не задан — расчёт с выбранным сроком ориентировочный'); assert.equal(b36.months, 36)
  assert.equal(pickPlan([], 50, 12), null)
})
test('калькулятор: введённая сумма взноса сохраняется как есть', () => {
  const total = 161400, v = 80000
  const r = calcVariant({ list: total, plans: [], downPct: (v / total) * 100, months: 24, disc: 0 })
  assert.equal(r.down, 80000)
})

// 292 (Денис 11.11): график платежей клиента, следующий платёж и просрочка
test('график платежей клиента: оплачено, следующий, просрочка', async () => {
  const { scheduleOf } = await import('../../lib/paySchedule.ts')
  const d = { final_price: 100000, options_usd: 0, paid_pct: 30, created_at: '2026-01-15', snapshot: { variant: { downPct: 30, months: 10, start: '2026-01-15' } } }
  const s = scheduleOf(d, '2026-04-20')
  assert.equal(s.rows.length, 11); assert.equal(s.rows[0].paid, true); assert.equal(s.next.n, 2)
  assert.equal(s.overdue.length, 3, 'февраль, март, апрель (15-е) — просрочены'); assert.equal(s.overdueAmount, 21000)
  assert.equal(scheduleOf({ ...d, paid_pct: 100 }, '2026-04-20').overdue.length, 0)
  assert.equal(scheduleOf({ ...d, snapshot: null }), null, 'без плана — графика нет')
})

// Ревью 11.11 (п. 1): при акции скидка в % — от прайса, как в договорах и в подписи максимума
test('split/calcVariant: акция 5 % и скидка 20 % — клиент получает 20 % от прайса, а не от цены после акции', () => {
  const s = split(C, 232000 * 0.95, 20, false, 232000)
  assert.equal(Math.round(s.discount), 46400)
  assert.equal(Math.round(s.final), 232000 * 0.95 - 46400)
  const sn = split({ ...C, list_original: 232000 }, 232000 * 0.95, 20, false) // снимок брони: прайс в list_original
  assert.equal(Math.round(sn.discount), 46400)
  const promo = { id: 'p', name: 'p', badge: null, kind: 'pct', pct: 5, usd: 0, ends_on: null }
  const r = calcVariant({ list: 232000, plans: [], promo, downPct: 35, months: 60, disc: 20, ceiling: 100, cap: 100, ext: false, poolPct: 20 })
  assert.equal(Math.round(r.base - r.final), 46400, 'скидка 20 % не от прайса: ' + (r.base - r.final))
})
import { planLabel } from '../../lib/plans.ts'
test('planLabel: название плана из базы переводится или собирается из взноса и срока (ревью 11.11, п. 10)', () => {
  const he = { 'Рассрочка до {m} мес.': 'תשלומים עד {m} חודשים', 'Полная оплата': 'תשלום מלא', 'Взнос {d} % · до {m} мес.': 'מקדמה {d}% · עד {m} חודשים' }
  const T = (s, v = {}) => (he[s] || s).replace(/\{(\w+)\}/g, (_, k) => String(v[k]))
  assert.equal(planLabel(T, 'Рассрочка до 60 мес.'), 'תשלומים עד 60 חודשים')
  assert.equal(planLabel(T, '100% сразу'), 'תשלום מלא')
  assert.equal(planLabel(T, 'Своя схема Арада', { down_payment_pct: 35, months: 60 }), 'מקדמה 35% · עד 60 חודשים')
  const R = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]))
  assert.equal(planLabel(R, 'Своя схема Арада', { down_payment_pct: 35, months: 60 }), 'Своя схема Арада', 'по-русски название не меняем')
})

// 384 (Денис 12.11): «акция входит в максимум» — цена полная, акция — минимальная скидка из пула, согласования сама не требует
import { priceChain } from '../../lib/plans.ts'
test('384: режим within — база полная, акция становится минимальной скидкой в пределах максимума', () => {
  const promo = { id: 'p', name: 'QA −5%', badge: null, kind: 'pct', pct: 5, usd: 0, ends_on: null }
  const w = priceChain(200000, null, promo, 'within')
  assert.equal(w.base, 200000); assert.equal(w.minDisc, 5); assert.equal(w.promoPrice, 190000); assert.ok(w.poolAllowed)
  const c = priceChain(200000, null, promo, 'chain')
  assert.equal(c.base, 190000); assert.equal(c.minDisc, 0)
  const r0 = calcVariant({ list: 200000, plans: [], downPct: 100, months: 0, disc: 0, promo, mode: 'within', poolPct: 10, cap: 3, ceiling: 10, ext: false })
  assert.equal(r0.disc, 5, 'скидка ниже акции'); assert.equal(r0.final, 190000); assert.equal(r0.needsApproval, false, 'акция сама ушла на согласование')
  const r1 = calcVariant({ list: 200000, plans: [], downPct: 100, months: 0, disc: 8, promo, mode: 'within', poolPct: 10, cap: 3, ceiling: 10, ext: false })
  assert.equal(r1.final, 184000); assert.equal(r1.needsApproval, true)
  const r2 = calcVariant({ list: 200000, plans: [], downPct: 100, months: 0, disc: 15, promo, mode: 'within', poolPct: 10, cap: 3, ceiling: 10, ext: false })
  assert.equal(r2.disc, 10, 'итог больше максимума')
})
