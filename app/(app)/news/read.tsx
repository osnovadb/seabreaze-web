'use client'
import { useEffect } from 'react'
// Отметить ленту прочитанной после показа (не во время рендера сервера — иначе «новое» не успеть увидеть)
export function MarkRead({ action, n }: { action: () => Promise<void>; n: number }) {
  useEffect(() => { if (n) { const id = setTimeout(() => { action() }, 1500); return () => clearTimeout(id) } }, [action, n])
  return null
}
