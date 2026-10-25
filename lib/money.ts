// Чистая функция без доступа к базе — используется и на сервере, и в калькуляторе в браузере
export type SplitCond = { fix_pct: number; pool_pct: number; agent_fix_pct: number; agent_pool_pct: number; agent_our_pool_share: number; seller_share_pct: number }
// Разбивка денег по сделке (механика из ТЗ): фикс от итоговой цены, пул от прайса
export function split(c: SplitCond, list: number, discPct: number, withAgent = true) {
  const final = list * (1 - discPct / 100)
  const fix = final * c.fix_pct / 100
  const agentFix = withAgent ? final * c.agent_fix_pct / 100 : 0
  const agentPoolLeft = withAgent ? Math.max(0, c.agent_pool_pct - discPct) * list / 100 : 0
  const ourPoolPct = withAgent ? c.pool_pct - Math.max(c.agent_pool_pct, discPct) : c.pool_pct - discPct
  const ourPool = Math.max(0, ourPoolPct) * list / 100
  const shareToAgent = withAgent ? ourPool * (c.agent_our_pool_share || 0) / 100 : 0
  const agent = agentFix + agentPoolLeft + shareToAgent
  const ours = fix - agentFix + ourPool - shareToAgent
  const seller = ours * c.seller_share_pct / 100
  return { list, final, discount: list - final, fix, agentFix, agentPoolLeft, shareToAgent, agent, ourFix: fix - agentFix, ourPool: ourPool - shareToAgent, ours, seller }
}
