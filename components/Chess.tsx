import Link from 'next/link'
import type { Unit, Code } from '@/lib/catalog'
import { riser, codeFor } from '@/lib/catalog'
import type { User } from '@/lib/auth'
import { t, type Lang } from '@/lib/i18n'

// Шахматка блока: этажи сверху вниз, стояки по позиции на этаже
export function Chess({ units, viewer, mode, lang, cellMode, hrefFor, rooms, selected, match }: {
  units: Unit[]; viewer: User | null; mode: 'team' | 'agent' | 'show'; lang: Lang; cellMode: 'price' | 'rooms' | 'm2'; hrefFor: (u: Unit) => string; rooms?: number; selected?: string; match?: Set<string>
}) {
  const cols = Array.from(new Set(units.map((u) => riser(u)))).sort((a, b) => {
    const na = parseInt(a) || 0, nb = parseInt(b) || 0
    return na - nb || a.localeCompare(b)
  })
  const floors = Array.from(new Set(units.map((u) => u.floor))).sort((a, b) => b - a)
  const at = new Map(units.map((u) => [`${u.floor}|${riser(u)}`, u]))
  const k = (n: number) => (n >= 1000000 ? (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M' : Math.round(n / 1000) + 'k')
  return (
    <div className="chess">
      <table>
        <thead><tr><th />{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {floors.map((f) => (
            <tr key={f}>
              <td className="fl">{f}</td>
              {cols.map((c) => {
                const u = at.get(`${f}|${c}`)
                if (!u) return <td key={c} />
                let code: Code = codeFor(u, viewer, mode)
                const dim = code === 'F' && ((rooms && u.rooms !== rooms) || (match && !match.has(u.id)))
                const label = code === 'X' ? '' : riser(u)
                const val = code === 'X' ? '' : cellMode === 'rooms' ? `${u.rooms ?? '–'}${t(lang, 'к')}` : cellMode === 'm2' ? (u.usd && u.area ? '$' + Math.round(u.usd / (u.area + (u.plot_area || u.ext_area || 0))) : '') : code === 'F' || mode === 'team' ? (u.usd ? k(u.usd) : '') : ''
                const title = code === 'X' ? '' : `${u.block}-${u.number} · ${u.rooms ?? ''}${t(lang, 'к')} · ${u.area} m²${u.usd ? ' · $' + Math.round(u.usd).toLocaleString('en') : ''}${mode === 'team' && u.external_status ? ' · ' + t(lang, 'в источнике') + ': ' + u.external_status : ''}${mode === 'team' && u.hidden ? ' · ' + t(lang, 'скрыта от партнёров') : ''}`
                const cell = <span className={`cell c-${code}${u.id === selected ? ' sel' : ''}`} style={dim ? { opacity: 1, background: 'var(--paper)' } : undefined} title={title}><b>{label}</b>{val}</span>
                return <td key={c}>{code === 'X' ? cell : <Link href={hrefFor(u)} scroll={false}>{cell}</Link>}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
