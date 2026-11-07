// 2.2 · §8 Деньги: доли по ролям, транши комиссии застройщика, начисления по полученным траншам, реестр выплат, клаубэк.
// Все суммы — USD без НДС на комиссию (решение 204). Платим только из полученного: начисление появляется, когда транш Received.
import { q, one, tx, notify } from './db'
import { split, type SplitCond } from './money'

type Cond = SplitCond & {
  head_bonus_pct: number; escort_fix_usd: number; referrer_pct: number; consultant_pct: number; vat_rate: number; consultant_name: string | null
  pay_timing: string; payment_wait_days: number; clawback_months: number; clawback_offset: string
}
type DealRow = {
  id: string; client_id: string; project_id: string; agent_id: string | null; seller_id: string | null; escort_id: string | null; booking_id: string | null
  final_price: number; paid_pct: number; stage: string; created_at: string; snapshot: Partial<Cond> | null; list: number | null; disc: number | null
  owner_type: string; referrer_id: string | null; cl_created: string; market: string | null; agency_head: string | null; b_escort: string | null
}
export const ROLE_LABEL: Record<string, string> = { partner: 'Партнёр', referrer: 'Рекомендатель', consultant: 'Консультант по застройщикам', escort: 'Сопровождающий в Баку', seller: 'Сейлз', market_head: 'Руководитель рынка', caspian: 'Caspian' }
const r2 = (x: number) => Math.round(x * 100) / 100
const num = (x: unknown, d = 0) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? d : Number(x))

async function dealRow(dealId: string) {
  return one<DealRow>(`select d.id, d.client_id, d.project_id, d.agent_id, d.seller_id, d.escort_id, d.booking_id, d.final_price::float, d.paid_pct::float, d.stage, d.created_at,
      b.snapshot, b.price_list::float list, b.discount_pct::float disc, b.escort_id b_escort, cl.owner_type, cl.referrer_id, cl.created_at cl_created, cl.market,
      (select h.id from portal.users a join portal.users h on h.agency_id = a.agency_id and h.role = 'agency_head' and h.active where a.id = d.agent_id and a.agency_id is not null limit 1) agency_head
    from portal.deals d left join portal.bookings b on b.id = d.booking_id join portal.clients cl on cl.id = d.client_id where d.id = $1`, [dealId])
}
// Условия по сделке: снимок брони (условия на дату брони), недостающие поля — из действующей версии условий проекта
async function condOf(d: DealRow): Promise<Cond> {
  const cur = (await one<Record<string, unknown>>('select * from portal.cur_conditions($1)', [d.project_id])) || {}
  const c = { ...cur, ...(d.snapshot || {}) } as Record<string, unknown>
  const n = (k: string, def = 0) => num(c[k] ?? cur[k], def)
  return {
    fix_pct: n('fix_pct'), pool_pct: n('pool_pct'), agent_fix_pct: n('agent_fix_pct'), agent_pool_pct: n('agent_pool_pct'), agent_our_pool_share: n('agent_our_pool_share'), seller_share_pct: n('seller_share_pct'),
    head_bonus_pct: n('head_bonus_pct'), escort_fix_usd: n('escort_fix_usd', 500), referrer_pct: n('referrer_pct', 2), consultant_pct: n('consultant_pct', 1), vat_rate: n('vat_rate', 18),
    consultant_name: (c.consultant_name as string) || (cur.consultant_name as string) || 'Консультант по застройщикам',
    pay_timing: String(c.pay_timing || cur.pay_timing || 'after_first_payment'), payment_wait_days: n('payment_wait_days', 10), clawback_months: n('clawback_months', 3), clawback_offset: String(c.clawback_offset || cur.clawback_offset || 'any'),
  }
}

