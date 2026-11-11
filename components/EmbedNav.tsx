'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// М4 (ревью 10.11): подсветка раздела во фрейме Bitrix24 — по текущему адресу, в том числе после перехода без перезагрузки
export function EmbedNav({ items }: { items: [href: string, label: string][] }) {
  const path = usePathname() || ''
  const cur = items.map(([h]) => h).filter((h) => path === h || path.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0]
  return <nav className="embed-nav">{items.map(([h, l]) => <Link key={h} href={h} className={h === cur ? 'on' : ''}>{l}</Link>)}</nav>
}
