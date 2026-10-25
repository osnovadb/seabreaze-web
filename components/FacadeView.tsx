import Link from 'next/link'
import type { Unit, Code } from '@/lib/catalog'
import { riser, codeFor, unitNo } from '@/lib/catalog'
import type { User } from '@/lib/auth'
import { quadCell, polyStr, type P } from '@/lib/geom'

// Фасад дома: фото + сетка окон по калибровке; каждая клетка — квартира стояка на этаже, цвет — статус как в шахматке
export function FacadeView({ facade, units, viewer, mode, hrefFor, selected }: {
  facade: { file_id: string; risers: string[]; floor_from: number; floor_to: number; quad: number[][] }
  units: Unit[]; viewer: User | null; mode: 'team' | 'agent' | 'show'; hrefFor: (u: Unit) => string; selected?: string
}) {
  const rows = facade.floor_to - facade.floor_from + 1
  const q = facade.quad as P[]
  const at = new Map(units.map((u) => [`${u.floor}|${riser(u)}`, u]))
  return (
    <div className="fz">
      <img src={`/files/${facade.file_id}`} alt="" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        {facade.risers.map((r, i) => Array.from({ length: rows }, (_, j) => {
          const floor = facade.floor_to - j
          const u = at.get(`${floor}|${r}`)
          if (!u) return null
          const code: Code = codeFor(u, viewer, mode)
          const poly = <polygon points={polyStr(quadCell(q, i, facade.risers.length, j, rows))} className={`z-${code}${u.id === selected ? ' z-sel' : ''}`}><title>{code === 'X' ? '' : `${unitNo(u)} · ${floor}`}</title></polygon>
          return code === 'X' ? <g key={u.id}>{poly}</g> : <Link key={u.id} href={hrefFor(u)} scroll={false}>{poly}</Link>
        }))}
      </svg>
    </div>
  )
}