// Доли по сделке. После первого полученного транша доли не пересчитываются: разница — корректировкой (выданные акты не правим)
export async function computeShares(dealId: string) {
  const d = await dealRow(dealId)
  if (!d || d.stage === 'cancelled') return null
  if (await one(`select 1 from portal.accruals where deal_id = $1 and kind = 'share' limit 1`, [dealId])) return null
  const c = await condOf(d)
  const partnerSale = !!d.agent_id
  const list = d.list || d.final_price, disc = d.disc ?? (list ? (1 - d.final_price / list) * 100 : 0)
  const sp = split(c, list, disc, partnerSale)
  const total = sp.agent + sp.ours
  const final = d.final_price
  const out: { role: string; user_id: string | null; recipient: string | null; pct: number | null; amount: number }[] = []
  // партнёр: свой фикс и неотданная часть пула; агентству платим целиком — руководителю агентства
  if (partnerSale && sp.agent > 0) out.push({ role: 'partner', user_id: d.agency_head || d.agent_id, recipient: null, pct: null, amount: r2(sp.agent) })
  // рекомендатель: 2% от итоговой цены договора с покупок в течение 12 месяцев от передачи контакта
  const refOk = d.referrer_id && new Date(d.created_at).getTime() - new Date(d.cl_created).getTime() <= 366 * 86400000
  const referrer = refOk ? r2((final * c.referrer_pct) / 100) : 0
  if (referrer) out.push({ role: 'referrer', user_id: d.referrer_id, recipient: null, pct: c.referrer_pct, amount: referrer })
  // консультант по застройщикам: 1% от итоговой цены без НДС по каждой сделке (решение 265)
  const consultant = c.consultant_pct ? r2((final / (1 + c.vat_rate / 100) * c.consultant_pct) / 100) : 0
  if (consultant) out.push({ role: 'consultant', user_id: null, recipient: c.consultant_name, pct: c.consultant_pct, amount: consultant })
  // сопровождающий в Баку — фикс; без сопровождающего фикс остаётся у Caspian
  const escortId = d.escort_id || d.b_escort
  const escort = escortId ? r2(c.escort_fix_usd) : 0
  if (escort) out.push({ role: 'escort', user_id: escortId, recipient: null, pct: null, amount: escort })
  // бонусы — % от нашей выручки без НДС после доли партнёра и рекомендателя
  const rev = Math.max(0, sp.ours - referrer)
  const seller = !partnerSale && d.seller_id ? r2((rev * c.seller_share_pct) / 100) : 0
  if (seller) out.push({ role: 'seller', user_id: d.seller_id, recipient: null, pct: c.seller_share_pct, amount: seller })
  const head = c.head_bonus_pct ? await one<{ id: string }>(`select id from portal.users where active and role = 'market_head' and market = $1 order by created_at limit 1`, [d.market]) : null
  const headAmt = head ? r2((rev * c.head_bonus_pct) / 100) : 0
  if (headAmt) out.push({ role: 'market_head', user_id: head!.id, recipient: null, pct: c.head_bonus_pct, amount: headAmt })
  const caspian = r2(total - out.reduce((a, x) => a + x.amount, 0))
  out.push({ role: 'caspian', user_id: null, recipient: 'Caspian (AZ)', pct: null, amount: caspian })
  await tx(async (t) => {
    await t.query('delete from portal.deal_shares where deal_id = $1', [dealId])
    for (const x of out) await t.query('insert into portal.deal_shares (deal_id, role, user_id, recipient, pct, amount) values ($1,$2,$3,$4,$5,$6)', [dealId, x.role, x.user_id, x.recipient, x.pct, x.amount])
    await t.query('update portal.deals set commission_total = $2, agent_amount = $3, seller_amount = $4, our_amount = $5, escort_id = coalesce(escort_id, $6) where id = $1',
      [dealId, r2(total), r2(partnerSale ? sp.agent : 0), seller, r2(rev), escortId])
  })
  await buildTranches(dealId)
  return { total: r2(total), shares: out }
}

