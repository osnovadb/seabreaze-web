import Link from 'next/link'
import { t, type Lang } from '@/lib/i18n'
import type { Role } from '@/lib/perm'

// В4 (ревью 10.11): 12 вкладок не помещались на 1280 px — четыре группы (люди, объекты и условия, интеграции, журнал),
// вкладки — внутри группы текущего раздела
export function AdminTabs({ lang, on, role }: { lang: Lang; on: string; role: Role }) {
  const T = (s: string) => t(lang, s)
  const items: [string, string, boolean, string][] = [
    ['users', 'Пользователи', role === 'owner', 'people'], ['roles', 'Роли и права', ['owner', 'market_head'].includes(role), 'people'],
    ['agents', 'Агенты и заявки', ['owner', 'market_head'].includes(role), 'people'], ['disputes', 'Споры', ['owner', 'market_head'].includes(role), 'people'],
    ['privacy', 'Согласия и данные', ['owner', 'office', 'finance'].includes(role), 'people'],
    ['objects', 'Объекты', ['owner', 'office', 'finance'].includes(role), 'objects'], ['developers', 'Застройщики', ['owner', 'market_head', 'office', 'finance'].includes(role), 'objects'],
    ['conditions', 'Коммерческие условия', ['owner', 'market_head', 'finance'].includes(role), 'objects'], ['markets', 'Рынки и справочники', ['owner', 'market_head'].includes(role), 'objects'],
    ['b24', 'Обмен с Bitrix24', role === 'owner', 'integr'], ['outbox', 'Почта и Telegram', role === 'owner', 'integr'],
    ['journal', 'Журнал', ['owner', 'market_head', 'finance'].includes(role), 'journal'],
  ]
  const vis = items.filter((x) => x[2])
  const groups: [string, string][] = [['people', 'Люди'], ['objects', 'Объекты и условия'], ['integr', 'Интеграции'], ['journal', 'Журнал']]
  const curG = vis.find((x) => x[0] === on)?.[3] || vis[0]?.[3]
  const gs = groups.filter(([g]) => vis.some((x) => x[3] === g))
  return <>
    {gs.length > 1 && <div className="chips" style={{ marginBottom: 8 }}>{gs.map(([g, l]) => { const first = vis.find((x) => x[3] === g)!; return <Link key={g} href={`/admin/${first[0]}`} className={'chip' + (g === curG ? ' on' : '')}>{T(l)}</Link> })}</div>}
    <div className="tabs">{vis.filter((x) => x[3] === curG).map(([k, l]) => <Link key={k} href={`/admin/${k}`} className={on === k ? 'on' : ''}>{T(l)}</Link>)}</div>
  </>
}
