'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { reportError } from '@/lib/errorReport'

// Ошибка внутри портала: понятный экран вместо белой страницы, владельцу — уведомление с кодом ошибки
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const path = usePathname()
  useEffect(() => { reportError(error.digest || '', path).catch(() => {}) }, [error.digest, path])
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1 className="h2">Что-то пошло не так · Something went wrong</h1>
      <p className="muted">Мы уже получили сообщение об ошибке. Попробуйте ещё раз или вернитесь на главную. · We have been notified. Please try again or go back to the home page.</p>
      {error.digest && <p className="tiny muted">Код · Code: {error.digest}</p>}
      <div className="row mt16" style={{ gap: 8 }}><button className="btn btn--p" onClick={() => reset()}>Повторить · Retry</button><a className="btn" href="/">← GetsEstate</a></div>
    </div>
  )
}
