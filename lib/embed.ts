// 2.2 · Б9 (ревью 10.11): «текущий клиент» внутри Bitrix24 — из адреса вкладки (?cl=, или /b24/units/<клиент>), а не из общей cookie:
// cookie одна на все окна Bitrix24, и клиент «залипал» между карточками — подборка или бронь могла уйти не тому.
import { cookies, headers } from 'next/headers'
export async function embedClient(): Promise<string | null> {
  if ((await cookies()).get('ge_embed')?.value !== '1') return null
  const cl = (await headers()).get('x-cl') || ''
  return /^[0-9a-f-]{36}$/.test(cl) ? cl : null
}

// О27: клиент, для которого подбирают квартиру — вкладка Bitrix24 (x-cl) или «Подобрать квартиру» из карточки (cookie ge_pick)
export async function pickClient(): Promise<string | null> {
  const e = await embedClient()
  if (e) return e
  const p = (await cookies()).get('ge_pick')?.value || ''
  return /^[0-9a-f-]{36}$/.test(p) ? p : null
}
