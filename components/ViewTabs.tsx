import Link from 'next/link'
import { t, type Lang } from '@/lib/i18n'

// Переключатель «Шахматка · Этаж · Фасад» (прототип 6): одна и та же выборка дома в трёх видах
export function ViewTabs({ lang, base, b, active, facade }: { lang: Lang; base: string; b: string; active: 'chess' | 'floor' | 'facade'; facade: boolean }) {
  const T = (s: string) => t(lang, s)
  const items: [string, string, string][] = [['chess', 'Шахматка', `${base}/chess?b=${b}`], ['floor', 'Этаж', `${base}/floor?b=${b}`]]
  if (facade) items.push(['facade', 'Фасад', `${base}/facade?b=${b}`])
  return <div className="chips">{items.map(([k, l, h]) => <Link key={k} href={h} className={'chip' + (k === active ? ' on' : '')}>{T(l)}</Link>)}</div>
}
