'use client'
import { useEffect, useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import { t, type Lang } from '@/lib/i18n'
import { centroid, polyStr, type P } from '@/lib/geom'

type Shape = { key: string; points: P[] }
// Редактор контуров на картинке: выбираете дом или стояк слева, щёлкаете по картинке — добавляется точка; точки можно тянуть,
// правый клик по точке — удалить. Сохраняется массив контуров в долях картинки (для генплана — по блокам, для плана этажа — по стоякам).
export function MarkupEditor({ lang, src, items, initial, action, hidden }: {
  lang: Lang; src: string; items: { key: string; label: string }[]; initial: { key: string; points: number[][] }[]
  action: (s: any, f: FormData) => Promise<{ ok?: boolean; error?: string } | null | undefined>; hidden: Record<string, string>
}) {
  const T = (s: string) => t(lang, s)
  const [shapes, setShapes] = useState<Shape[]>(initial.map((x) => ({ key: x.key, points: x.points as P[] })))
  const [active, setActive] = useState(items.find((i) => !initial.some((x) => x.key === i.key))?.key || items[0]?.key || '')
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [st, act] = useFormState(action, null)
  const cur = shapes.find((x) => x.key === active)
  const pos = (e: { clientX: number; clientY: number }): P => {
    const r = box.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  const setPoints = (key: string, fn: (ps: P[]) => P[]) => setShapes((all) => {
    const has = all.some((x) => x.key === key)
    return has ? all.map((x) => (x.key === key ? { ...x, points: fn(x.points) } : x)) : [...all, { key, points: fn([]) }]
  })
  useEffect(() => {
    if (drag == null) return
    const mv = (e: PointerEvent) => setPoints(active, (ps) => ps.map((p, i) => (i === drag ? pos(e) : p)))
    const up = () => setDrag(null)
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
  })
  const done = shapes.filter((x) => x.points.length >= 3).map((x) => ({ key: x.key, points: x.points, label: centroid(x.points) }))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="label">{T('Что обводим')}</div>
        {items.map((i) => { const n = shapes.find((x) => x.key === i.key)?.points.length || 0; return (
          <button key={i.key} type="button" className={'chip' + (i.key === active ? ' on' : '')} style={{ justifyContent: 'space-between' }} onClick={() => setActive(i.key)}>
            <span>{i.label}</span><span className="n">{n >= 3 ? '✓' : n ? n : '—'}</span>
          </button>
        ) })}
        <div className="row mt8" style={{ gap: 6 }}>
          <button type="button" className="btn btn--sm" disabled={!cur?.points.length} onClick={() => setPoints(active, (ps) => ps.slice(0, -1))}>{T('Убрать точку')}</button>
          <button type="button" className="btn btn--sm" disabled={!cur?.points.length} onClick={() => setShapes((a) => a.filter((x) => x.key !== active))}>{T('Очистить')}</button>
        </div>
        <form action={act} className="stack mt8" style={{ gap: 6 }}>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="shapes" value={JSON.stringify(done)} />
          <button className="btn btn--p">{T('Сохранить разметку')}</button>
          {st?.error && <div className="err tiny">{st.error}</div>}
          {st?.ok && <div className="tiny okc">{T('Сохранено')}</div>}
        </form>
        <div className="tiny muted mt8">{T('Щелчок по картинке — новая точка выбранного контура. Точки можно тянуть мышью; правый клик по точке — удалить. Контур из 3 и более точек сохраняется.')}</div>
      </div>
      <div ref={box} className="mk" onPointerDown={(e) => { if (e.button === 0 && (e.target as HTMLElement).dataset.h == null && active) setPoints(active, (ps) => [...ps, pos(e)]) }}>
        <img src={src} alt="" draggable={false} />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
          {shapes.map((x) => x.points.length >= 2 && <polygon key={x.key} points={polyStr(x.points)} className={x.key === active ? 'mk__on' : 'mk__off'} />)}
        </svg>
        {shapes.filter((x) => x.points.length >= 3).map((x) => { const c = centroid(x.points); const it = items.find((i) => i.key === x.key); return <span key={x.key} className="mk__lbl" style={{ left: `${c[0] * 100}%`, top: `${c[1] * 100}%` }}>{it?.label.split(' ·')[0] || x.key}</span> })}
        {cur?.points.map((p, i) => (
          <span key={i} data-h="1" className="mk__h" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
            onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) setDrag(i) }}
            onContextMenu={(e) => { e.preventDefault(); setPoints(active, (ps) => ps.filter((_, j) => j !== i)) }} />
        ))}
      </div>
    </div>
  )
}
