// 2.2 · Bitrix24: REST от имени приложения (auth из фрейма) и через настроечный вебхук (B24_WEBHOOK на сервере, в логи не пишем)
const ALLOWED = () => (process.env.B24_DOMAINS || 'getsestate.bitrix24.ae').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)

export const domainOk = (d: string) => ALLOWED().includes(d.trim().toLowerCase())

async function post(url: string, params: Record<string, unknown>) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(`b24 ${j.error}: ${String(j.error_description || '').slice(0, 120)}`)
  return j.result
}

// Вызов от имени пользователя или приложения: auth — AUTH_ID из POST фрейма или установки
export async function restApp<T = any>(domain: string, auth: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!domainOk(domain)) throw new Error('b24 domain not allowed')
  return post(`https://${domain}/rest/${method}.json`, { ...params, auth })
}

// Вызов через входящий вебхук (чтение сделок и контактов для связи с клиентом портала)
export async function restHook<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const wh = process.env.B24_WEBHOOK
  if (!wh) throw new Error('B24_WEBHOOK не задан')
  return post(wh.replace(/\/+$/, '') + '/' + method + '.json', params)
}

export const hookOn = () => !!process.env.B24_WEBHOOK

// Телефон и e-mail контакта Bitrix24 → те же нормализации, что у клиентов портала
export function contactKeys(c: { PHONE?: { VALUE: string }[]; EMAIL?: { VALUE: string }[] }) {
  const phone = (c.PHONE || []).map((p) => p.VALUE).find(Boolean) || ''
  const email = (c.EMAIL || []).map((e) => e.VALUE).find(Boolean) || ''
  return { phone, email, phoneNorm: phone.replace(/\D/g, '').replace(/^00/, ''), emailNorm: email.trim().toLowerCase() }
}
