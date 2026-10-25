import Link from 'next/link'
import type { Lang } from '@/lib/i18n'
import { t } from '@/lib/i18n'
import { STAGES, AGENT_STAGES, LOST_REASONS } from '@/lib/stages'

export function Top({ crumbs, title, sub, right }: { crumbs?: [string, string?][]; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="top">
      <div>
        {crumbs && <div className="crumbs">{crumbs.map(([l, h], i) => <span key={i}>{i > 0 && '  /  '}{h ? <Link href={h}>{l}</Link> : l}</span>)}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right && <div className="top__r">{right}</div>}
    </div>
  )
}

// Стадии и правила переходов — в lib/stages.ts (нужны и серверу, и браузеру)
export { STAGES, AGENT_STAGES, LOST_REASONS }
// Статус продаж проекта в портале (видимость для партнёров)
export const SALES: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = { draft: ['черновик', 'off'], sales: ['в продаже', 'ok'], stop: ['стоп-продажи', 'warn'], closed: ['закрыт', 'bad'] }
export const stageName = (lang: Lang, st: string) => t(lang, st === 'lost' ? 'Отказ' : (STAGES.find((x) => x[0] === st) || [st, st])[1])

export function Pill({ kind, children }: { kind: 'ok' | 'warn' | 'bad' | 'off' | 'ours' | 'ink'; children: React.ReactNode }) {
  return <span className={`pill pill--${kind}`}>{children}</span>
}

export function Legend({ lang, team }: { lang: Lang; team: boolean }) {
  const items: [string, string][] = team
    ? [['F', 'Свободно'], ['B', 'Бронь застройщика'], ['O', 'Наша бронь'], ['D', 'Наша сделка'], ['S', 'Продано'], ['N', 'Не в продаже'], ['SB', 'Квота SeaBreeze']]
    : [['F', 'Свободно — можно бронировать'], ['M', 'Ваша бронь'], ['X', 'Недоступно']]
  return <div className="legend">{items.map(([k, l]) => <span key={k}><i className={`c-${k}`} />{t(lang, l)}</span>)}</div>
}

// Примеры дизайна от застройщика по числу комнат (Premium Residence)
export const DESIGN: Record<number, string[]> = {
  1: ['d83cf914', '291e75ff', '1c3bb057'], 2: ['c1bd48e2', 'd17a0155', '874dc27e'], 3: ['52f59819', 'e37d1c91', '46b47e59'],
}
export const LOBBY: Record<string, string> = { A: '81a78a23', B: 'eefb6d56', C: 'a6c0908e', D: 'd1b541ff' }
