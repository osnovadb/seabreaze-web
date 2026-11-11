import Link from 'next/link'
import { t, type Lang } from '@/lib/i18n'
import type { Role } from '@/lib/perm'

export function AdminTabs({ lang, on, role }: { lang: Lang; on: string; role: Role }) {
  const items: [string, string, boolean][] = [
    ['users', 'Пользователи', role === 'owner'], ['objects', 'Объекты', ['owner', 'office', 'finance'].includes(role)], ['roles', 'Роли и права', true], ['agents', 'Агенты и заявки', ['owner', 'market_head', 'seller'].includes(role)],
    ['disputes', 'Споры', ['owner', 'market_head'].includes(role)], ['developers', 'Застройщики', ['owner', 'market_head', 'office', 'finance'].includes(role)], ['conditions', 'Коммерческие условия', ['owner', 'market_head', 'finance'].includes(role)], ['journal', 'Журнал', ['owner', 'market_head', 'finance'].includes(role)], ['outbox', 'Почта и Telegram', role === 'owner'], ['b24', 'Обмен с Bitrix24', role === 'owner'], ['markets', 'Рынки и справочники', ['owner', 'market_head'].includes(role)], ['privacy', 'Согласия и данные', ['owner', 'office', 'finance'].includes(role)],
  ]
  return <div className="tabs">{items.filter((x) => x[2]).map(([k, l]) => <Link key={k} href={`/admin/${k}`} className={on === k ? 'on' : ''}>{t(lang, l)}</Link>)}</div>
}
