// Акты вознаграждения (М4): жизненный цикл по стадии сделки и вычет прошлых возвратов из следующей выплаты
import type { PoolClient } from 'pg'
import { q, one, tx, notify } from './db'

// Стадия сделки → статус акта. Вызывается после смены стадии (dealStage) и при создании сделки (договор подписан)
export async function syncAct(dealId: string) {
  const d = await one<{ id: string; agent_id: string | null; agent_amount: number; stage: string }>('select id, agent_id, agent_amount::float, stage from portal.deals where id = $1', [dealId])
  if (!d?.agent_id || !(d.agent_amount > 0)) return
  await q(`insert into portal.commission_acts (deal_id, agent_id, amount) values ($1,$2,$3) on conflict (deal_id) do nothing`, [d.id, d.agent_id, d.agent_amount])
  const act = (await one<{ id: string; status: string; amount: number; deducted: number }>('select id, status, amount::float, deducted::float from portal.commission_acts where deal_id = $1', [d.id]))!
  if (d.stage === 'cancelled') {
    if (act.status === 'paid') {
      // уже выплачено — возврат: удержим из следующих актов партнёра (решение ТЗ 2.0, вопрос 8)
      await q(`update portal.commission_acts set status = 'clawback', clawback_left = amount - deducted where id = $1`, [act.id])
      await notify(d.agent_id, 'payout', 'Сделка расторгнута — выплаченная комиссия {a} будет удержана из следующих выплат', '/commission', { a: '$' + Math.round(act.amount - act.deducted).toLocaleString('en') })
    } else if (act.status !== 'clawback') await q(`update portal.commission_acts set status = 'void' where id = $1`, [act.id])
    return
  }
  if (act.status === 'paid' || act.status === 'clawback') return
  // до выплаты сумма акта следует за сделкой (смена цены до подписания)
  const st = d.stage === 'fee_received' ? 'due' : d.stage === 'paid_out' ? 'paid' : 'expected'
  if (st === 'paid') return payAct(act.id)
  await q(`update portal.commission_acts set amount = $2, status = $3, due_at = case when $3 = 'due' then coalesce(due_at, now()) else due_at end where id = $1`, [act.id, d.agent_amount, st])
  if (st === 'due' && act.status !== 'due') await notify(d.agent_id, 'payout', 'Застройщик оплатил вознаграждение — ваша комиссия к выплате', '/commission')
}
// Выплата: из суммы акта вычитаются непогашенные возвраты партнёра (старые — первыми)
export async function payAct(actId: string) {
  return tx(async (t: PoolClient) => {
    const a = (await t.query(`select id, agent_id, amount::float, status from portal.commission_acts where id = $1 for update`, [actId])).rows[0]
    if (!a || a.status === 'paid') return
    let left = a.amount, deducted = 0
    const claws = (await t.query(`select id, clawback_left::float from portal.commission_acts where agent_id = $1 and status = 'clawback' and clawback_left > 0 order by created_at for update`, [a.agent_id])).rows
    for (const c of claws) {
      if (left <= 0) break
      const take = Math.min(left, c.clawback_left)
      await t.query(`update portal.commission_acts set clawback_left = clawback_left - $2 where id = $1`, [c.id, take])
      left -= take; deducted += take
    }
    await t.query(`update portal.commission_acts set status = 'paid', paid_at = now(), deducted = $2, due_at = coalesce(due_at, now()) where id = $1`, [a.id, deducted])
  })
}
export const ACT_STATUS: Record<string, [string, 'ok' | 'warn' | 'ink' | 'off' | 'bad']> = {
  expected: ['ожидается', 'warn'], due: ['к выплате', 'ok'], paid: ['выплачено', 'ink'], clawback: ['возврат', 'bad'], void: ['аннулирован', 'off'],
}
