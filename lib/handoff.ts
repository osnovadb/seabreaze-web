'use server'
// 2.2 · 346 (Денис 11.11): очереди бэк-офиса, финансы и админка — отдельной вкладкой на весь экран без повторного входа.
// Во фрейме Bitrix24 сессия — в изолированной (partitioned) cookie, новой вкладке она не видна: выдаём одноразовую ссылку входа на 3 минуты.
import { requireCtx } from './auth'
import { isExternal } from './perm'
import { issueLink } from './access'
import { audit } from './db'

export async function handoffUrl(to: string): Promise<string | null> {
  const c = await requireCtx()
  if (c.impersonating || isExternal(c.real.role)) return null
  const path = to.startsWith('/') && !to.startsWith('//') ? to.replace(/[?&](embed|cl)=[^&]*/g, '') : '/'
  const link = await issueLink(c.real.id, 'login', c.real.id, 0.05)
  await audit(c.real.id, 'login.handoff', 'user', c.real.id, { to: path })
  return `${link}?to=${encodeURIComponent(path)}`
}
