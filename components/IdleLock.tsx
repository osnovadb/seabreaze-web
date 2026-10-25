'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

// Режим показа: без активности 30 минут — экран блокировки (выход только по PIN)
export function IdleLock({ minutes = 30 }: { minutes?: number }) {
  const router = useRouter(), path = usePathname()
  useEffect(() => {
    if (path === '/show/exit') return
    let timer = setTimeout(lock, minutes * 60000)
    function lock() { router.push('/show/exit') }
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, minutes * 60000) }
    const ev = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => { clearTimeout(timer); ev.forEach((e) => window.removeEventListener(e, reset)) }
  }, [path, minutes, router])
  return null
}
