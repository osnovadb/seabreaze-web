// М8: проверка шаблонов docx (inspectTemplate) и допустимые переменные по виду документа (varAllowed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import PizZip from 'pizzip'
import { inspectTemplate, varAllowed, VARS } from '../../lib/docs'

// шаблон из репозитория с подменой текста в word/document.xml
export function tpl(file: string, from?: string, to?: string) {
  const zip = new PizZip(fs.readFileSync(file))
  if (from) { const x = zip.file('word/document.xml')!.asText(); assert.ok(x.includes(from), `в шаблоне нет «${from}»`); zip.file('word/document.xml', x.split(from).join(to!)) }
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}
const OFFER = 'db/templates/booking_offer.en.docx', FIX = 'db/templates/fixation_act.en.docx'

test('стартовые шаблоны проходят проверку и используют только словарь', () => {
  for (const f of fs.readdirSync('db/templates').filter((x) => x.endsWith('.docx'))) {
    const vars = inspectTemplate(fs.readFileSync('db/templates/' + f))
    assert.ok(vars.length > 3, f)
    const kind = f.split('.')[0] as any
    assert.deepEqual(vars.filter((v) => !varAllowed(kind, v)), [], `${f}: переменные не своего вида`)
  }
})
test('неизвестная переменная — ошибка с её именем', () => {
  assert.throws(() => inspectTemplate(tpl(OFFER, '{unit.number}', '{unit.nmber}')), /vars:.*unit\.nmber/)
})
test('битая скобка — ошибка, но не «vars:» (её покажут как «проверьте скобки»)', () => {
  assert.throws(() => inspectTemplate(tpl(OFFER, '{unit.number}', '{unit.number')), (e: any) => !String(e.message).startsWith('vars:'))
})
test('varAllowed: booking.* и unit.* — не в акте фиксации; fixation.* — только в нём', () => {
  assert.equal(varAllowed('fixation_act', 'booking.final'), false)
  assert.equal(varAllowed('fixation_act', 'unit.number'), false)
  assert.equal(varAllowed('fixation_act', 'fixation.protected_until'), true)
  assert.equal(varAllowed('booking_offer', 'fixation.sent_at'), false)
  assert.equal(varAllowed('commission_act', 'booking.final'), true)
  for (const k of ['booking_offer', 'fixation_act', 'commission_act'] as const) assert.equal(varAllowed(k, 'client.name'), true)
})
test('акт фиксации с {booking.final} проверку переменных проходит, но не подходит по виду', () => {
  const vars = inspectTemplate(tpl(FIX, '{client.name}', '{client.name} {booking.final}'))
  assert.ok(vars.includes('booking.final'))
  assert.ok(vars.some((v) => !varAllowed('fixation_act', v)))
})
test('словарь: у каждой переменной есть описание', () => {
  for (const [k, v] of Object.entries(VARS)) assert.ok(/^[a-z]+\.[a-z_]+$/.test(k) && v.length > 2, k)
})
