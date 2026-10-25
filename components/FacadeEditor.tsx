'use client'
import { useEffect, useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import { t, type Lang } from '@/lib/i18n'
import { quadCell, polyStr, type P } from '@/lib/geom'

// Калибровка фасада: тянете 4 угла сетки на крайние окна (левое верхнее, правое верхнее, правое нижнее, левое нижнее),
// указываете стояки слева направо и этажи — портал режет фасад на квартиры с учётом наклона и красит их по статусу.
export function FacadeEditor({ lang, src, id, project, initial, action }: {
  lang: Lang; src: string; id: string; project: string
  initial: { title: string; risers: string[]; floor_from: number; floor_to: number; quad: number[][] | null }
  action: (s: any, f: FormData) => Promise<{ ok?: boolean; error?: string } | null | undefined>
}) {
  const T = (s: string) => t(lang, s)
  const [quad, setQuad] = useState<P[]>((initial.quad as P[]) || [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]])
  const [risers, setRisers] = useState(initial.risers.join(', '))
  const [from, setFrom] = useState(initial.floor_from), [to, setTo] = useState(initial.floor_to)
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [st, act] = useFormState(action, null)
  const rs = risers.split(/[\s,;]+/).filter(Boolean)
  const rows = Math.max(1, to - from + 1)
  useEffect(() => {
    if (drag == null) return
    const mv = (e: PointerEvent) => {
      const r = box.current!.getBoundingClientRect()
      const p: P = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
      setQuad((q) => q.map((x, i) => (i === drag ? p : x)))
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <form action={act} className="card stack" style={{ gap: 8 }}>
        <input type="hidden" name="id" value={id} /><input type="hidden" name="project" value={project} />
        <input type="hidden" name="quad" value={JSON.stringify(quad.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]))} />
        <label className="field"><span>{T('Название стороны')}</span><input className="in" name="title" defaultValue={initial.title} /></label>
        <label className="field"><span>{T('Стояки слева направо')}</span><input className="in" name="risers" value={risers} onChange={(e) => setRisers(e.target.value)} placeholder="01, 02, 03, 04" /></label>
        <div className="row" style={{ gap: 6 }}>
          <label className="field" style={{ flex: 1 }}><span>{T('Этажи с')}</span><input className="in" name="floor_from" type="number" value={from} onChange={(e) => setFrom(Number(e.target.value))} /></label>
          <label className="field" style={{ flex: 1 }}><span>{T('по')}</span><input className="in" name="floor_to" type="number" value={to} onChange={(e) => setTo(Number(e.target.value))} /></label>
        </div>
        <button className="btn btn--p">{T('Сохранить фасад')}</button>
        {st?.error && <div className="err tiny">{st.error}</div>}
        {st?.ok && <div className="tiny okc">{T('Сохранено')}</div>}
        <div className="tiny muted">{T('Потяните четыре угла: левое верхнее окно, правое верхнее, правое нижнее, левое нижнее — по внешним краям окон. Сетка разделит фасад на стояки и этажи.')}</div>
      </form>
      <div ref={box} className="mk">
        <img src={src} alt="" draggable={false} />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
          {rs.map((_, i) => Array.from({ length: rows }, (_, j) => <polygon key={i + '-' + j} points={polyStr(quadCell(quad, i, rs.length, j, rows))} className="mk__cell" />))}
          <polygon points={polyStr(quad)} className="mk__on" style={{ fill: 'none' }} />
        </svg>
        {rs.map((r, i) => { const p = quadCell(quad, i, rs.length, 0, rows)[0]; return <span key={r} className="mk__lbl" style={{ left: `${(p[0] + (quadCell(quad, i, rs.length, 0, rows)[1][0] - p[0]) / 2) * 100}%`, top: `${Math.max(0, p[1] - 0.03) * 100}%` }}>{r}</span> })}
        {quad.map((p, i) => <span key={i} data-h="1" className="mk__h mk__h--big" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} onPointerDown={(e) => { e.preventDefault(); setDrag(i) }} title={['TL', 'TR', 'BR', 'BL'][i]} />)}
      </div>
    </div>
  )
}