// Транши: «после первого взноса» и «при задатке от 35%» — один транш на всю комиссию; «пропорционально платежам» — по каждому внесённому платежу.
// Условие выполнено → Expected с датой «ждём поступление» (+ срок ожидания из условий в рабочих днях)
export async function buildTranches(dealId: string) {
  const d = await dealRow(dealId)
  if (!d || d.stage === 'cancelled') return
  const c = await condOf(d)
  const total = num((await one<{ t: number }>('select commission_total::float t from portal.deals where id = $1', [dealId]))?.t)
  if (!total) return
  const ts = await q<{ id: string; no: number; pct: number; trigger: string; status: string }>('select id, no, pct::float, trigger, status from portal.tranches where deal_id = $1 order by no', [dealId])
  const wait = c.payment_wait_days || 10
  if (!ts.length) {
    const trig = c.pay_timing === 'deposit_35' ? 'deposit_35' : c.pay_timing === 'proportional' ? 'paid:rest' : 'first_payment'
    await q(`insert into portal.tranches (deal_id, no, pct, amount, trigger, status) values ($1, 1, 100, $2, $3, 'scheduled')`, [dealId, r2(total), trig])
    return buildTranches(dealId)
  }
  // сумма комиссии изменилась до поступлений — пересчитать суммы траншей
  await q(`update portal.tranches set amount = round($2 * pct / 100, 2) where deal_id = $1 and status in ('scheduled','expected')`, [dealId, total])
  const due = (id: string) => q(`update portal.tranches set status = 'expected', due_from = current_date, expected_at = portal.add_workdays(current_date, $2) where id = $1 and status = 'scheduled'`, [id, wait])
  for (const x of ts.filter((x) => x.status === 'scheduled')) {
    if (x.trigger === 'first_payment' && d.paid_pct > 0) await due(x.id)
    if (x.trigger === 'deposit_35' && d.paid_pct >= 35) await due(x.id)
    if (x.trigger === 'paid:rest') {
      // пропорционально: оплачено клиентом больше, чем покрыто траншами, — выделяем новый транш на разницу
      const covered = ts.filter((y) => y.status !== 'scheduled' && y.status !== 'cancelled').reduce((a, y) => a + y.pct, 0)
      const add = Math.min(x.pct, Math.max(0, d.paid_pct - covered))
      if (add > 0.0001) {
        const no = Math.max(...ts.map((y) => y.no)) + 1
        await q(`insert into portal.tranches (deal_id, no, pct, amount, trigger, status, due_from, expected_at) values ($1,$2,$3, round($4 * $3 / 100, 2), $5, 'expected', current_date, portal.add_workdays(current_date, $6))`,
          [dealId, no, add, total, `paid:${Math.round(covered + add)}`, wait])
        if (x.pct - add <= 0.0001) await q(`delete from portal.tranches where id = $1`, [x.id])
        else await q(`update portal.tranches set pct = pct - $2, amount = round($3 * (pct - $2) / 100, 2) where id = $1`, [x.id, add, total])
      }
    }
  }
}

// Финансы отметили поступление транша в Caspian: начисления по каждой доле (кроме Caspian), месяц — срез поступления
export async function receiveTranche(trancheId: string, by: string) {
  const made = await tx(async (t) => {
    const tr = (await t.query(`update portal.tranches set status = 'received', received_at = now(), received_by = $2 where id = $1 and status = 'expected' returning id, deal_id, pct::float, amount::float`, [trancheId, by])).rows[0]
    if (!tr) return null
    const month = (await t.query(`select date_trunc('month', now() at time zone 'Asia/Baku')::date::text m`)).rows[0].m
    const shares = (await t.query(`select role, user_id, recipient, amount::float from portal.deal_shares where deal_id = $1 and role <> 'caspian'`, [tr.deal_id])).rows
    for (const s of shares) {
      const a = r2((s.amount * tr.pct) / 100)
      if (a) await t.query(`insert into portal.accruals (deal_id, tranche_id, role, user_id, recipient, amount, month) values ($1,$2,$3,$4,$5,$6,$7)`, [tr.deal_id, tr.id, s.role, s.user_id, s.recipient, a, month])
    }
    // v2: стадия сделки «вознаграждение получено», когда получены все транши
    const left = (await t.query(`select count(*)::int n from portal.tranches where deal_id = $1 and status in ('scheduled','expected')`, [tr.deal_id])).rows[0].n
    if (!left) await t.query(`update portal.deals set stage = case when stage in ('contract','payments') then 'fee_received' else stage end where id = $1`, [tr.deal_id])
    return { ...tr, month, partner: shares.find((s: { role: string }) => s.role === 'partner') }
  })
  if (made?.partner?.user_id) await notify(made.partner.user_id, 'payout', 'Застройщик оплатил транш — ваша доля {a} войдёт в реестр выплат за {m}', '/commission', { a: '$' + Math.round((made.partner.amount * made.pct) / 100).toLocaleString('en'), m: made.month.slice(0, 7) })
  return made
}

