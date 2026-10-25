import Link from 'next/link'
import { t, type Lang } from '@/lib/i18n'
import type { Role } from '@/lib/perm'

export function AdminTabs({ lang, on, role }: { lang: Lang; on: string; role: Role }) {
  const items: [string, string, boolean][] = [
    ['users', 'Пользователи', role === 'owner'], ['objects', 'Объекты', ['owner', 'office'].includes(role)], ['roles', 'Роли и права', true], ['agents', 'Агенты и заявки', ['owner', 'market_head', 'seller'].includes(role)],
    ['disputes', 'Споры', ['owner', 'market_head'].includes(role)], ['conditions', 'Коммерческие условия', ['owner', 'market_head', 'finance'].includes(role)], ['journal', 'Журнал', ['owner', 'market_head', 'finance'].includes(role)],
  ]
  return <div className="tabs">{items.filter((x) => x[2]).map(([k, l]) => <Link key={k} href={`/admin/${k}`} className={on === k ? 'on' : ''}>{t(lang, l)}</Link>)}</div>
}
