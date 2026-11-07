// 2.2 · Портал → Bitrix24 (§13): задача в очередь portal.b24_jobs и сразу попытка выполнить — менеджер видит изменение в карточке без ожидания.
// Не получилось (Bitrix24 недоступен, лимит) — задача остаётся в очереди, её дошлёт scripts/b24worker.mjs с повторами. Логика — в lib/b24x.mjs.
import { q } from './db'
import { enqueueSync, processJob, b24on } from './b24x.mjs'

export async function pushDeal(clientId: string, note?: string) {
  if (!b24on() || !clientId) return
  try {
    const id = await enqueueSync(q, clientId, note)
    if (id) await processJob(q, id)
  } catch {
    // очередь недоступна — не роняем действие пользователя; сверка раз в час догонит
  }
}

// Несколько клиентов сразу (пакет регистраций, соперники-кандидаты): только в очередь, отправит обработчик
export async function queueSync(clientIds: string[], note?: string) {
  if (!b24on()) return
  for (const id of Array.from(new Set(clientIds.filter(Boolean)))) await enqueueSync(q, id, note).catch(() => null)
}
