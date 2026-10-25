import Link from 'next/link'
import { getCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'

export default async function NotFound() {
  const c = await getCtx().catch(() => null)
  const L = c?.lang || 'en'
  return <div style={{ padding: 64, textAlign: 'center' }}><div className="h2">404</div><p className="muted">{t(L, 'Страница не найдена или недоступна вашей роли · Page not found')}</p><Link className="btn" href="/">← GetsEstate</Link></div>
}
