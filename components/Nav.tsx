'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function Nav({ items }: { items: { href: string; label: string; cnt?: number }[] }) {
  const p = usePathname()
  return (
    <nav className="nav">
      {items.map((i) => {
        const on = i.href === '/' ? p === '/' : p.startsWith(i.href)
        return <Link key={i.href} href={i.href} className={on ? 'on' : ''}><span>{i.label}</span>{i.cnt ? <span className="cnt">{i.cnt}</span> : null}</Link>
      })}
    </nav>
  )
}