// Расторжение (§9 п.6): неполученные транши отменяются, неначисленное — аннулируется; уже начисленное партнёру и сейлзу в окне клаубэка — минус строкой
export async function clawbackDeal(dealId: string, by: string | null, reason = 'расторжение') {
  const d = await dealRow(dealId)
  if (!d) return null
  const c = await condOf(d)
  const inWindow = Date.now() - new Date(d.created_at).getTime() <= c.clawback_months * 31 * 86400000
  const res = await tx(async (t) => {
    await t.query(`update portal.deals set stage = 'cancelled', terminated_at = coalesce(terminated_at, now()) where id = $1`, [dealId])
    await t.query(`update portal.tranches set status = 'cancelled' where deal_id = $1 and status in ('scheduled','expected')`, [dealId])
    await t.query(`update portal.accruals set status = 'void', note = coalesce(note, '') || ' ' || $2 where deal_id = $1 and status = 'open' and kind = 'share'`, [dealId, reason])
    if (!inWindow) return { claw: [] as { role: string; user_id: string; amount: number }[] }
    const month = (await t.query(`select date_trunc('month', now() at time zone 'Asia/Baku')::date::text m`)).rows[0].m
    const got = (await t.query(`select role, user_id, sum(amount)::float s from portal.accruals where deal_id = $1 and status in ('in_register','paid') and role in ('partner','seller') and kind in ('share','adjustment') group by role, user_id`, [dealId])).rows
    for (const g of got) if (g.s > 0) await t.query(`insert into portal.accruals (deal_id, role, user_id, kind, amount, month, note) values ($1,$2,$3,'clawback',$4,$5,$6)`, [dealId, g.role, g.user_id, -g.s, month, `клаубэк: ${reason}`])
    return { claw: got.filter((g: { s: number }) => g.s > 0).map((g: { role: string; user_id: string; s: number }) => ({ role: g.role, user_id: g.user_id, amount: g.s })) }
  })
  for (const x of res.claw) if (x.user_id) await notify(x.user_id, 'payout', x.role === 'partner' ? 'Сделка расторгнута — выплаченная доля {a} будет удержана из следующих выплат' : 'Сделка расторгнута — бонус {a} будет удержан из будущих бонусов', x.role === 'partner' ? '/commission' : '/', { a: '$' + Math.round(x.amount).toLocaleString('en') })
  return { inWindow, ...res, by }
}

