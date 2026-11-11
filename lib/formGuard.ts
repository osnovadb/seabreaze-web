// 2.2 · 358 (Денис 11.11): защита публичных форм от ботов без внешних сервисов — подписанная метка времени показа формы
// (слишком быстро или старше суток — отказ) и поле-ловушка. Cloudflare Turnstile — когда будут ключи (вопрос к Денису).
import crypto from 'node:crypto'
const sign = (ts: string) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update('form:' + ts).digest('hex').slice(0, 24)
export const formToken = () => { const ts = String(Date.now()); return `${ts}.${sign(ts)}` }
export function formTokenOk(tok: string, minMs = 3000, maxMs = 24 * 3600 * 1000) {
  const [ts, sig] = String(tok || '').split('.')
  if (!ts || !sig || sig.length !== 24 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(ts)))) return false
  const age = Date.now() - Number(ts)
  return age >= minMs && age <= maxMs
}
