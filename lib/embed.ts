// 2.2 · Б9 (ревью 10.11): «текущий клиент» внутри Bitrix24 — из адреса вкладки (?cl=, или /b24/units/<клиент>), а не из общей cookie:
// cookie одна на все окна Bitrix24, и клиент «залипал» между карточками — подборка или бронь могла уйти не тому.
import { cookies, headers } from 'next/headers'
export async function embedClient(): Promise<string | null> {
  if ((await cookies()).get('ge_embed')?.value !== '1') return null
  const cl = (await headers()).get('x-cl') || ''
  return /^[0-9a-f-]{36}$/.test(cl) ? cl : null
}