// ── Реестр выплат за месяц (§8 «Выплаты») ──
const ENTITY: Record<string, string> = { DE: 'GmbH', IL: 'IL Ltd' }
export async function collectRegister(month: string, by: string) {
  const reg = await one<{ id: string; status: string }>('select id, status from portal.payout_registers where month = $1', [month])
  if (reg && reg.status !== 'collected') return { error: 'Реестр уже утверждён — собрать заново нельзя' }
  return tx(async (t) => {
    let id = reg?.id
    if (id) {
      await t.query(`update portal.accruals set status = 'open', register_id = null where register_id = $1 and status = 'in_register'`, [id])
      await t.query('delete from portal.payout_lines where register_id = $1', [id])
      await t.query(`update portal.payout_registers set collected_at = now(), collected_by = $2, confirmations = '{}' where id = $1`, [id, by])
    } else id = (await t.query(`insert into portal.payout_registers (month, collected_by) values ($1,$2) returning id`, [month, by])).rows[0].id
    // всё открытое по поступлениям до конца месяца среза, включая перенесённое и минусы (клаубэк зачитывается против следующих выплат)
    const rows = (await t.query(`select a.role, a.user_id, a.recipient, sum(a.amount)::float s, array_agg(a.id) ids,
        u.market, u.partner_form, u.tax_no, u.vat_no, u.tax_country, u.tax_cert_until::text cert, u.bank_changed_at
      from portal.accruals a left join portal.users u on u.id = a.user_id
      where a.status = 'open' and a.month <= $1::date group by a.role, a.user_id, a.recipient, u.market, u.partner_form, u.tax_no, u.vat_no, u.tax_country, u.tax_cert_until, u.bank_changed_at`, [month])).rows
    const monthEnd = (await t.query(`select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text d`, [month])).rows[0].d
    let lines = 0
    for (const r of rows) {
      if (r.s <= 0) continue // долг (клаубэк больше начисленного) — остаётся открытым, зачтётся позже
      const ext = r.role === 'partner' || r.role === 'referrer'
      // документ: компании и ИП — счёт против акта, физлицу — акт и налоговый номер; без документа — перенос
      const docOk = !ext || !!(r.tax_no || r.vat_no)
      // реквизиты сменились меньше 3 дней назад — выплата на новые реквизиты не раньше чем через 3 дня
      const bankHold = r.bank_changed_at && Date.now() - new Date(r.bank_changed_at).getTime() < 3 * 86400000
      const small = r.s < 100
      let withheld = 0
      if (ext && r.tax_country && (!r.cert || r.cert < monthEnd)) {
        const w = (await t.query(`select rate::float from portal.withholding where entity = $1 and country = $2`, [ENTITY[r.market] || 'Caspian', r.tax_country])).rows[0]
        if (w) withheld = r2((r.s * w.rate) / 100)
      }
      const carried = small || !docOk || !!bankHold
      const note = [small && 'меньше 100 $ — перенос', !docOk && 'нет документа (счёт или налоговый номер) — перенос', bankHold && 'новые реквизиты — выплата через 3 дня'].filter(Boolean).join('; ') || null
      await t.query(`insert into portal.payout_lines (register_id, role, user_id, recipient, market, gross, withheld, net, doc_ok, carried, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, r.role, r.user_id, r.recipient, r.market, r2(r.s), withheld, r2(r.s - withheld), docOk, carried, note])
      if (!carried) await t.query(`update portal.accruals set status = 'in_register', register_id = $2 where id = any($1)`, [r.ids, id])
      lines++
    }
    return { ok: true as const, id, lines }
  })
}
export async function confirmMarket(regId: string, market: string, by: string) {
  await q(`update portal.payout_registers set confirmations = confirmations || jsonb_build_object($2::text, jsonb_build_object('by', $3::text, 'at', now())) where id = $1 and status = 'collected'`, [regId, market, by])
}
export async function approveRegister(regId: string, by: string) {
  await q(`update portal.payout_registers set status = 'approved', approved_at = now(), approved_by = $2 where id = $1 and status = 'collected'`, [regId, by])
}
// Оплачено в банке: начисления — Paid; партнёрам и сотрудникам — уведомление
export async function payRegister(regId: string, by: string) {
  const r = await one<{ id: string }>(`update portal.payout_registers set status = 'paid', paid_at = now(), paid_by = $2 where id = $1 and status = 'approved' returning id`, [regId, by])
  if (!r) return
  await q(`update portal.accruals set status = 'paid' where register_id = $1 and status = 'in_register'`, [regId])
  for (const l of await q<{ user_id: string; net: number }>(`select user_id, net::float from portal.payout_lines where register_id = $1 and not carried and user_id is not null`, [regId]))
    await notify(l.user_id, 'payout', 'Выплата отправлена: {a}', '/commission', { a: '$' + Math.round(l.net).toLocaleString('en') })
  // сделки, по которым всё начисленное выплачено и все транши получены, — «Выплачено агенту» (v2)
  await q(`update portal.deals d set stage = 'paid_out', paid_out_at = current_date where d.stage = 'fee_received'
    and not exists (select 1 from portal.accruals a where a.deal_id = d.id and a.status in ('open','in_register'))
    and exists (select 1 from portal.accruals a where a.deal_id = d.id and a.register_id = $1)`, [regId])
}
