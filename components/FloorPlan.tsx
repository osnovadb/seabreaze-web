'use client'
import Link from 'next/link'
import { useState } from 'react'

// План этажа застройщика с квартирами: цвет по статусу, карточка при наведении, переход к квартире
export type FC = { riser: string; points: number[][]; id: string | null; code: string; href: string | null; no: string; info: string; price: string; orient: string }
export function FloorPlan({ src, cells, selected, children }: { src: string; cells: FC[]; selected?: string; children?: React.ReactNode }) {
  const [hover, setHover] = useState<{ c: FC; x: number; y: number } | null>(null)
  return (
    <div className="fz" onMouseLeave={() => setHover(null)}>
      <img src={src} alt="" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        {cells.map((c) => {
          const poly = <polygon points={c.points.map((p) => p.join(',')).join(' ')} className={`z-${c.code}${c.id && c.id === selected ? ' z-sel' : ''}`}
            onMouseEnter={(e) => c.code !== 'X' && setHover({ c, x: e.clientX, y: e.clientY })} onMouseMove={(e) => hover && setHover({ c, x: e.clientX, y: e.clientY })} />
          return c.href ? <Link key={c.riser} href={c.href} scroll={false}>{poly}</Link> : <g key={c.riser}>{poly}</g>
        })}
      </svg>
      {children}
      {hover && (
        <div className="hovercard" style={{ left: Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 270), top: hover.y + 14 }}>
          <b>{hover.c.no}</b>
          <div className="small">{hover.c.info}</div>
          {hover.c.orient && <div className="tiny muted">{hover.c.orient}</div>}
          {hover.c.price && <div className="mt8"><b>{hover.c.price}</b></div>}
        </div>
      )}
    </div>
  )
}
