// Чистая функция без доступа к базе — используется и на сервере, и в калькуляторе в браузере
// fix_base (361, 11.11): от чего считается фикс застройщика — 'list' прайс (Арад), 'final' цена клиента (Premium); фикс партнёра — от той же базы
export type SplitCond = { fix_pct: number; pool_pct: number; agent_fix_pct: number; agent_pool_pct: number; agent_our_pool_share: number; seller_share_pct: number; fix_base?: 'list' | 'final' | null }
// Разбивка денег по сделке: фикс — от прайса или цены клиента (условия проекта); пул — от прайса.
// pool_pct здесь — пул выбранного плана (planCond): по договорам сетка «взнос и срок → скидка» и есть максимум скидки
export function split(c: SplitCond, list: number, discPct: number, withAgent = true) {
  const final = list * (1 - discPct / 100)
  const fixBase = c.fix_base === 'list' ? list : final
  const fix = fixBase * c.fix_pct / 100
  const agentFix = withAgent ? fixBase * c.agent_fix_pct / 100 : 0
  const agentPoolLeft = withAgent ? Math.max(0, c.agent_pool_pct - discPct) * list / 100 : 0
  const ourPoolPct = withAgent ? c.pool_pct - Math.max(c.agent_pool_pct, discPct) : c.pool_pct - discPct
  const ourPool = Math.max(0, ourPoolPct) * list / 100
  const shareToAgent = withAgent ? ourPool * (c.agent_our_pool_share || 0) / 100 : 0
  const agent = agentFix + agentPoolLeft + shareToAgent
  const ours = fix - agentFix + ourPool - shareToAgent
  const seller = ours * c.seller_share_pct / 100
  return { list, final, discount: list - final, fix, agentFix, agentPoolLeft, shareToAgent, agent, ourFix: fix - agentFix, ourPool: ourPool - shareToAgent, ours, seller }
}

// Ожидаемая комиссия партнёра по активной брони — одна формула для главной и страницы «Комиссия»: условия из снимка брони,
// у брони, поставленной командой (не партнёром), агентской доли нет
export const expectedAgent = (b: { snapshot: SplitCond; price_list: number; discount_pct: number; ext?: boolean }) => (b.ext === false ? 0 : split(b.snapshot, b.price_list, b.discount_pct, true).agent)

// Пул выбранного плана вместо пула проекта (361, 11.11). Часть партнёра — та же доля пула, что в условиях (10 из 20 — половина)
const r4 = (x: number) => Math.round(x * 1e4) / 1e4
export function planCond<T extends SplitCond>(c: T, poolPct: number): T {
  const share = Number(c.pool_pct) > 0 ? Number(c.agent_pool_pct) / Number(c.pool_pct) : 0
  return { ...c, pool_pct: poolPct, agent_pool_pct: r4(poolPct * share) }
}
