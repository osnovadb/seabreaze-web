'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

export function Nav({ items }: { items: { href: string; label: string; cnt?: number }[] }) {
  const p = usePathname()
  // В8: на телефоне меню открывается кнопкой ☰ (флажок #navt в layout) — после перехода закрываем
  useEffect(() => { const t = document.getElementById('navt') as HTMLInputElement | null; if (t) t.checked = false }, [p])
  return (
    <nav className="nav">
      {items.map((i) => {
        const on = i.href === '/' ? p === '/' : p.startsWith(i.href)
        return <Link key={i.href} href={i.href} className={on ? 'on' : ''}><span>{i.label}</span>{i.cnt ? <span className="cnt">{i.cnt}</span> : null}</Link>
      })}
    </nav>
  )
}
